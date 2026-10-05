import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addEntry, emptyDesign, emptyShelf, loadProject, makeFill, rectNodes, type Design, type PixelArt } from "@lilo/engine/light";
import { designToEmbroidery } from "@lilo/engine";
import { sampleDesign } from "../../../engine/src/stitch/sample-design";
import { createInlineEngine } from "../engine/client";
import { createMockPlatform, type MockState } from "../platform/mock";
import type { Platform } from "../platform";
import { createEditorStore, defaultThread, type EditorStore } from "../state/editorStore";
import { createPixelStore, type PixelStore } from "../state/pixelStore";
import { createProjectManager, type ProjectDeps, type ProjectManager } from "./manager";

// no canvas in node: decoded reference pictures are stand-ins
vi.mock("../io/decode", async (orig) => ({
  ...(await orig<typeof import("../io/decode")>()),
  decodeFile: vi.fn(async (f: { name: string }) => ({ kind: "raster", image: { width: 100, height: 50, data: new Uint8ClampedArray(100 * 50 * 4) }, reference: { width: 100, height: 50, name: f.name } })),
}));

let core: EditorStore;
let px: PixelStore;
let platform: Platform;
let mock: MockState;
let m: ProjectManager;
let stop: () => void;
let clock = new Date("2026-10-03T10:00:00Z");

const thread = defaultThread();
const box = (id: string, x = 0): Design["objects"][number] => makeFill(id, id, thread.id, rectNodes(x, 0, x + 10, 10));
const design = (...ids: string[]): Design => ({ ...emptyDesign(), threads: [thread], objects: ids.map((id, i) => box(id, i * 12)) });
const st = () => core.store.getState();
const ids = () => st().design!.objects.map((o) => o.id);
const tick = (min = 1) => (clock = new Date(clock.getTime() + min * 60_000));

async function setup(kind: "tauri" | "browser" = "tauri", fonts?: ProjectDeps["fonts"]) {
  core = createEditorStore(createInlineEngine());
  px = createPixelStore();
  const p = createMockPlatform({ kind });
  platform = p.platform;
  mock = p.state;
  const shelf = addEntry(emptyShelf(), { brand: "Local Mill", code: "A7", hex: "#aa3366" });
  m = createProjectManager({ editor: { api: core.store, actions: core.actions }, engine: createInlineEngine(), platform: () => platform, pixel: px, shelf: () => shelf, fonts, now: () => clock });
  stop = m.start();
  await core.actions.loadDesign(design("a", "b"), { name: "Crest" });
  m.store.setState({ dirty: false });
}

beforeEach(() => {
  clock = new Date("2026-10-03T10:00:00Z");
});
afterEach(() => {
  stop?.();
  core?.dispose();
});

const edit = (id = "c") => core.actions.addObjects([box(id, 40)], "Add");
const paint = () => {
  px.actions.setThread(thread);
  px.actions.beginStroke("Draw");
  px.actions.paintCells([[1, 1], [2, 1]], false);
  px.actions.endStroke();
};

describe("unsaved changes", () => {
  it("an untouched project is clean; an edit, a rename or a pixel stroke makes it dirty; saving cleans it", async () => {
    await setup();
    expect(m.store.getState().dirty).toBe(false);
    edit();
    expect(m.store.getState().dirty).toBe(true);
    await m.save();
    expect(m.store.getState().dirty).toBe(false);
    core.actions.setName("Crest v2");
    expect(m.store.getState().dirty).toBe(true);
    await m.save();
    paint();
    expect(m.store.getState().dirty).toBe(true);
  });
});

describe("save", () => {
  it("the first save on the desktop asks where (Save As) and keeps the path; the next one writes to it", async () => {
    await setup();
    edit();
    expect(await m.save()).toBe(true);
    const path = m.store.getState().path!;
    expect(path).toBe("/mock/Documents/Lilo/Crest.lilo");
    expect(mock.files.has(path)).toBe(true);
    const before = mock.files.get(path)!;
    edit("d");
    await m.save();
    expect(mock.files.get(path)).not.toBe(before);
    expect(m.store.getState().path).toBe(path);
  });

  it("the file holds the design, title, images folder, pixel art, thumbnail and a snapshot of My Threads", async () => {
    await setup();
    await core.actions.addRefImage({ name: "ref.png", bytes: new Uint8Array([1, 2, 3]), type: "image/png" });
    paint();
    await m.save();
    const { project } = loadProject(mock.files.get(m.store.getState().path!)!);
    expect(project.doc.title).toBe("Crest");
    expect(project.doc.design.objects.map((o) => o.id)).toEqual(["a", "b"]);
    expect(project.doc.design.images).toHaveLength(1);
    const ref = project.doc.images[0];
    expect(ref.file).toMatch(/^images\/img\d+\.png$/);
    expect(Array.from(project.images[ref.id])).toEqual([1, 2, 3]);
    expect(project.doc.pixelArt?.cells.filter(Boolean)).toHaveLength(2);
    expect(project.doc.shelf.entries[0]).toMatchObject({ brand: "Local Mill", code: "A7" });
    expect(project.thumbnail?.length).toBeGreaterThan(100);
    expect(project.history).toHaveLength(1); // a save is a version too
  });

  it("in the browser (no path) Save downloads a copy", async () => {
    await setup("browser");
    edit();
    expect(await m.save()).toBe(true);
    expect(m.store.getState().path).toBeNull();
    expect(m.store.getState().dirty).toBe(false);
    expect(mock.files.size).toBe(1); // went through saveProjectAs
  });

  it("a cancelled Save As leaves the project dirty", async () => {
    await setup();
    edit();
    platform.saveProjectAs = async () => null;
    expect(await m.saveAs()).toBe(false);
    expect(m.store.getState().dirty).toBe(true);
  });
});

describe("open and revert", () => {
  async function saved(): Promise<string> {
    edit();
    await m.save();
    return m.store.getState().path!;
  }

  it("opening a project restores design, title, images and pixel art, clears undo, and is clean", async () => {
    await setup();
    await core.actions.addRefImage({ name: "ref.png", bytes: new Uint8Array([9, 9]), type: "image/png" });
    paint();
    const path = await saved();
    await core.actions.loadDesign(emptyDesign(), { name: "Other" });
    px.actions.load(null);
    m.store.setState({ dirty: false });
    expect(await m.openPath(path)).toBe(true);
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(st().projectName).toBe("Crest");
    expect(st().refImages).toHaveLength(1);
    expect(px.store.getState().art.cells.filter(Boolean)).toHaveLength(2);
    expect(st().canUndo).toBe(false);
    expect(m.store.getState().dirty).toBe(false);
    expect(m.store.getState().path).toBe(path);
    expect(m.store.getState().history.length).toBeGreaterThan(0);
  });

  it("a file that isn't a project is refused with a message and changes nothing", async () => {
    await setup();
    const before = st().design;
    expect(await m.openFile({ path: "/x/notes.lilo", name: "notes.lilo", bytes: new TextEncoder().encode("hello, not a zip at all, certainly not") })).toBe(false);
    expect(m.store.getState().notice?.kind).toBe("error");
    expect(m.store.getState().notice?.text).toMatch(/isn't a Lilo project|damaged/i);
    expect(st().design).toBe(before);
  });

  it("revert goes back to the last save after asking, and keeps the file path", async () => {
    await setup();
    const path = await saved();
    core.actions.setSelection(["a"]);
    core.actions.deleteSelection();
    expect(ids()).toEqual(["b", "c"]);
    const r = m.revert();
    expect(m.store.getState().confirm?.kind).toBe("revert");
    m.resolveConfirm("discard");
    expect(await r).toBe(true);
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(m.store.getState().dirty).toBe(false);
    expect(m.store.getState().path).toBe(path);
  });

  it("revert asked and cancelled changes nothing", async () => {
    await setup();
    await saved();
    core.actions.setSelection(["a"]);
    core.actions.deleteSelection();
    const r = m.revert();
    m.resolveConfirm("cancel");
    expect(await r).toBe(false);
    expect(ids()).toEqual(["b", "c"]);
  });
});

describe("custom fonts travel inside the project", () => {
  const withText = (fontId: string) => core.actions.commit("Add text", (d) => void (d.textBlocks = [{ id: "text-1", text: "Hi", fontId, heightMm: 10, letterSpacingMm: 0, lineSpacing: 1, align: "center", origin: [0, 0] }]));
  const store = new Map<string, Uint8Array>();
  const fonts: ProjectDeps["fonts"] = {
    collect: async (keys) => keys.flatMap((k) => (store.has(k) ? [{ id: k, name: "Brand Sans", ext: "ttf", bytes: store.get(k)! }] : [])),
    restore: vi.fn(async (list: readonly { id: string; bytes: Uint8Array }[]) => void list.forEach((f) => store.set(`restored:${f.id}`, f.bytes))),
  };

  it("saves the fonts the text uses, and brings them back on open", async () => {
    store.clear();
    store.set("Brand.ttf#0", new Uint8Array([0, 1, 0, 0, 7, 7]));
    store.set("Unused.ttf#0", new Uint8Array([9]));
    await setup("tauri", fonts);
    withText("custom:Brand.ttf#0");
    await m.save();
    const path = m.store.getState().path!;
    const { project } = loadProject(mock.files.get(path)!);
    expect(project.doc.fonts.map((f) => [f.id, f.source])).toEqual([["Brand.ttf#0", "custom"]]); // only the one in use
    expect(Array.from(project.fonts["Brand.ttf#0"])).toEqual([0, 1, 0, 0, 7, 7]);
    // another Mac: no fonts there, opening the file restores them
    store.clear();
    await m.newProject();
    expect(await m.openPath(path)).toBe(true);
    expect(fonts!.restore).toHaveBeenLastCalledWith([{ id: "Brand.ttf#0", name: "Brand Sans", bytes: expect.any(Uint8Array) }]);
    expect(Array.from(store.get("restored:Brand.ttf#0")!)).toEqual([0, 1, 0, 0, 7, 7]);
  });

  it("built-in fonts are not embedded; a font over 20 MB is left out with a clear note", async () => {
    store.clear();
    store.set("Huge.ttf#0", new Uint8Array(20 * 1024 * 1024 + 1));
    await setup("tauri", fonts);
    withText("geneva_simple");
    await m.save();
    expect(loadProject(mock.files.get(m.store.getState().path!)!).project.doc.fonts).toEqual([]);
    withText("custom:Huge.ttf#0");
    await m.save();
    expect(loadProject(mock.files.get(m.store.getState().path!)!).project.doc.fonts).toEqual([]);
    expect(m.store.getState().notice?.text).toMatch(/Brand Sans.*over 20 MB/);
  });

  it("a font that is no longer on this machine is reported, not silently dropped", async () => {
    store.clear();
    await setup("tauri", fonts);
    withText("custom:Gone.ttf#0");
    await m.save();
    expect(m.store.getState().notice?.text).toMatch(/no longer available/);
  });
});

describe("a damaged project file", () => {
  async function twoSaves() {
    await setup();
    edit();
    await m.save(); // a, b, c
    const path = m.store.getState().path!;
    core.actions.setSelection(["a"]);
    core.actions.deleteSelection();
    await m.save(); // b, c  (the earlier copy, a b c, is now the .bak)
    return path;
  }

  it("a save keeps the previous one beside the file", async () => {
    const path = await twoSaves();
    const bak = await platform.readProjectBackup(path);
    expect(loadProject(bak!).project.doc.design.objects.map((o) => o.id)).toEqual(["a", "b", "c"]);
    expect(loadProject(mock.files.get(path)!).project.doc.design.objects.map((o) => o.id)).toEqual(["b", "c"]);
  });

  it("offers the earlier copy instead of failing; opening it marks the project unsaved so Save replaces the damaged file", async () => {
    const path = await twoSaves();
    mock.files.set(path, new Uint8Array([80, 75, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])); // damaged
    await m.newProject();
    const r = m.openPath(path);
    await vi.waitFor(() => expect(m.store.getState().confirm?.kind).toBe("recover"));
    m.resolveConfirm("discard");
    expect(await r).toBe(true);
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(m.store.getState().dirty).toBe(true);
    expect(m.store.getState().notice?.text).toMatch(/previous save/);
    await m.save();
    expect(loadProject(mock.files.get(path)!).project.doc.design.objects.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("declining leaves everything as it was; with no usable copy it is an error, not a guess", async () => {
    const path = await twoSaves();
    mock.files.set(path, new Uint8Array([1, 2, 3]));
    m.clearNotice();
    const before = st().design;
    const r = m.openPath(path);
    await vi.waitFor(() => expect(m.store.getState().confirm?.kind).toBe("recover"));
    m.resolveConfirm("cancel");
    expect(await r).toBe(false);
    expect(st().design).toBe(before);
    expect(m.store.getState().notice).toBeNull();
    mock.backups.clear();
    expect(await m.openPath(path)).toBe(false);
    expect(m.store.getState().notice?.kind).toBe("error");
  });
});

describe("the unsaved-changes guard (New, Open, close)", () => {
  it("New on a clean project just starts a blank design", async () => {
    await setup();
    expect(await m.newProject()).toBe(true);
    expect(m.store.getState().confirm).toBeNull();
    expect(st().design!.objects).toHaveLength(0);
    expect(st().projectName).toBe("Untitled design");
    expect(m.store.getState().path).toBeNull();
    expect(m.store.getState().history).toEqual([]);
    expect(st().source).toBeNull();
  });

  it("with changes it asks; Cancel keeps everything, Don't save discards, Save saves then goes on", async () => {
    await setup();
    edit();
    let r = m.newProject();
    expect(m.store.getState().confirm).toMatchObject({ kind: "unsaved", action: "start a new design", projectName: "Crest" });
    m.resolveConfirm("cancel");
    expect(await r).toBe(false);
    expect(ids()).toContain("c");

    r = m.newProject();
    m.resolveConfirm("discard");
    expect(await r).toBe(true);
    expect(ids()).toEqual([]);
    expect(mock.files.size).toBe(0); // nothing was saved

    edit("z");
    r = m.newProject();
    m.resolveConfirm("save");
    expect(await r).toBe(true);
    expect(mock.files.size).toBe(1); // saved first
    expect(ids()).toEqual([]);
  });

  it("runGuarded (used by 'Install and restart') asks first and only runs after Save or Don't save", async () => {
    await setup();
    const fn = vi.fn(async () => {});
    expect(await m.runGuarded("install the update", fn)).toBe(true); // clean: no question
    expect(fn).toHaveBeenCalledTimes(1);

    edit();
    let r = m.runGuarded("install the update", fn);
    expect(m.store.getState().confirm).toMatchObject({ kind: "unsaved", action: "install the update" });
    m.resolveConfirm("cancel");
    expect(await r).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);

    r = m.runGuarded("install the update", fn);
    m.resolveConfirm("save");
    expect(await r).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(mock.files.size).toBe(1); // saved before the restart
  });

  it("Open asks too, and a cancelled Save dialog stops the whole thing", async () => {
    await setup();
    edit();
    platform.saveProjectAs = async () => null;
    mock.pickProject = { path: "/p/a.lilo", name: "a.lilo", bytes: new Uint8Array() };
    const r = m.openDialog();
    await vi.waitFor(() => expect(m.store.getState().confirm).not.toBeNull());
    m.resolveConfirm("save");
    expect(await r).toBe(false);
    expect(ids()).toContain("c"); // still here
  });

  it("closing the window: clean closes; dirty asks; Don't save closes; Cancel stays", async () => {
    await setup();
    expect(await m.closeRequested()).toBe(true);
    edit();
    let r = m.closeRequested();
    expect(m.store.getState().confirm?.action).toBe("close");
    m.resolveConfirm("cancel");
    expect(await r).toBe(false);
    r = m.closeRequested();
    m.resolveConfirm("discard");
    expect(await r).toBe(true);
    r = m.closeRequested();
    m.resolveConfirm("save");
    expect(await r).toBe(true);
    expect(m.store.getState().dirty).toBe(false);
  });

  it("a files-opened-by-the-OS event goes through the guard as well", async () => {
    await setup();
    edit();
    const r = m.openFile({ path: "/p/a.lilo", name: "a.lilo", bytes: new Uint8Array(0) });
    expect(m.store.getState().confirm).not.toBeNull();
    m.resolveConfirm("cancel");
    expect(await r).toBe(false);
  });
});

describe("autosave and the version history", () => {
  it("snapshots the working state, skips unchanged content and keeps at most 50", async () => {
    await setup();
    await m.save();
    expect(m.store.getState().history).toHaveLength(1);
    await m.autosave();
    expect(m.store.getState().history).toHaveLength(1); // nothing changed
    edit();
    tick();
    await m.autosave();
    expect(m.store.getState().history).toHaveLength(2);
    await m.autosave();
    expect(m.store.getState().history).toHaveLength(2);
    for (let i = 0; i < 60; i++) {
      core.actions.addObjects([box(`x${i}`, 60 + i)], "Add");
      tick();
      await m.autosave();
    }
    expect(m.store.getState().history).toHaveLength(50);
  });

  it("writes the ring into the file but leaves the last explicit save as it was", async () => {
    await setup();
    await m.save();
    const path = m.store.getState().path!;
    edit();
    tick();
    await m.autosave();
    const { project } = loadProject(mock.files.get(path)!);
    expect(project.doc.design.objects.map((o) => o.id)).toEqual(["a", "b"]); // not "c": that was never saved
    expect(project.history).toHaveLength(2);
    const latest = JSON.parse(project.history[1].json) as { design: Design };
    expect(latest.design.objects.map((o) => o.id)).toEqual(["a", "b", "c"]);
    expect(m.store.getState().dirty).toBe(true); // still unsaved
  });

  it("keeps the ring in memory for a project that was never saved", async () => {
    await setup();
    edit();
    await m.autosave();
    expect(m.store.getState().history).toHaveLength(1);
    expect(mock.files.size).toBe(0);
    await m.save(); // the ring goes into the file with the first save; the same content is not recorded twice
    const { project } = loadProject(mock.files.get(m.store.getState().path!)!);
    expect(project.history).toHaveLength(1);
    expect(project.doc.design.objects.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("an autosave that cannot write does not throw, and the next one tries again", async () => {
    await setup();
    await m.save();
    edit();
    tick();
    const real = platform.writeProjectFile;
    platform.writeProjectFile = async () => {
      throw new Error("disk full");
    };
    await expect(m.autosave()).resolves.toBeUndefined();
    platform.writeProjectFile = real;
    edit("d");
    tick();
    await m.autosave();
    const { project } = loadProject(mock.files.get(m.store.getState().path!)!);
    expect(project.history.length).toBeGreaterThanOrEqual(2);
  });

  it("restoring a version is one undoable edit that keeps the working state in the history first", async () => {
    await setup();
    await m.save();
    const first = m.store.getState().history[0].id;
    edit("c");
    edit("d");
    tick();
    expect(ids()).toEqual(["a", "b", "c", "d"]);
    const undoDepth = st().undoLabel;
    expect(await m.restore(first)).toBe(true);
    expect(ids()).toEqual(["a", "b"]);
    expect(st().undoLabel).toBe("Restore version");
    expect(m.store.getState().history.length).toBe(2); // the state before restoring was kept
    core.actions.undo();
    expect(ids()).toEqual(["a", "b", "c", "d"]);
    expect(st().undoLabel).toBe(undoDepth);
    core.actions.redo();
    expect(ids()).toEqual(["a", "b"]);
  });

  it("restoring brings a pixel grid back through the pixel editor's own history", async () => {
    await setup();
    paint();
    await m.save();
    const id = m.store.getState().history[0].id;
    px.actions.clear();
    expect(px.store.getState().art.cells.some(Boolean)).toBe(false);
    await m.restore(id);
    const art: PixelArt = px.store.getState().art;
    expect(art.cells.filter(Boolean)).toHaveLength(2);
    px.actions.undo();
    expect(px.store.getState().art.cells.some(Boolean)).toBe(false);
  });

  it("an unknown version is refused", async () => {
    await setup();
    expect(await m.restore("nope")).toBe(false);
  });
});

describe("the Home gallery", () => {
  it("lists the projects in the folder, newest first, with the title and thumbnail from inside each file", async () => {
    await setup();
    edit();
    await m.save();
    await core.actions.loadDesign(design("q"), { name: "Second" });
    m.store.setState({ dirty: false, path: null });
    await m.save();
    await m.refreshRecent();
    const cards = m.store.getState().recent;
    expect(cards.map((c) => c.title)).toEqual(["Second", "Crest"]);
    expect(cards.every((c) => (c.thumbnail?.length ?? 0) > 100)).toBe(true);
    expect(m.store.getState().recentLoading).toBe(false);
  });

  it("a project opened from outside the default folder shows up in Recent", async () => {
    await setup();
    edit();
    await m.save();
    const bytes = [...mock.files.values()][0];
    mock.recents = [];
    const outside = "/Users/me/Downloads/Erin Signature.lilo";
    mock.files.set(outside, bytes);
    expect(await m.openFile({ path: outside, name: "Erin Signature.lilo", bytes })).toBe(true);
    await m.refreshRecent();
    const cards = m.store.getState().recent;
    expect(cards.map((c) => c.path)).toEqual([outside]);
    expect(cards[0].name).toBe("Erin Signature");
    expect(cards[0].error).toBeUndefined();
  });

  it("a file it cannot read shows as an error card, not a crash", async () => {
    await setup();
    mock.files.set("/mock/Documents/Lilo/bad.lilo", new Uint8Array([1, 2, 3]));
    mock.recents = [{ path: "/mock/Documents/Lilo/bad.lilo", name: "bad", modifiedMs: 1, sizeBytes: 3 }];
    await m.refreshRecent();
    expect(m.store.getState().recent[0].error).toBeTruthy();
  });

  it("is empty in the browser", async () => {
    await setup("browser");
    await m.refreshRecent();
    expect(m.store.getState().recent).toEqual([]);
  });
});

describe("stitch files (PES, DST, ...)", () => {
  const stitchFile = (ext = "pes", name = "rooster") => ({ name: `${name}.${ext}`, bytes: designToEmbroidery(sampleDesign(), ext as "pes", { label: name }).bytes });
  const asOpened = (f: { name: string; bytes: Uint8Array }) => ({ path: "", name: f.name, bytes: f.bytes });
  const layers = () => st().design!.layers ?? [];
  const nameAfterRender = (d: Design) => d.layers?.map((l) => l.name);

  it("opening one makes a NEW untitled project named after the file, with one layer of the same name", async () => {
    await setup();
    const f = stitchFile();
    expect(await m.openFile(asOpened(f))).toBe(true);
    expect(st().projectName).toBe("rooster");
    expect(nameAfterRender(st().design!)).toEqual(["rooster"]);
    expect(st().design!.objects.length).toBeGreaterThan(0);
    expect(st().design!.objects.every((o) => o.layerId === layers()[0].id)).toBe(true);
    expect(st().design!.threads.length).toBeGreaterThan(0);
    expect(st().canUndo).toBe(false);
    const p = m.store.getState();
    expect(p.path).toBeNull();
    expect(p.dirty).toBe(true); // nothing saved yet: closing asks first
    expect(p.notice).toBeNull();
  });

  it("the first Save is a Save As into the projects folder as a .lilo; the stitch file is never written or remembered", async () => {
    await setup();
    mock.files.clear();
    mock.recents = [];
    await m.openFile({ path: "", name: "rooster.pes", bytes: stitchFile().bytes });
    expect(await m.save()).toBe(true);
    const path = m.store.getState().path!;
    expect(path).toBe("/mock/Documents/Lilo/rooster.lilo");
    expect([...mock.files.keys()]).toEqual([path]);
    expect(mock.recents.map((r) => r.path)).toEqual([path]); // only the saved .lilo is recorded, never the .pes
    expect(m.store.getState().dirty).toBe(false);
    // and it comes back with the stitches still exact
    const again = loadProject(mock.files.get(path)!).project.doc.design;
    expect(again.objects.every((o) => o.kind === "run" && o.params.exact === true)).toBe(true);
  });

  it("a cancelled first Save leaves it unsaved and writes nothing", async () => {
    await setup();
    mock.files.clear();
    await m.openFile(asOpened(stitchFile()));
    platform.saveProjectAs = async () => null;
    expect(await m.save()).toBe(false);
    expect(mock.files.size).toBe(0);
    expect(m.store.getState().dirty).toBe(true);
  });

  it("opening through the Open dialog, Home and the OS all end up in the same place", async () => {
    await setup();
    mock.pickProject = asOpened(stitchFile("dst", "crest-dst"));
    expect(await m.openDialog()).toBe(true);
    expect(st().projectName).toBe("crest-dst");
    m.store.setState({ dirty: false });
    expect(await m.openFile(asOpened(stitchFile("jef", "from-finder")))).toBe(true); // what the OS hands over
    expect(st().projectName).toBe("from-finder");
    expect(nameAfterRender(st().design!)).toEqual(["from-finder"]);
  });

  it("asks about unsaved changes before replacing the open design; Cancel changes nothing", async () => {
    await setup();
    edit();
    const before = st().design;
    const p = m.openFile(asOpened(stitchFile()));
    await vi.waitFor(() => expect(m.store.getState().confirm).not.toBeNull());
    m.resolveConfirm("cancel");
    expect(await p).toBe(false);
    expect(st().design).toBe(before);
  });

  it("a damaged file says so in plain words, changes nothing and does not even ask about unsaved changes", async () => {
    await setup();
    edit();
    const before = st().design;
    expect(await m.openFile({ path: "", name: "broken.pes", bytes: new Uint8Array([1, 2, 3, 4]) })).toBe(false);
    expect(m.store.getState().notice).toEqual({ kind: "error", text: "Lilo couldn't read this file \u2014 it may be damaged or a format we don't support." });
    expect(m.store.getState().confirm).toBeNull();
    expect(st().design).toBe(before);
  });

  it("dropped on a design that is open it becomes a new layer on top, in one undo step, and the design stays", async () => {
    await setup();
    const was = st().design!;
    const wasLayers = layers().map((l) => l.id);
    expect(await m.addStitchFile(stitchFile())).toBe(true);
    const d = st().design!;
    expect(d.layers!.length).toBe(wasLayers.length + 1);
    expect(d.layers!.slice(0, -1).map((l) => l.id)).toEqual(wasLayers);
    const top = d.layers![d.layers!.length - 1];
    expect(top.name).toBe("rooster");
    expect(top.kind).toBe("stitch");
    expect(st().activeLayerId).toBe(top.id);
    // the old shapes are untouched; the new ones sit after them, all in the new layer
    expect(d.objects.slice(0, was.objects.length).map((o) => o.id)).toEqual(was.objects.map((o) => o.id));
    const added = d.objects.slice(was.objects.length);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((o) => o.layerId === top.id)).toBe(true);
    expect(st().projectName).toBe("Crest");
    expect(st().undoLabel).toBe("Import rooster");
    core.actions.undo();
    expect(st().design!.objects.map((o) => o.id)).toEqual(was.objects.map((o) => o.id));
    expect(st().design!.layers?.length ?? wasLayers.length).toBe(wasLayers.length);
    expect(st().canUndo).toBe(false); // exactly one step
  });

  it("dropping the same file twice names the second layer apart", async () => {
    await setup();
    await m.addStitchFile(stitchFile());
    await m.addStitchFile(stitchFile());
    expect(layers().map((l) => l.name).slice(-2)).toEqual(["rooster", "rooster 2"]);
  });

  it("dropped on an empty canvas it opens as the design", async () => {
    await setup();
    await core.actions.loadDesign(emptyDesign(), { name: "Untitled design" });
    m.store.setState({ dirty: false });
    expect(await m.addStitchFile(stitchFile())).toBe(true);
    expect(st().projectName).toBe("rooster");
    expect(m.store.getState().path).toBeNull();
  });

  it("dropped on a design that only has reference pictures it becomes a layer and the pictures stay", async () => {
    await setup();
    const pic = { id: "img1", name: "ref.png", mime: "image/png", w: 10, h: 10, x: 0, y: 0, widthMm: 20, opacity: 0.5, locked: false, visible: true };
    await core.actions.loadDesign({ ...emptyDesign(), images: [pic] }, { name: "Traced" });
    m.store.setState({ dirty: false });
    expect(await m.addStitchFile(stitchFile())).toBe(true);
    expect(st().projectName).toBe("Traced");
    expect(st().design!.images?.map((i) => i.id)).toEqual(["img1"]);
    expect(st().design!.objects.length).toBeGreaterThan(0);
  });

  it("a damaged file dropped on a design shows the same plain message and leaves the design alone", async () => {
    await setup();
    const before = st().design;
    expect(await m.addStitchFile({ name: "broken.dst", bytes: new Uint8Array(10) })).toBe(false);
    expect(m.store.getState().notice?.text).toMatch(/couldn't read this file/);
    expect(st().design).toBe(before);
  });
});
