import { applyPatches, enablePatches, produceWithPatches, setAutoFreeze, type Patch } from "immer";
import { createStore, type StoreApi } from "zustand/vanilla";
import {
  CATALOGUES,
  DEFAULT_CATALOGUE_ID,
  DEFAULT_MAP_OPTIONS,
  DEFAULT_REGION_SETTINGS,
  applyMapGroup,
  autoRedwork,
  designBounds,
  detachMapGroup,
  duplicateObjects,
  emptyDesign,
  ensureThread,
  fillToOutline,
  flipH,
  flipV,
  getCatalogue,
  makeIdGen,
  objectBox,
  outlineToFill,
  resizeAbout,
  regionToObjects,
  rotation,
  shelfPalette,
  toDesignThread,
  transformObject,
  translation,
  unionBox,
  type Affine,
  type Box,
  type Design,
  type DesignImage,
  type DesignObject,
  type Hoop,
  type MapToPathOptions,
  type Pt,
  type RegionStitchSettings,
  type RunObject,
  type Shelf,
  type Thread,
  type TraceRegion,
} from "@lilo/engine/light";
import type { AutoDigitizeOptions, FabricId, ImageDataLike, PaletteChip, Quality, StageEvent, ThreadWeight, UnitsToMm } from "@lilo/engine";
import type { EngineClient, DigitizeResponse, PlanResult } from "../engine/client";
import { decodeFile, type DecodedImport } from "../io/decode";
import type { ToolId } from "../tools/registry";
import { moveGroup, moveObject, setGroupVisible, setObjectVisible } from "./reorder";
import { getShelf } from "./shelfStore";
import { expandTextGroups, nextTextGroup, pruneTextBlocks, transformTextBlocks } from "./textGroups";

enablePatches();
// Designs are passed to the engine worker and to stitchjs/jsts; nothing should mutate them, but
// freezing them recursively on every edit is wasted work.
setAutoFreeze(false);

/** What the Auto-digitize panel controls. `null` sizes mean "auto" (longest side 60 mm). */
export interface DigitizeUiOptions {
  colors: number;
  catalogueId: string;
  widthMm: number | null;
  heightMm: number | null;
  aspectLock: boolean;
  minRegionMm2: number;
  removeBackground: boolean;
  /** Sewing setup (see the engine's `resolveSewingSetup`): Premium follows what a professional digitizer would do. */
  quality: Quality;
  threadWeight: ThreadWeight;
  fabric: FabricId;
  /** Snap colours to My Threads first (the brand above is the fallback when the shelf is empty). */
  useMyThreads: boolean;
}

export const DEFAULT_UI_OPTIONS: DigitizeUiOptions = {
  colors: 6,
  catalogueId: DEFAULT_CATALOGUE_ID,
  widthMm: null,
  heightMm: null,
  aspectLock: true,
  minRegionMm2: 2,
  removeBackground: true,
  quality: "standard",
  threadWeight: 40,
  fabric: "suiting",
  useMyThreads: false,
};

export type Status = { kind: "idle" } | { kind: "working"; stage: string } | { kind: "error"; message: string };

export interface SourceInfo {
  name: string;
  kind: "raster" | "svg";
  /** Pixel (or SVG user-unit) size of what the engine sees. */
  width: number;
  height: number;
  /** What the canvas draws behind the stitches. */
  reference: HTMLCanvasElement | HTMLImageElement | null;
}

/** Intermediate pipeline output, kept for the tracing animation. */
export interface Stages {
  quantized: ImageDataLike | null;
  palette: PaletteChip[];
  imageToMm: UnitsToMm | null;
}

export interface ViewToggles {
  realistic: boolean;
  grid: boolean;
  reference: boolean;
  jumps: boolean;
}

/** A picture placed behind the stitches to trace over. Lives in the editor, not in the Design. */
export interface RefImage {
  id: string;
  name: string;
  src: HTMLCanvasElement | HTMLImageElement;
  /** Natural size in px (aspect ratio). */
  w: number;
  h: number;
  /** Top-left corner in mm. */
  x: number;
  y: number;
  widthMm: number;
  opacity: number;
  locked: boolean;
  visible: boolean;
}

/** What the shape actions are doing right now (the contextual toolbar sets these). */
export type ShapeMode = "none" | "reshape" | "knife" | "hole" | "setStart" | "setEnd" | "angle" | "pickPath" | "guide";

export interface MapDraft {
  /** Ids of the objects being repeated (originals), or of the existing group's copies when re-editing. */
  sourceIds: string[];
  /** Id of the open run used as the path, if it is a design object. */
  pathId: string | null;
  /** The path, if it was drawn for this mapping. */
  path: Pt[] | null;
  /** Group being edited (copies already exist). */
  groupId: string | null;
  options: MapToPathOptions;
}

export type Dialog = "export" | "send" | "history" | null;

export type SeqTab = "shapes" | "colours" | "images" | "threads";

export interface EditorState {
  projectName: string;
  source: SourceInfo | null;
  options: DigitizeUiOptions;
  status: Status;
  stages: Stages;
  design: Design | null;
  planResult: PlanResult | null;
  palette: PaletteChip[];
  /** Where the source image sits relative to the design, for the reference layer. */
  placement: { imageToMm: UnitsToMm; origin: [number, number]; width: number; height: number } | null;
  /** Last selected id (kept for single-selection code); `selectedIds` is the truth. */
  selectedId: string | null;
  selectedIds: string[];
  /** Bumped for every fresh digitize result, so the canvas can play the tracing animation. */
  animationKey: number;
  view: ViewToggles;

  tool: ToolId;
  mode: ShapeMode;
  /** Thread new shapes are drawn in. */
  threadId: string | null;
  units: "mm" | "in";
  aspectLock: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  refImages: RefImage[];
  selectedImageId: string | null;
  seqTab: SeqTab;
  paletteOpen: boolean;
  /** Which top-level dialog is open (opened from the top bar or the command palette). */
  dialog: Dialog;
  mapDraft: MapDraft | null;
  /** Where the Text tool was last clicked: new text is placed centred here. */
  textAnchor: Pt | null;
  /** True while a re-stitch is pending or running. */
  planning: boolean;
  /** The last trace, kept for click-to-stitch (shared with the automatic result: no second trace). */
  trace: TraceState | null;
  /** How click-to-stitch sews the regions it is given. */
  stitchSettings: RegionStitchSettings;
  /** Region id -> ids of the objects click-to-stitch made from it. Valid while those objects exist. */
  regionObjects: Record<string, string[]>;
  /** Regions shift-clicked and waiting for Enter. */
  pendingRegions: string[];
}

export interface TraceState {
  regions: TraceRegion[];
  /** The raw traced SVG (pixel units), for saving as SVG. */
  svg: string;
  /** Name of the picture it came from. */
  source: string;
}

export const initialState: EditorState = {
  projectName: "Untitled design",
  source: null,
  options: DEFAULT_UI_OPTIONS,
  status: { kind: "idle" },
  stages: { quantized: null, palette: [], imageToMm: null },
  design: null,
  planResult: null,
  palette: [],
  placement: null,
  selectedId: null,
  selectedIds: [],
  animationKey: 0,
  view: { realistic: true, grid: true, reference: true, jumps: true },
  tool: "select",
  mode: "none",
  threadId: null,
  units: "mm",
  aspectLock: true,
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
  refImages: [],
  selectedImageId: null,
  seqTab: "shapes",
  paletteOpen: false,
  dialog: null,
  mapDraft: null,
  textAnchor: null,
  planning: false,
  trace: null,
  stitchSettings: DEFAULT_REGION_SETTINGS,
  regionObjects: {},
  pendingRegions: [],
};

/** Turn UI options into engine options. `shelf` feeds "Use my threads" (an empty shelf means the brand is used). */
export function toEngineOptions(o: DigitizeUiOptions, shelf: Shelf = getShelf()): Partial<AutoDigitizeOptions> {
  return {
    ...(o.useMyThreads && shelf.entries.length > 0 ? { threads: shelfPalette(shelf) } : {}),
    colors: o.colors,
    catalogueId: o.catalogueId,
    widthMm: o.widthMm ?? undefined,
    heightMm: o.heightMm ?? undefined,
    minRegionMm2: o.minRegionMm2,
    removeBackground: o.removeBackground,
    setup: { quality: o.quality, threadWeight: o.threadWeight, fabric: o.fabric },
  };
}

interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  selBefore: string[];
  selAfter: string[];
  key?: string;
  at: number;
}

export interface CommitOptions {
  /** Edits sharing a key merge into one undo step while they are consecutive. */
  merge?: string;
  /** ...but only if the previous one was this recent (ms). Omit for "until another edit happens" (drags). */
  mergeWithinMs?: number;
  /** Selection after the edit (default: keep, minus anything that no longer exists). */
  select?: string[] | (() => string[]);
  /** The edit doesn't change the stitches (reference images): skip the re-stitch. */
  noPlan?: boolean;
}

const MAX_HISTORY = 200;
const PLAN_DEBOUNCE_MS = 150;

export interface EditorActions {
  setName(name: string): void;
  setOptions(patch: Partial<DigitizeUiOptions>): void;
  setView(patch: Partial<ViewToggles>): void;
  /** Select one object (or none). */
  select(id: string | null): void;
  setSelection(ids: string[]): void;
  selectAll(): void;
  /** Decode a dropped/picked file and digitize it. */
  importFile(file: { name: string; bytes: Uint8Array; type?: string }): Promise<void>;
  digitize(): Promise<void>;
  reorderObject(from: number, before: number): void;
  reorderGroup(group: number, before: number): void;
  toggleObject(id: string, visible: boolean): void;
  toggleGroup(group: number, visible: boolean): void;
  /**
   * Replace the design directly (opening a project, tests), clearing undo history. `images` are the
   * bytes of the design's reference images by id; `name` becomes the project name.
   */
  loadDesign(design: Design, opts?: { name?: string; images?: Record<string, { bytes: Uint8Array; mime: string }> }): Promise<void>;
  /** Bytes of the reference images the design uses, for saving into the project file. */
  imageAssets(): { id: string; name: string; mime: string; bytes: Uint8Array }[];

  // ---- editing --------------------------------------------------------------------------------
  /** Edit the design through an Immer recipe; one undo step (or merged, see `CommitOptions`). */
  commit(label: string, recipe: (draft: Design) => void, opts?: CommitOptions): boolean;
  undo(): void;
  redo(): void;
  /** End a merged group (e.g. at pointer-up) so the next edit starts a new undo step. */
  endGroup(): void;
  setTool(tool: ToolId): void;
  setTextAnchor(p: Pt | null): void;
  setMode(mode: ShapeMode): void;
  setThread(threadId: string): void;
  setUnits(u: "mm" | "in"): void;
  setAspectLock(on: boolean): void;
  setPaletteOpen(open: boolean): void;
  setDialog(dialog: Dialog): void;
  setSeqTab(tab: SeqTab): void;

  addObjects(objects: DesignObject[], label: string): void;
  /**
   * Drop objects made elsewhere (an imported embroidery file, the pixel-art editor) into the design as
   * one undo step. They get fresh ids, their threads are added, and with `centreOnDesign` they are
   * centred on what is already there (on 0,0 for an empty design).
   */
  placeObjects(objects: readonly DesignObject[], threads: readonly Thread[], label: string, opts?: { centreOnDesign?: boolean }): void;
  /** Change objects by id through a recipe on each; one undo step. */
  updateObjects(ids: readonly string[], label: string, recipe: (o: DesignObject) => void, opts?: CommitOptions): void;
  replaceObject(id: string, pieces: DesignObject[], label: string): void;
  transformSelection(m: Affine, label: string, opts?: CommitOptions): void;
  transformObjects(ids: readonly string[], m: Affine, label: string, opts?: CommitOptions): void;
  nudgeSelection(dx: number, dy: number): void;
  flipSelection(axis: "h" | "v"): void;
  rotateSelection(deg: number): void;
  /** Resize the selection to w x h mm about its top-left. */
  resizeSelection(w: number, h: number, opts?: CommitOptions): void;
  duplicateSelection(): void;
  deleteSelection(): void;
  toggleLockSelection(): void;
  rename(id: string, name: string): void;
  setObjectThread(ids: readonly string[], thread: Thread): void;
  setHoop(hoop: Hoop): void;
  convertSelectionOutline(): void;
  redworkSelection(): void;
  knife(a: Pt, b: Pt): Promise<void>;
  cutHole(hole: Pt[]): Promise<void>;
  /** Merge every object of colour `from` into colour `to`. */
  mergeColours(fromThreadId: string, to: Thread): void;
  /** Reorder objects so each colour is stitched in one block (keeps the order of first appearance). */
  groupByColour(): void;

  // ---- map to path ----------------------------------------------------------------------------
  openMapDraft(draft?: Partial<MapDraft>): void;
  updateMapDraft(patch: Partial<MapToPathOptions>): void;
  setMapPath(path: Pt[]): void;
  closeMapDraft(): void;
  applyMapDraft(): void;
  detachMap(groupId: string): void;

  // ---- click-to-stitch ------------------------------------------------------------------------
  setStitchSettings(patch: Partial<RegionStitchSettings>): void;
  /** Stitch these traced regions with the current settings: one undo step. */
  stitchRegions(ids: readonly string[]): void;
  /** Shift-click: add or remove a region from the batch waiting for Enter. */
  togglePendingRegion(id: string): void;
  clearPendingRegions(): void;
  /** Stitch the batch in one undo step. */
  stitchPending(): void;
  /** Remove every object (the automatic result) so click-to-stitch can start from the bare trace: one undo step. */
  clearStitches(): void;

  // ---- reference images (part of the design: saved in the project, undoable) -------------------
  addRefImage(file: { name: string; bytes: Uint8Array; type?: string }): Promise<void>;
  updateRefImage(id: string, patch: Partial<Omit<RefImage, "id" | "src">>): void;
  moveRefImage(id: string, dir: -1 | 1): void;
  removeRefImage(id: string): void;
  selectRefImage(id: string | null): void;
}

export interface EditorStore {
  store: StoreApi<EditorState>;
  actions: EditorActions;
  /** Stop timers and ignore in-flight engine results. Reversible with `activate` (React StrictMode mounts effects twice). */
  dispose(): void;
  activate(): void;
}

/** The default thread for new shapes: Brother black, else the catalogue's first colour. */
export function defaultThread(): Thread {
  const cat = getCatalogue();
  return toDesignThread(cat.threads.find((t) => t.name.toLowerCase() === "black") ?? cat.threads[0]);
}

let threadIndex: Map<string, Thread> | null = null;
const index = (): Map<string, Thread> => {
  if (!threadIndex) {
    threadIndex = new Map();
    for (const c of CATALOGUES) for (const t of c.threads) threadIndex.set(toDesignThread(t).id, toDesignThread(t));
  }
  return threadIndex;
};
/** Look a thread up by id: the eager catalogues, plus anything the picker has loaded or registered since. */
export function findThread(id: string): Thread | null {
  return index().get(id) ?? null;
}
/** Make a thread from a lazily loaded line (or My Threads) findable by id, e.g. as the drawing colour. */
export function registerThread(t: Thread): void {
  index().set(t.id, t);
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The picture of a reference image, or null when it can't be decoded (the placement is kept anyway). */
async function decodeAsset(bytes: Uint8Array, mime: string, name: string): Promise<HTMLCanvasElement | HTMLImageElement | null> {
  try {
    return (await decodeFile({ name, bytes, type: mime })).reference;
  } catch {
    return null;
  }
}

/** Selection box of the given objects in `design`. */
export function selectionBox(design: Design | null, ids: readonly string[]): Box | null {
  if (!design) return null;
  const set = new Set(ids);
  return unionBox(design.objects.filter((o) => set.has(o.id)).map(objectBox));
}

export function createEditorStore(engine: EngineClient): EditorStore {
  const store = createStore<EditorState>(() => ({ ...initialState }));
  const get = store.getState;
  const set = store.setState;

  let decoded: DecodedImport | null = null;
  let runId = 0;
  let planId = 0;
  let planTimer: ReturnType<typeof setTimeout> | null = null;
  let digitizeTimer: ReturnType<typeof setTimeout> | null = null;
  let undoStack: HistoryEntry[] = [];
  let redoStack: HistoryEntry[] = [];
  let openKey: string | null = null;
  let disposed = false;

  const syncHistory = () =>
    set({
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      undoLabel: undoStack[undoStack.length - 1]?.label ?? null,
      redoLabel: redoStack[redoStack.length - 1]?.label ?? null,
    });
  const resetHistory = () => {
    undoStack = [];
    redoStack = [];
    openKey = null;
    syncHistory();
  };

  // ---- reference images: placements live in the design, pixels in `assets` -----------------------
  interface ImageAsset {
    bytes: Uint8Array;
    mime: string;
    src: HTMLCanvasElement | HTMLImageElement;
  }
  const assets = new Map<string, ImageAsset>();
  let refsFor: DesignImage[] | undefined;
  let refsMemo: RefImage[] = [];
  let refsAssets = -1;
  let assetVersion = 0;
  /** `state.refImages` for a design: the same array while neither the placements nor the pixels change. */
  const refsOf = (design: Design | null): RefImage[] => {
    const list = design?.images;
    if (list === refsFor && refsAssets === assetVersion) return refsMemo;
    refsFor = list;
    refsAssets = assetVersion;
    refsMemo = (list ?? []).flatMap((m) => {
      const a = assets.get(m.id);
      return a ? [{ id: m.id, name: m.name, src: a.src, w: m.w, h: m.h, x: m.x, y: m.y, widthMm: m.widthMm, opacity: m.opacity, locked: m.locked, visible: m.visible }] : [];
    });
    return refsMemo;
  };
  /** Everything that follows from a new design value, to be spread into `set`. */
  const designState = (design: Design | null): Pick<EditorState, "design" | "refImages" | "selectedImageId"> => {
    const refImages = refsOf(design);
    const sel = get().selectedImageId;
    return { design, refImages, selectedImageId: sel && refImages.some((r) => r.id === sel) ? sel : null };
  };

  // ---- planning (live re-stitch) -------------------------------------------------------------
  const runPlan = async () => {
    planTimer = null;
    const d = get().design;
    if (!d || disposed) return;
    const id = ++planId;
    try {
      const planResult = await engine.plan(d);
      if (id === planId && !disposed) set({ planResult, planning: false });
    } catch (e) {
      if (id === planId && !disposed) set({ status: { kind: "error", message: errMsg(e) }, planning: false });
    }
  };
  const schedulePlan = (immediate = false) => {
    if (planTimer) clearTimeout(planTimer);
    set({ planning: true });
    planTimer = setTimeout(() => void runPlan(), immediate ? 0 : PLAN_DEBOUNCE_MS);
  };

  // ---- selection helpers ---------------------------------------------------------------------
  const existing = (design: Design | null, ids: readonly string[]) => {
    if (!design) return [];
    const have = new Set(design.objects.map((o) => o.id));
    return ids.filter((i) => have.has(i));
  };
  const setSel = (rawIds: string[], extra: Partial<EditorState> = {}) => {
    const ids = expandTextGroups(get().design, rawIds);
    const same = ids.length === get().selectedIds.length && ids.every((i, k) => i === get().selectedIds[k]);
    set({
      selectedIds: ids,
      selectedId: ids[ids.length - 1] ?? null,
      ...(same ? {} : { mode: "none" as ShapeMode }),
      ...extra,
    });
  };
  const selectedObjects = (): DesignObject[] => {
    const s = get();
    const set = new Set(s.selectedIds);
    return s.design?.objects.filter((o) => set.has(o.id)) ?? [];
  };

  // ---- the commit/undo core ------------------------------------------------------------------
  const commit: EditorActions["commit"] = (label, recipe, opts = {}) => {
    let design = get().design;
    if (!design) {
      design = emptyDesign();
      set({ design });
    }
    const [next, patches, inverse] = produceWithPatches(design, recipe);
    if (patches.length === 0) return false;
    const selBefore = get().selectedIds;
    const selAfter = typeof opts.select === "function" ? opts.select() : (opts.select ?? existing(next, selBefore));
    const now = Date.now();
    const last = undoStack[undoStack.length - 1];
    const canMerge =
      !!opts.merge &&
      !!last &&
      last.key === opts.merge &&
      openKey === opts.merge &&
      (opts.mergeWithinMs === undefined || now - last.at <= opts.mergeWithinMs);
    if (canMerge && last) {
      last.patches = [...last.patches, ...patches];
      last.inverse = [...inverse, ...last.inverse];
      last.selAfter = selAfter;
      last.at = now;
    } else {
      undoStack.push({ label, patches, inverse, selBefore, selAfter, key: opts.merge, at: now });
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
    }
    openKey = opts.merge ?? null;
    redoStack = [];
    set(designState(next));
    setSel(selAfter);
    syncHistory();
    if (!opts.noPlan) schedulePlan();
    return true;
  };

  const undo = () => {
    const e = undoStack.pop();
    const d = get().design;
    if (!e || !d) return;
    const next = applyPatches(d, e.inverse);
    redoStack.push(e);
    openKey = null;
    set(designState(next));
    setSel(existing(next, e.selBefore));
    syncHistory();
    schedulePlan();
  };
  const redo = () => {
    const e = redoStack.pop();
    const d = get().design;
    if (!e || !d) return;
    const next = applyPatches(d, e.patches);
    undoStack.push(e);
    openKey = null;
    set(designState(next));
    setSel(existing(next, e.selAfter));
    syncHistory();
    schedulePlan();
  };

  // ---- digitize (M2) -------------------------------------------------------------------------
  const runDigitize = async () => {
    const d = decoded;
    if (!d) return;
    const id = ++runId;
    set({ status: { kind: "working", stage: "Starting" } });
    try {
      const source =
        d.kind === "raster"
          ? { kind: "raster" as const, image: { width: d.image.width, height: d.image.height, data: new Uint8ClampedArray(d.image.data) } }
          : { kind: "svg" as const, text: d.text };
      const result: DigitizeResponse = await engine.digitize(source, toEngineOptions(get().options), (event: StageEvent) => {
        if (id !== runId) return;
        if (event.stage === "prep") set({ status: { kind: "working", stage: "Preparing image" } });
        else if (event.stage === "quantize") set((s) => ({ status: { kind: "working", stage: "Matching threads" }, stages: { ...s.stages, quantized: event.image, palette: event.palette } }));
        else if (event.stage === "trace") set((s) => ({ status: { kind: "working", stage: "Tracing" }, stages: { ...s.stages, imageToMm: event.imageToMm } }));
        else if (event.stage === "cleanup") set({ status: { kind: "working", stage: "Planning stitches" } });
      });
      if (id !== runId) return;
      resetHistory();
      planId++; // a pending re-stitch of the previous design is now moot
      // a fresh result replaces the stitches, not the pictures the user placed behind them
      const images = get().design?.images;
      set((s) => ({
        status: { kind: "idle" },
        ...designState(images?.length ? { ...result.design, images } : result.design),
        planResult: { plan: result.plan, stats: result.stats, warnings: result.warnings },
        palette: result.palette,
        placement: { imageToMm: result.imageToMm, origin: result.imageOrigin, width: result.imageWidth, height: result.imageHeight },
        animationKey: s.animationKey + 1,
        mapDraft: null,
        trace: { regions: result.traceRegions, svg: result.svg, source: s.source?.name ?? "" },
        regionObjects: {},
        pendingRegions: [],
      }));
      setSel([]);
    } catch (e) {
      if (id === runId) set({ status: { kind: "error", message: errMsg(e) } });
    }
  };

  // ---- reference images ----------------------------------------------------------------------
  let imageSeq = 0;

  // ---- actions -------------------------------------------------------------------------------
  const actions: EditorActions = {
    setName: (projectName) => set({ projectName }),
    setOptions(patch) {
      set((s) => ({ options: { ...s.options, ...patch } }));
      // Live result: once something is digitized, option changes re-run it after a short pause.
      if (decoded) {
        if (digitizeTimer) clearTimeout(digitizeTimer);
        digitizeTimer = setTimeout(() => void runDigitize(), 450);
      }
    },
    setView: (patch) => set((s) => ({ view: { ...s.view, ...patch } })),
    select: (id) => setSel(id ? [id] : []),
    setSelection: (ids) => setSel(existing(get().design, ids)),
    selectAll: () => setSel((get().design?.objects ?? []).filter((o) => o.visible !== false).map((o) => o.id)),

    async importFile(file) {
      const id = ++runId;
      set({ status: { kind: "working", stage: "Reading file" } });
      try {
        const d = await decodeFile(file);
        decoded = d;
        set({
          source: { name: file.name, kind: d.kind, width: d.kind === "raster" ? d.image.width : 0, height: d.kind === "raster" ? d.image.height : 0, reference: d.reference },
          stages: { quantized: null, palette: [], imageToMm: null },
          projectName: file.name.replace(/\.[^.]+$/, ""),
        });
        setSel([]);
      } catch (e) {
        if (id === runId) set({ status: { kind: "error", message: errMsg(e) } });
        return;
      }
      await runDigitize();
    },
    digitize: runDigitize,

    reorderObject(from, before) {
      const d = get().design;
      if (!d) return;
      const next = moveObject(d, from, before);
      if (next !== d) commit("Reorder", (draft) => void (draft.objects = next.objects));
    },
    reorderGroup(group, before) {
      const d = get().design;
      if (!d) return;
      const next = moveGroup(d, group, before);
      if (next !== d) commit("Reorder colour block", (draft) => void (draft.objects = next.objects));
    },
    toggleObject(id, visible) {
      const d = get().design;
      if (d) commit(visible ? "Show" : "Hide", (draft) => void (draft.objects = setObjectVisible(d, id, visible).objects));
    },
    toggleGroup(group, visible) {
      const d = get().design;
      if (d) commit(visible ? "Show colour block" : "Hide colour block", (draft) => void (draft.objects = setGroupVisible(d, group, visible).objects));
    },
    async loadDesign(design, opts = {}) {
      const planResult = await engine.plan(design);
      // a new document: the old one's picture to digitize and reference pixels don't carry over
      decoded = null;
      if (digitizeTimer) clearTimeout(digitizeTimer);
      runId++;
      assets.clear();
      assetVersion++;
      if (opts.images) {
        for (const [id, a] of Object.entries(opts.images)) {
          const src = await decodeAsset(a.bytes, a.mime, design.images?.find((m) => m.id === id)?.name ?? id);
          if (src) assets.set(id, { bytes: a.bytes, mime: a.mime, src });
        }
        assetVersion++;
      }
      resetHistory();
      planId++;
      set({
        ...designState(design),
        planResult,
        status: { kind: "idle" },
        source: null,
        stages: { quantized: null, palette: [], imageToMm: null },
        palette: [],
        placement: null,
        mapDraft: null,
        planning: false,
        trace: null,
        regionObjects: {},
        pendingRegions: [],
        ...(opts.name !== undefined ? { projectName: opts.name } : {}),
      });
      setSel([]);
    },
    imageAssets() {
      return (get().design?.images ?? []).flatMap((m) => {
        const a = assets.get(m.id);
        return a ? [{ id: m.id, name: m.name, mime: a.mime, bytes: a.bytes }] : [];
      });
    },

    commit,
    undo,
    redo,
    endGroup: () => {
      openKey = null;
    },
    setTool: (tool) => set({ tool, mode: "none", textAnchor: null }),
    setTextAnchor: (textAnchor) => set({ textAnchor }),
    setMode: (mode) => set({ mode }),
    setThread: (threadId) => set({ threadId }),
    setUnits: (units) => set({ units }),
    setAspectLock: (aspectLock) => set({ aspectLock }),
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    setDialog: (dialog) => set({ dialog }),
    setSeqTab: (seqTab) => set({ seqTab }),

    addObjects(objects, label) {
      if (objects.length === 0) return;
      const threadFor = (id: string): Thread | null => get().design?.threads.find((t) => t.id === id) ?? findThread(id);
      commit(
        label,
        (d) => {
          for (const o of objects) {
            const t = threadFor(o.threadId);
            if (t) ensureThread(d, t);
            d.objects.push(o);
          }
        },
        { select: objects.map((o) => o.id) },
      );
    },
    placeObjects(objects, threads, label, opts = {}) {
      if (objects.length === 0) return;
      const d0 = get().design;
      const nextId = makeIdGen(d0 ?? emptyDesign());
      let dx = 0;
      let dy = 0;
      if (opts.centreOnDesign) {
        const ob = unionBox(objects.map(objectBox));
        const b = d0 && d0.objects.length ? designBounds(d0) : null;
        if (ob) {
          const [tx, ty] = b ? [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] : [0, 0];
          dx = tx - (ob.minX + ob.maxX) / 2;
          dy = ty - (ob.minY + ob.maxY) / 2;
        }
      }
      const placed = objects.map((o) => ({ ...(dx || dy ? transformObject(o, translation(dx, dy)) : o), id: nextId() }));
      commit(
        label,
        (d) => {
          for (const t of threads) ensureThread(d, t);
          d.objects.push(...placed);
        },
        { select: placed.map((o) => o.id) },
      );
    },
    updateObjects(ids, label, recipe, opts) {
      const set = new Set(ids);
      commit(
        label,
        (d) => {
          for (const o of d.objects) if (set.has(o.id)) recipe(o);
        },
        opts,
      );
    },
    replaceObject(id, pieces, label) {
      commit(
        label,
        (d) => {
          const i = d.objects.findIndex((o) => o.id === id);
          if (i >= 0) d.objects.splice(i, 1, ...pieces);
        },
        { select: pieces.map((p) => p.id) },
      );
    },
    transformObjects(ids, m, label, opts) {
      const set = new Set(ids);
      commit(
        label,
        (d) => {
          transformTextBlocks(d, set, m);
          d.objects = d.objects.map((o) => (set.has(o.id) && !o.locked ? transformObject(o, m) : o));
        },
        opts,
      );
    },
    transformSelection(m, label, opts) {
      actions.transformObjects(get().selectedIds, m, label, opts);
    },
    nudgeSelection(dx, dy) {
      actions.transformSelection(translation(dx, dy), "Nudge", { merge: "nudge", mergeWithinMs: 700 });
    },
    flipSelection(axis) {
      const b = selectionBox(get().design, get().selectedIds);
      if (!b) return;
      actions.transformSelection(axis === "h" ? flipH((b.minX + b.maxX) / 2) : flipV((b.minY + b.maxY) / 2), axis === "h" ? "Flip horizontally" : "Flip vertically");
    },
    rotateSelection(deg) {
      const b = selectionBox(get().design, get().selectedIds);
      if (!b) return;
      actions.transformSelection(rotation((deg * Math.PI) / 180, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2), "Rotate");
    },
    resizeSelection(w, h, opts) {
      const b = selectionBox(get().design, get().selectedIds);
      if (!b || w <= 0 || h <= 0) return;
      actions.transformSelection(resizeAbout(b, w, h), "Resize", opts);
    },
    duplicateSelection() {
      const d = get().design;
      const objs = selectedObjects();
      if (!d || objs.length === 0) return;
      const copies = duplicateObjects(objs, makeIdGen(d));
      commit(
        "Duplicate",
        (draft) => {
          // a copied word is its own text block, not more letters of the original
          const remap = new Map<string, string>();
          for (const c of copies) {
            const g = c.sourceText?.group;
            if (!g) continue;
            if (!remap.has(g)) {
              const ng = nextTextGroup(draft, remap.values());
              remap.set(g, ng);
              const block = draft.textBlocks?.find((x) => x.id === g);
              if (block) draft.textBlocks!.push({ ...block, id: ng, origin: [block.origin[0] + 3, block.origin[1] + 3], ...(block.centre ? { centre: [block.centre[0] + 3, block.centre[1] + 3] as const } : {}) });
            }
            c.sourceText = { ...c.sourceText!, group: remap.get(g)! };
          }
          draft.objects.push(...copies);
        },
        { select: copies.map((c) => c.id) },
      );
    },
    deleteSelection() {
      const ids = new Set(get().selectedIds);
      if (ids.size === 0) return;
      commit("Delete", (d) => {
        d.objects = d.objects.filter((o) => !ids.has(o.id) || o.locked);
        pruneTextBlocks(d);
      });
    },
    toggleLockSelection() {
      const objs = selectedObjects();
      if (objs.length === 0) return;
      const lock = !objs.every((o) => o.locked);
      actions.updateObjects(
        objs.map((o) => o.id),
        lock ? "Lock" : "Unlock",
        (o) => void (o.locked = lock),
      );
    },
    rename(id, name) {
      const n = name.trim();
      if (n) actions.updateObjects([id], "Rename", (o) => void (o.name = n));
    },
    setObjectThread(ids, thread) {
      const set = new Set(ids);
      commit("Change colour", (d) => {
        ensureThread(d, thread);
        for (const o of d.objects) if (set.has(o.id)) o.threadId = thread.id;
      });
      actions.setThread(thread.id);
    },
    setHoop(hoop) {
      commit("Change hoop", (d) => void (d.hoop = hoop));
    },
    convertSelectionOutline() {
      const objs = selectedObjects();
      if (objs.length === 0) return;
      commit("Convert outline / fill", (d) => {
        d.objects = d.objects.map((o) => {
          if (!objs.some((s) => s.id === o.id) || o.locked) return o;
          if (o.kind === "fill") return fillToOutline(o);
          if (o.kind === "run") return outlineToFill(o) ?? o;
          return o;
        });
      });
    },
    redworkSelection() {
      const d = get().design;
      const objs = selectedObjects();
      if (!d || objs.length === 0) return;
      const thread = d.threads.find((t) => t.id === objs[0].threadId) ?? defaultThread();
      const runs = autoRedwork(objs, thread.id, makeIdGen(d));
      if (runs.length === 0) return;
      const last = Math.max(...objs.map((o) => d.objects.findIndex((x) => x.id === o.id)));
      commit(
        "Auto redwork",
        (draft) => {
          draft.objects.splice(last + 1, 0, ...runs);
        },
        { select: runs.map((r) => r.id) },
      );
    },
    async knife(a, b) {
      const d = get().design;
      const targets = selectedObjects().filter((o) => !o.locked);
      if (!d || targets.length === 0) return;
      // New piece ids must not collide across objects, so each call starts past the last one's ids.
      let n = Number(makeIdGen(d)().slice(1));
      const results: { id: string; pieces: DesignObject[] }[] = [];
      for (const o of targets) {
        const pieces = await engine.shapeOp({ op: "knife", object: o, a, b, firstId: n });
        results.push({ id: o.id, pieces });
        n += Math.max(0, pieces.length - 1);
      }
      if (results.every((r) => r.pieces.length === 1)) return;
      commit(
        "Knife",
        (draft) => {
          for (const r of results) {
            const i = draft.objects.findIndex((o) => o.id === r.id);
            if (i >= 0) draft.objects.splice(i, 1, ...r.pieces);
          }
        },
        { select: results.flatMap((r) => r.pieces.map((p) => p.id)) },
      );
    },
    async cutHole(hole) {
      const d = get().design;
      const target = selectedObjects().find((o) => o.kind === "fill" && !o.locked);
      if (!d || !target || target.kind !== "fill") return;
      const first = Number(makeIdGen(d)().slice(1));
      const pieces = await engine.shapeOp({ op: "cutHole", object: target, hole, firstId: first });
      actions.replaceObject(target.id, pieces, "Cut hole");
    },
    mergeColours(fromThreadId, to) {
      commit("Merge colours", (d) => {
        ensureThread(d, to);
        for (const o of d.objects) if (o.threadId === fromThreadId) o.threadId = to.id;
        if (!d.objects.some((o) => o.threadId === fromThreadId)) d.threads = d.threads.filter((t) => t.id !== fromThreadId);
      });
    },
    groupByColour() {
      commit("Group by colour", (d) => {
        const order: string[] = [];
        for (const o of d.objects) if (!order.includes(o.threadId)) order.push(o.threadId);
        d.objects = order.flatMap((t) => d.objects.filter((o) => o.threadId === t));
      });
    },

    openMapDraft(draft = {}) {
      const d = get().design;
      const sel = get().selectedIds;
      if (!d || sel.length === 0) return;
      const objs = selectedObjects();
      // Re-editing a live group: any selected copy opens its group.
      const gid = objs.find((o) => o.mapGroup)?.mapGroup;
      if (gid && d.mapGroups?.[gid]) {
        const g = d.mapGroups[gid];
        set({ mapDraft: { sourceIds: sel, pathId: null, path: g.path, groupId: gid, options: { ...g.options }, ...draft } });
        return;
      }
      const openRun = objs.find((o): o is RunObject => o.kind === "run" && !o.geometry.closed);
      const sources = openRun && objs.length > 1 ? objs.filter((o) => o !== openRun) : objs;
      set({
        mapDraft: {
          sourceIds: sources.map((o) => o.id),
          pathId: openRun && objs.length > 1 ? openRun.id : null,
          path: openRun && objs.length > 1 ? openRun.geometry.path.map((p) => p) : null,
          groupId: null,
          options: { ...DEFAULT_MAP_OPTIONS },
          ...draft,
        },
      });
    },
    updateMapDraft: (patch) => set((s) => (s.mapDraft ? { mapDraft: { ...s.mapDraft, options: { ...s.mapDraft.options, ...patch } } } : {})),
    setMapPath: (path) => set((s) => (s.mapDraft ? { mapDraft: { ...s.mapDraft, path, pathId: null }, mode: "none" } : {})),
    closeMapDraft: () => set({ mapDraft: null, mode: get().mode === "pickPath" ? "none" : get().mode }),
    applyMapDraft() {
      const s = get();
      const draft = s.mapDraft;
      const d = s.design;
      if (!draft || !d || !draft.path || draft.path.length < 2) return;
      const idGen = makeIdGen(d);
      const groupId = draft.groupId ?? `m${Object.keys(d.mapGroups ?? {}).length + 1}-${Date.now().toString(36)}`;
      const group = draft.groupId && d.mapGroups?.[draft.groupId]
        ? { ...d.mapGroups[draft.groupId], options: draft.options }
        : {
            sources: d.objects.filter((o) => draft.sourceIds.includes(o.id)).map((o) => ({ ...o })),
            path: draft.path.map((p) => p),
            closed: false,
            options: draft.options,
          };
      if (group.sources.length === 0) return;
      let ids: string[] = [];
      commit("Map to path", (draft2) => {
        ids = applyMapGroup(draft2, groupId, group, idGen, draft.groupId ? [] : [...draft.sourceIds, ...(draft.pathId ? [draft.pathId] : [])]);
      });
      setSel(ids);
      set({ mapDraft: null, mode: "none" });
    },
    detachMap(groupId) {
      commit("Detach from path", (d) => detachMapGroup(d, groupId));
      set({ mapDraft: null });
    },

    async addRefImage(file) {
      const d = await decodeFile(file);
      const src = d.reference;
      if (!src) throw new Error("Could not read that image.");
      const w = "naturalWidth" in src ? src.naturalWidth || src.width : src.width;
      const h = "naturalHeight" in src ? src.naturalHeight || src.height : src.height;
      const widthMm = 60;
      const heightMm = (widthMm * h) / Math.max(1, w);
      const used = new Set((get().design?.images ?? []).map((m) => m.id));
      let id = `img${++imageSeq}`;
      while (used.has(id) || assets.has(id)) id = `img${++imageSeq}`;
      const mime = file.type || (d.kind === "svg" ? "image/svg+xml" : /\.jpe?g$/i.test(file.name) ? "image/jpeg" : /\.webp$/i.test(file.name) ? "image/webp" : "image/png");
      assets.set(id, { bytes: file.bytes, mime, src });
      assetVersion++;
      const meta: DesignImage = { id, name: file.name, mime, w, h, x: -widthMm / 2, y: -heightMm / 2, widthMm, opacity: 0.6, locked: false, visible: true };
      commit("Add reference image", (dd) => void (dd.images = [...(dd.images ?? []), meta]), { noPlan: true });
      set({ selectedImageId: id });
    },
    updateRefImage(id, patch) {
      const keys = Object.keys(patch);
      const label = keys.includes("opacity")
        ? "Image opacity"
        : keys.includes("widthMm")
          ? "Resize image"
          : keys.includes("x") || keys.includes("y")
            ? "Move image"
            : keys.includes("visible")
              ? patch.visible
                ? "Show image"
                : "Hide image"
              : keys.includes("locked")
                ? patch.locked
                  ? "Lock image"
                  : "Unlock image"
                : "Edit image";
      // `src` and `id` aren't placement; everything else is
      const { name, w, h, x, y, widthMm, opacity, locked, visible } = patch;
      const changes = { name, w, h, x, y, widthMm, opacity, locked, visible };
      commit(
        label,
        (d) => {
          const m = d.images?.find((i) => i.id === id);
          if (!m) return;
          for (const [k, v] of Object.entries(changes)) if (v !== undefined) (m as unknown as Record<string, unknown>)[k] = v;
        },
        { merge: `img:${id}:${label}`, noPlan: true },
      );
    },
    moveRefImage(id, dir) {
      commit(
        dir > 0 ? "Bring image forward" : "Send image back",
        (d) => {
          const list = d.images;
          if (!list) return;
          const i = list.findIndex((r) => r.id === id);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= list.length) return;
          [list[i], list[j]] = [list[j], list[i]];
        },
        { noPlan: true },
      );
    },
    removeRefImage(id) {
      commit("Remove reference image", (d) => void (d.images = (d.images ?? []).filter((r) => r.id !== id)), { noPlan: true });
    },
    setStitchSettings: (patch) => set((s) => ({ stitchSettings: { ...s.stitchSettings, ...patch } })),
    stitchRegions(ids) {
      const s = get();
      const regions = s.trace?.regions;
      if (!regions) return;
      const byId = new Map(regions.map((r) => [r.id, r]));
      const wanted = [...new Set(ids)].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
      if (wanted.length === 0) return;
      const nextId = makeIdGen(s.design ?? emptyDesign());
      const made = wanted.map((r) => ({ regionId: r.id, ...regionToObjects(r, s.stitchSettings, nextId) }));
      const all = made.flatMap((m) => m.objects.map((o) => o.id));
      // a region you already stitched is re-stitched with the new settings, in its place, not doubled
      const have = new Set((s.design?.objects ?? []).map((o) => o.id));
      const olds = made.map((m) => (s.regionObjects[m.regionId] ?? []).filter((id) => have.has(id)));
      const redo = olds.some((o) => o.length > 0);
      commit(
        redo ? (wanted.length === 1 ? "Restitch region" : `Restitch ${wanted.length} regions`) : wanted.length === 1 ? "Stitch region" : `Stitch ${wanted.length} regions`,
        (d) => {
          made.forEach((m, i) => {
            ensureThread(d, m.thread);
            const old = new Set(olds[i]);
            let at = d.objects.length;
            if (old.size > 0) {
              at = d.objects.findIndex((o) => old.has(o.id));
              d.objects = d.objects.filter((o) => !old.has(o.id));
            }
            d.objects.splice(Math.max(0, Math.min(at, d.objects.length)), 0, ...m.objects);
          });
        },
        { select: all },
      );
      set((st) => ({
        regionObjects: { ...st.regionObjects, ...Object.fromEntries(made.map((m) => [m.regionId, m.objects.map((o) => o.id)])) },
        pendingRegions: st.pendingRegions.filter((id) => !byId.has(id) || !wanted.some((w) => w.id === id)),
      }));
    },
    togglePendingRegion: (id) => set((s) => ({ pendingRegions: s.pendingRegions.includes(id) ? s.pendingRegions.filter((x) => x !== id) : [...s.pendingRegions, id] })),
    clearPendingRegions: () => set({ pendingRegions: [] }),
    stitchPending: () => actions.stitchRegions(get().pendingRegions),
    clearStitches() {
      if ((get().design?.objects.length ?? 0) === 0) return;
      commit(
        "Clear all stitches",
        (d) => {
          d.objects = [];
          delete d.textBlocks;
          delete d.mapGroups;
        },
        { select: [] },
      );
      set({ regionObjects: {} });
    },

    selectRefImage: (id) => set({ selectedImageId: id }),
  };

  return {
    store,
    actions,
    dispose() {
      disposed = true;
      if (planTimer) clearTimeout(planTimer);
      if (digitizeTimer) clearTimeout(digitizeTimer);
    },
    activate() {
      disposed = false;
      // a re-stitch that was cancelled by dispose is still owed
      if (get().planning) schedulePlan();
    },
  };
}

export type { PlanResult };
