import { createStore, type StoreApi } from "zustand/vanilla";
import {
  MAX_FONT_BYTES,
  ProjectError,
  addFont,
  addHistorySnapshot,
  addImage,
  createProject,
  emptyDesign,
  historyDoc,
  loadProject,
  planThumbnailPng,
  readProjectInfo,
  saveProject,
  type Design,
  type HistoryEntry,
  type LiloProject,
  type PixelArt,
  type ProjectDoc,
  type Shelf,
} from "@lilo/engine/light";
import type { EngineClient } from "../engine/client";
import type { OpenedPath, Platform, RecentProject } from "../platform";
import type { EditorActions, EditorState } from "../state/editorStore";
import { designFromStitches, isStitchFile, readStitchFile, StitchImportError } from "../io/importStitch";
import { hoopStore, loadHoops } from "../state/hoopStore";
import { isBlank, type PixelStore } from "../state/pixelStore";

export type UnsavedChoice = "save" | "discard" | "cancel";

export interface ConfirmRequest {
  /** What the user was about to do: "close", "start a new design", "open another project"... */
  action: string;
  /** Which question: unsaved changes (Save / Don't save / Cancel), revert (Revert / Cancel), or a damaged file (Open the earlier copy / Cancel). */
  kind: "unsaved" | "revert" | "recover";
  projectName: string;
}

/** One card of the Home gallery. */
export interface RecentCard {
  path: string;
  /** File name without `.lilo`. */
  name: string;
  modifiedMs: number;
  /** The title stored in the file, once read. */
  title?: string;
  /** PNG bytes of the thumbnail inside the file. */
  thumbnail?: Uint8Array;
  /** Set when the file could not be read. */
  error?: string;
}

export interface ProjectState {
  /** Where the project is saved; null before the first save (and in the browser, which downloads). */
  path: string | null;
  dirty: boolean;
  savedAt: string | null;
  /** The version history, oldest first (the file's `history/` ring). */
  history: HistoryEntry[];
  busy: boolean;
  notice: { kind: "ok" | "error"; text: string } | null;
  confirm: ConfirmRequest | null;
  recent: RecentCard[];
  recentLoading: boolean;
}

export interface ProjectDeps {
  editor: { api: StoreApi<EditorState>; actions: EditorActions };
  engine: EngineClient;
  platform: () => Platform;
  pixel: PixelStore;
  shelf: () => Shelf;
  /** Uploaded fonts: which ones a project embeds (the ones its text uses) and how they are brought back on open. */
  fonts?: {
    collect(keys: readonly string[]): Promise<{ id: string; name: string; ext: string; bytes: Uint8Array }[]>;
    restore(fonts: readonly { id: string; name: string; bytes: Uint8Array }[]): Promise<void>;
  };
  now?: () => Date;
}

class CancelledOpen extends Error {}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const fileNameFor = (title: string) => `${(title.trim() || "Untitled").replace(/[\\/:*?"<>|]+/g, "_")}.lilo`;

/**
 * Projects (spec 4.9): new, open, save, save as, revert, autosave into the version history, restore,
 * and the "unsaved changes" guard. Plain TypeScript over the editor store, the engine's project API
 * (`.lilo` zip) and the platform (files), so it is tested without React.
 *
 * A project is the design, the title, the reference images (bytes beside the design), the pixel-art
 * grid and a snapshot of My Threads. The file's `project.json` is the last explicit save; autosaves go
 * into its `history/` ring only, so an autosave never overwrites what the user chose to keep.
 */
export function createProjectManager(deps: ProjectDeps) {
  const { editor, engine, pixel } = deps;
  const now = deps.now ?? (() => new Date());
  const store = createStore<ProjectState>(() => ({
    path: null,
    dirty: false,
    savedAt: null,
    history: [],
    busy: false,
    notice: null,
    confirm: null,
    recent: [],
    recentLoading: false,
  }));
  const get = store.getState;
  const set = store.setState;
  const es = () => editor.api.getState();

  /** The last saved (or opened) project: what Revert goes back to, and whose `project.json` autosave keeps. */
  let base: LiloProject | null = null;
  /** What "saved" looked like, to tell when something changed. */
  let saved: { design: Design | null; name: string; pixel: PixelArt } = { design: es().design, name: es().projectName, pixel: pixel.store.getState().art };
  let queue: Promise<unknown> = Promise.resolve();
  /** What went wrong embedding fonts in the last project built; shown with "Saved". */
  let fontWarnings: string[] = [];
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };
  let confirmResolve: ((c: UnsavedChoice) => void) | null = null;
  /** What the last autosave looked at, so an idle editor costs nothing (no hashing a big design every 30 s). */
  let lastAuto: { design: Design | null; name: string; pixel: PixelArt } | null = null;

  // ---- what is unsaved -------------------------------------------------------------------------
  const isDirty = () => {
    const s = es();
    return s.design !== saved.design || s.projectName !== saved.name || pixel.store.getState().art !== saved.pixel;
  };
  const refreshDirty = () => {
    const d = isDirty();
    if (d !== get().dirty) set({ dirty: d });
  };
  const markSaved = () => {
    saved = { design: es().design, name: es().projectName, pixel: pixel.store.getState().art };
    set({ dirty: false });
  };

  // ---- building and applying a project ----------------------------------------------------------
  const hasContent = () => (es().design?.objects.length ?? 0) > 0 || !isBlank(pixel.store.getState().art) || (es().design?.images?.length ?? 0) > 0;

  /** The editor's current state as a project (no history yet). */
  const current = async (t: Date): Promise<LiloProject> => {
    const s = es();
    const design = s.design ?? emptyDesign();
    const art = pixel.store.getState().art;
    let project = createProject({ title: s.projectName, design, shelf: deps.shelf(), app: "Lilo", now: base ? new Date(base.doc.createdAt) : t });
    project = { ...project, doc: { ...project.doc, savedAt: t.toISOString(), pixelArt: isBlank(art) ? null : art } };
    fontWarnings = [];
    const customKeys = (design.textBlocks ?? []).filter((b) => b.fontId.startsWith("custom:")).map((b) => b.fontId.slice(7));
    if (customKeys.length > 0 && deps.fonts) {
      const found = await deps.fonts.collect(customKeys);
      for (const f of found) {
        try {
          project = addFont(project, f);
        } catch {
          fontWarnings.push(`The font "${f.name}" is over ${MAX_FONT_BYTES / 1024 / 1024} MB, so it was not saved in the project.`);
        }
      }
      for (const k of customKeys) if (!found.some((f) => f.id === k)) fontWarnings.push("A font used by the text is no longer available here, so it was not saved in the project.");
    }
    const bytes = new Map(editor.actions.imageAssets().map((a) => [a.id, a]));
    for (const m of design.images ?? []) {
      const a = bytes.get(m.id);
      if (!a) continue;
      project = addImage(project, { id: m.id, name: m.name, mime: m.mime, bytes: a.bytes, placement: { x: m.x, y: m.y, widthMm: m.widthMm, opacity: m.opacity, locked: m.locked, visible: m.visible, w: m.w, h: m.h } });
    }
    return project;
  };

  const thumbnail = async (design: Design): Promise<Uint8Array> => {
    const s = es();
    if (s.design === design && s.planResult && !s.planning) return planThumbnailPng(s.planResult.plan, { size: 256 });
    return engine.call("designThumbnail", design, 256);
  };

  /** Make `project` the open document. `path` is where it lives (null: nowhere yet). */
  const apply = async (project: LiloProject, path: string | null) => {
    const doc = project.doc;
    let design = doc.design;
    const refs = doc.images.filter((r) => project.images[r.id]);
    if (!design.images?.length && refs.length > 0) {
      // a project that keeps its placements only in the image list (not written by this app)
      design = { ...design, images: refs.map((r) => placementOf(r)) };
    }
    const images = Object.fromEntries(refs.map((r) => [r.id, { bytes: project.images[r.id], mime: r.mime }]));
    // fonts the project carries, so its text opens (and can be edited) on a machine that never had them
    const embedded = doc.fonts.flatMap((f) => (f.source === "custom" && project.fonts[f.id] && project.fonts[f.id].length <= MAX_FONT_BYTES ? [{ id: f.id, name: f.name, bytes: project.fonts[f.id] }] : []));
    await deps.fonts?.restore(embedded).catch(() => {});
    await editor.actions.loadDesign(design, { name: doc.title, images });
    pixel.actions.load(doc.pixelArt ?? null);
    base = project;
    saved = { design: es().design, name: es().projectName, pixel: pixel.store.getState().art };
    set({ path, dirty: false, savedAt: doc.savedAt, history: project.history, notice: null });
  };

  // ---- the unsaved-changes question -------------------------------------------------------------
  const ask = (action: string, kind: ConfirmRequest["kind"] = "unsaved"): Promise<UnsavedChoice> =>
    new Promise((resolve) => {
      confirmResolve?.("cancel");
      confirmResolve = resolve;
      set({ confirm: { action, kind, projectName: es().projectName } });
    });

  /** Run `fn` unless the user backs out of losing unsaved changes. Resolves to whether it ran. */
  const guarded = async (action: string, fn: () => Promise<void>): Promise<boolean> => {
    if (get().dirty) {
      const c = await ask(action);
      if (c === "cancel") return false;
      if (c === "save" && !(await api.save())) return false;
    }
    await fn();
    return true;
  };

  const fail = (e: unknown): false => {
    set({ notice: { kind: "error", text: e instanceof ProjectError || e instanceof StitchImportError ? e.message : `Something went wrong: ${msg(e)}` } });
    return false;
  };

  // ---- the API ---------------------------------------------------------------------------------
  const api = {
    store,

    /**
     * Ask the unsaved-changes question ("…if you <action> without saving…"), then run `fn`. Resolves
     * to whether it ran. For things that end the session, like installing an update.
     */
    runGuarded: guarded,

    /** Answer the open question (the dialog's buttons). */
    resolveConfirm(choice: UnsavedChoice) {
      const r = confirmResolve;
      confirmResolve = null;
      set({ confirm: null });
      r?.(choice);
    },

    /** A blank design. */
    newProject: (): Promise<boolean> =>
      guarded("start a new design", async () => {
        editor.actions.setName("Untitled design");
        await editor.actions.loadDesign(emptyDesign(), { name: "Untitled design" });
        pixel.actions.load(null);
        base = null;
        saved = { design: es().design, name: es().projectName, pixel: pixel.store.getState().art };
        set({ path: null, dirty: false, savedAt: null, history: [], notice: null });
      }).catch(fail),

    /**
     * Open a file the user chose or the OS handed us: a `.lilo` project, or a stitch file (PES, DST, ...),
     * which becomes a NEW untitled project named after it. Resolves to whether something opened.
     */
    openFile: (file: OpenedPath): Promise<boolean> => (isStitchFile(file.name) ? api.openStitch(file) : api.openLilo(file)),

    /**
     * A stitch file as a new project: one layer named after the file, the smallest hoop of the user's machine
     * that holds it, every stitch where the file had it. It has no path, so the first Save is a Save As
     * (a `.lilo` in the projects folder) and the original file is never written to.
     */
    async openStitch(file: { name: string; bytes: Uint8Array }): Promise<boolean> {
      let imp;
      try {
        imp = await readStitchFile(engine, file); // before the unsaved-changes question: a bad file shouldn't ask it
      } catch (e) {
        return fail(e);
      }
      await loadHoops().catch(() => {});
      const { design, warnings } = designFromStitches(imp, { reference: hoopStore.getState().recents[0], custom: hoopStore.getState().custom });
      return guarded("open another file", async () => {
        await editor.actions.loadDesign(design, { name: imp.name });
        pixel.actions.load(null);
        base = null;
        // never saved: closing it asks first
        saved = { design: null, name: "", pixel: pixel.store.getState().art };
        set({ path: null, dirty: true, savedAt: null, history: [], notice: warnings.length ? { kind: "ok", text: warnings.join(" ") } : null });
      }).catch(fail);
    },

    /**
     * A stitch file dropped on the editor. With a design open it becomes a NEW stitch layer on top (one undo
     * step, stitches where the file had them); on an empty canvas it opens as the design, like Open….
     */
    async addStitchFile(file: { name: string; bytes: Uint8Array }): Promise<boolean> {
      if (!(es().design?.objects.length ?? 0)) return api.openStitch(file);
      try {
        const imp = await readStitchFile(engine, file);
        editor.actions.addStitchLayerWith(imp);
        set({ notice: imp.warnings.length ? { kind: "ok", text: imp.warnings.join(" ") } : null });
        return true;
      } catch (e) {
        return fail(e);
      }
    },

    /** A `.lilo` project (double-click, Open, a Home card). */
    openLilo: (file: OpenedPath): Promise<boolean> =>
      guarded("open another project", async () => {
        let loaded: ReturnType<typeof loadProject>;
        let recovered = false;
        try {
          loaded = loadProject(file.bytes);
        } catch (e) {
          // a damaged file: the previous save (kept beside it) may still be good, but only open it if the user says so
          const bak = e instanceof ProjectError && file.path ? await deps.platform().readProjectBackup(file.path).catch(() => null) : null;
          let earlier: ReturnType<typeof loadProject> | null = null;
          try {
            earlier = bak ? loadProject(bak) : null;
          } catch {
            earlier = null;
          }
          if (!earlier) throw e;
          if ((await ask("open the earlier copy", "recover")) === "cancel") throw new CancelledOpen();
          loaded = earlier;
          recovered = true;
        }
        await apply(loaded.project, file.path || null);
        // remember it for Home's Recent list; failing to must never fail the open
        if (file.path) void deps.platform().recordRecent(file.path).catch(() => {});
        if (recovered) set({ dirty: true, notice: { kind: "ok", text: "Opened the copy from the previous save. Save to replace the damaged file." } });
        else if (loaded.warnings.length) set({ notice: { kind: "ok", text: loaded.warnings.join(" ") } });
      }).catch((e) => (e instanceof CancelledOpen ? false : fail(e))),

    /** Open… */
    async openDialog(): Promise<boolean> {
      let file: OpenedPath | null;
      try {
        file = await deps.platform().openProjectDialog();
      } catch (e) {
        return fail(e);
      }
      return file ? api.openFile(file) : false;
    },

    /** A project in the default folder (a Home card). */
    async openPath(path: string): Promise<boolean> {
      let bytes: Uint8Array;
      try {
        bytes = await deps.platform().readProjectFile(path);
      } catch (e) {
        return fail(e);
      }
      return api.openFile({ path, name: path.split(/[\\/]/).pop() ?? path, bytes });
    },

    /** Save to the project's own file; the first save asks where (Save As). Resolves to whether it saved. */
    save: (): Promise<boolean> =>
      serial(async () => {
        if (!get().path && deps.platform().kind === "tauri") return saveAs();
        return write(get().path);
      }).catch(fail),

    saveAs: (): Promise<boolean> => serial(saveAs).catch(fail),

    /** Go back to the last saved version. */
    async revert(): Promise<boolean> {
      if (!base) return false;
      if (get().dirty && (await ask("revert", "revert")) !== "discard") return false;
      try {
        await apply(base, get().path);
        return true;
      } catch (e) {
        return fail(e);
      }
    },

    /**
     * Snapshot the working state into the version history (every 30 s and when the window loses
     * focus). Unchanged content adds nothing. A saved project's file is rewritten with the new ring and
     * its last explicit save untouched.
     */
    autosave: (): Promise<void> =>
      serial(async () => {
        if (!hasContent() && get().history.length === 0) return;
        const seen = { design: es().design, name: es().projectName, pixel: pixel.store.getState().art };
        if (lastAuto && lastAuto.design === seen.design && lastAuto.name === seen.name && lastAuto.pixel === seen.pixel) return;
        lastAuto = seen;
        const t = now();
        const cur = await current(t);
        const withHistory = addHistorySnapshot({ ...cur, history: get().history }, t);
        if (withHistory.history === get().history) return;
        set({ history: withHistory.history });
        const p = get().path;
        if (p && base) {
          const keep: LiloProject = { ...base, history: withHistory.history };
          await deps.platform().writeProjectFile(p, saveProject(keep, t));
        }
      }).catch(() => {
        // an autosave that fails (disk full, folder gone) must not interrupt the user; the next one tries again
      }),

    /** Bring a version back as one undoable edit (the working state is kept in the history first). */
    async restore(entryId: string): Promise<boolean> {
      const entry = get().history.find((e) => e.id === entryId);
      if (!entry) return false;
      try {
        const old = historyDoc(entry);
        const t = now();
        const cur = await current(t);
        set({ history: addHistorySnapshot({ ...cur, history: get().history }, t).history });
        editor.actions.commit(
          "Restore version",
          (d) => {
            for (const k of ["hoop", "threads", "objects", "mapGroups", "textBlocks", "images"] as const) {
              const v = old.design[k];
              if (v === undefined) delete (d as Partial<Design>)[k];
              else (d as unknown as Record<string, unknown>)[k] = v;
            }
          },
          { select: [] },
        );
        const art = old.pixelArt ?? null;
        if (art && pixel.store.getState().art !== art) pixel.actions.replace(art, "Restore version");
        set({ notice: { kind: "ok", text: "Version restored. Undo brings back what you had." } });
        return true;
      } catch (e) {
        return fail(e);
      }
    },

    /** The document stored in a history entry, for previews. */
    entryDoc: (entryId: string): ProjectDoc | null => {
      const e = get().history.find((x) => x.id === entryId);
      return e ? historyDoc(e) : null;
    },

    /** The window is closing: true when it may. */
    async closeRequested(): Promise<boolean> {
      if (!get().dirty) return true;
      const c = await ask("close");
      if (c === "cancel") return false;
      if (c === "save") return (await api.save()) === true;
      return true;
    },

    /** The Home gallery: projects in the default folder, newest first, each with its thumbnail. */
    async refreshRecent(): Promise<void> {
      set({ recentLoading: true });
      try {
        const list: RecentProject[] = await deps.platform().listRecentProjects(24);
        set({ recent: list.map((r) => ({ path: r.path, name: r.name, modifiedMs: r.modifiedMs })) });
        for (const r of list) {
          let card: Partial<RecentCard>;
          try {
            const info = readProjectInfo(await deps.platform().readProjectFile(r.path));
            card = { title: info.title, thumbnail: info.thumbnail };
          } catch (e) {
            card = { error: msg(e) };
          }
          set((s) => ({ recent: s.recent.map((c) => (c.path === r.path ? { ...c, ...card } : c)) }));
        }
      } catch {
        set({ recent: [] });
      } finally {
        set({ recentLoading: false });
      }
    },

    clearNotice: () => set({ notice: null }),

    /** Treat what is in the editor right now as saved (a design loaded by the app itself, not by the user). */
    markClean: markSaved,

    /** Start watching the editor for unsaved changes. Returns the stop function (React StrictMode starts twice). */
    start(): () => void {
      const unsubs = [editor.api.subscribe(refreshDirty), pixel.store.subscribe(refreshDirty)];
      refreshDirty();
      return () => unsubs.forEach((u) => u());
    },
  };

  /** Save As: a dialog, then the file. */
  async function saveAs(): Promise<boolean> {
    set({ busy: true });
    try {
      const t = now();
      const bytes = await pack(t);
      const path = await deps.platform().saveProjectAs(fileNameFor(es().projectName), bytes.bytes);
      if (!path) return false;
      finish(bytes.project, deps.platform().kind === "tauri" ? path : null);
      return true;
    } finally {
      set({ busy: false });
    }
  }

  /** Save to `path` (or download in the browser). */
  async function write(path: string | null): Promise<boolean> {
    set({ busy: true });
    try {
      const t = now();
      const { bytes, project } = await pack(t);
      if (path) await deps.platform().writeProjectFile(path, bytes);
      else if (!(await deps.platform().saveProjectAs(fileNameFor(es().projectName), bytes))) return false;
      finish(project, path);
      return true;
    } finally {
      set({ busy: false });
    }
  }

  /** The project as bytes, with this save recorded in the history. */
  async function pack(t: Date): Promise<{ bytes: Uint8Array; project: LiloProject }> {
    const cur = await current(t);
    const thumb = await thumbnail(es().design ?? emptyDesign());
    const project = addHistorySnapshot({ ...cur, thumbnail: thumb, history: get().history }, t);
    return { bytes: saveProject(project, t), project };
  }

  function finish(project: LiloProject, path: string | null) {
    base = project;
    markSaved();
    set({ path, savedAt: project.doc.savedAt, history: project.history, notice: { kind: "ok", text: `${path ? `Saved ${path.split(/[\\/]/).pop()}` : "Saved"}${fontWarnings.length ? `. ${fontWarnings.join(" ")}` : ""}` } });
  }

  return api;
}

export type ProjectManager = ReturnType<typeof createProjectManager>;

/** A design image entry from a project's image list, for projects that don't keep placements in the design. */
function placementOf(r: ProjectDoc["images"][number]): NonNullable<Design["images"]>[number] {
  const p = (r.placement ?? {}) as Record<string, unknown>;
  const n = (k: string, d: number) => (typeof p[k] === "number" ? (p[k] as number) : d);
  return {
    id: r.id,
    name: r.name,
    mime: r.mime,
    w: n("w", 100),
    h: n("h", 100),
    x: n("x", -30),
    y: n("y", -30),
    widthMm: n("widthMm", 60),
    opacity: n("opacity", 0.6),
    locked: p.locked === true,
    visible: p.visible !== false,
  };
}
