import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type Dispatch, type ReactNode } from "react";
import { DEFAULT_CATALOGUE_ID } from "@lilo/engine/light";
import type { AutoDigitizeOptions, Design, ImageDataLike, PaletteChip, StageEvent, UnitsToMm } from "@lilo/engine";
import { useEngine } from "../engine/context";
import type { DigitizeResponse, PlanResult } from "../engine/client";
import { decodeFile, type DecodedImport } from "../io/decode";
import { PlayerController } from "./player";
import { moveGroup, moveObject, setGroupVisible, setObjectVisible } from "./reorder";

/** What the Auto-digitize panel controls. `null` sizes mean "auto" (longest side 60 mm). */
export interface DigitizeUiOptions {
  colors: number;
  catalogueId: string;
  widthMm: number | null;
  heightMm: number | null;
  aspectLock: boolean;
  minRegionMm2: number;
  removeBackground: boolean;
}

export const DEFAULT_UI_OPTIONS: DigitizeUiOptions = {
  colors: 6,
  catalogueId: DEFAULT_CATALOGUE_ID,
  widthMm: null,
  heightMm: null,
  aspectLock: true,
  minRegionMm2: 2,
  removeBackground: true,
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
  selectedId: string | null;
  /** Bumped for every fresh digitize result, so the canvas can play the tracing animation. */
  animationKey: number;
  view: ViewToggles;
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
  animationKey: 0,
  view: { realistic: true, grid: true, reference: true, jumps: true },
};

type Action =
  | { type: "name"; name: string }
  | { type: "source"; source: SourceInfo }
  | { type: "options"; patch: Partial<DigitizeUiOptions> }
  | { type: "working"; stage: string }
  | { type: "stage"; event: StageEvent }
  | { type: "digitized"; result: DigitizeResponse }
  | { type: "design"; design: Design }
  | { type: "plan"; planResult: PlanResult }
  | { type: "select"; id: string | null }
  | { type: "error"; message: string }
  | { type: "view"; patch: Partial<ViewToggles> }
  | { type: "load"; design: Design; planResult: PlanResult };

export function reducer(s: EditorState, a: Action): EditorState {
  switch (a.type) {
    case "name":
      return { ...s, projectName: a.name };
    case "source":
      return { ...s, source: a.source, stages: { quantized: null, palette: [], imageToMm: null }, selectedId: null };
    case "options":
      return { ...s, options: { ...s.options, ...a.patch } };
    case "working":
      return { ...s, status: { kind: "working", stage: a.stage } };
    case "stage": {
      const e = a.event;
      if (e.stage === "prep") return { ...s, status: { kind: "working", stage: "Preparing image" } };
      if (e.stage === "quantize") return { ...s, status: { kind: "working", stage: "Matching threads" }, stages: { ...s.stages, quantized: e.image, palette: e.palette } };
      if (e.stage === "trace") return { ...s, status: { kind: "working", stage: "Tracing" }, stages: { ...s.stages, imageToMm: e.imageToMm } };
      if (e.stage === "cleanup") return { ...s, status: { kind: "working", stage: "Planning stitches" } };
      return s;
    }
    case "digitized": {
      const r = a.result;
      return {
        ...s,
        status: { kind: "idle" },
        design: r.design,
        planResult: { plan: r.plan, stats: r.stats, warnings: r.warnings },
        palette: r.palette,
        placement: { imageToMm: r.imageToMm, origin: r.imageOrigin, width: r.imageWidth, height: r.imageHeight },
        selectedId: null,
        animationKey: s.animationKey + 1,
      };
    }
    case "design":
      return { ...s, design: a.design };
    case "plan":
      return { ...s, planResult: a.planResult };
    case "select":
      return { ...s, selectedId: a.id };
    case "error":
      return { ...s, status: { kind: "error", message: a.message } };
    case "view":
      return { ...s, view: { ...s.view, ...a.patch } };
    case "load":
      return { ...s, design: a.design, planResult: a.planResult, status: { kind: "idle" }, selectedId: null };
  }
}

export interface EditorActions {
  setName(name: string): void;
  setOptions(patch: Partial<DigitizeUiOptions>): void;
  setView(patch: Partial<ViewToggles>): void;
  select(id: string | null): void;
  /** Decode a dropped/picked file and digitize it. */
  importFile(file: { name: string; bytes: Uint8Array; type?: string }): Promise<void>;
  digitize(): Promise<void>;
  reorderObject(from: number, before: number): void;
  reorderGroup(group: number, before: number): void;
  toggleObject(id: string, visible: boolean): void;
  toggleGroup(group: number, visible: boolean): void;
  /** Replace the design directly (opening a project, tests). */
  loadDesign(design: Design): Promise<void>;
}

interface Store {
  state: EditorState;
  actions: EditorActions;
  /** Stitch-player clock and position; one per editor, fed from the current plan. */
  player: PlayerController;
}

const StoreContext = createContext<Store | null>(null);

export function useEditor(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useEditor must be used inside <EditorProvider>");
  return s;
}

/** Turn UI options into engine options. */
export function toEngineOptions(o: DigitizeUiOptions): Partial<AutoDigitizeOptions> {
  return {
    colors: o.colors,
    catalogueId: o.catalogueId,
    widthMm: o.widthMm ?? undefined,
    heightMm: o.heightMm ?? undefined,
    minRegionMm2: o.minRegionMm2,
    removeBackground: o.removeBackground,
  };
}

export function EditorProvider({ children, initialDesign }: { children: ReactNode; initialDesign?: Design }) {
  const engine = useEngine();
  const [state, dispatch] = useReducer(reducer, initialState) as [EditorState, Dispatch<Action>];
  const stateRef = useRef(state);
  stateRef.current = state;
  const decoded = useRef<DecodedImport | null>(null);
  const runId = useRef(0);
  const planId = useRef(0);

  const runDigitize = useCallback(async () => {
    const d = decoded.current;
    if (!d) return;
    const id = ++runId.current;
    dispatch({ type: "working", stage: "Starting" });
    try {
      const source = d.kind === "raster" ? { kind: "raster" as const, image: { width: d.image.width, height: d.image.height, data: new Uint8ClampedArray(d.image.data) } } : { kind: "svg" as const, text: d.text };
      const result = await engine.digitize(source, toEngineOptions(stateRef.current.options), (event) => {
        if (id === runId.current) dispatch({ type: "stage", event });
      });
      if (id === runId.current) dispatch({ type: "digitized", result });
    } catch (e) {
      if (id === runId.current) dispatch({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [engine]);

  const replan = useCallback(
    async (design: Design) => {
      const id = ++planId.current;
      try {
        const planResult = await engine.plan(design);
        if (id === planId.current) dispatch({ type: "plan", planResult });
      } catch (e) {
        if (id === planId.current) dispatch({ type: "error", message: e instanceof Error ? e.message : String(e) });
      }
    },
    [engine],
  );

  const edit = useCallback(
    (next: Design) => {
      dispatch({ type: "design", design: next });
      void replan(next);
    },
    [replan],
  );

  const actions = useMemo<EditorActions>(
    () => ({
      setName: (name) => dispatch({ type: "name", name }),
      setOptions: (patch) => dispatch({ type: "options", patch }),
      setView: (patch) => dispatch({ type: "view", patch }),
      select: (id) => dispatch({ type: "select", id }),
      async importFile(file) {
        const id = ++runId.current;
        dispatch({ type: "working", stage: "Reading file" });
        try {
          const d = await decodeFile(file);
          decoded.current = d;
          dispatch({
            type: "source",
            source: { name: file.name, kind: d.kind, width: d.kind === "raster" ? d.image.width : 0, height: d.kind === "raster" ? d.image.height : 0, reference: d.reference },
          });
          dispatch({ type: "name", name: file.name.replace(/\.[^.]+$/, "") });
        } catch (e) {
          if (id === runId.current) dispatch({ type: "error", message: e instanceof Error ? e.message : String(e) });
          return;
        }
        await runDigitize();
      },
      digitize: runDigitize,
      reorderObject(from, before) {
        const d = stateRef.current.design;
        if (!d) return;
        const next = moveObject(d, from, before);
        if (next !== d) edit(next);
      },
      reorderGroup(group, before) {
        const d = stateRef.current.design;
        if (!d) return;
        const next = moveGroup(d, group, before);
        if (next !== d) edit(next);
      },
      toggleObject(id, visible) {
        const d = stateRef.current.design;
        if (d) edit(setObjectVisible(d, id, visible));
      },
      toggleGroup(group, visible) {
        const d = stateRef.current.design;
        if (d) edit(setGroupVisible(d, group, visible));
      },
      async loadDesign(design) {
        const planResult = await engine.plan(design);
        dispatch({ type: "load", design, planResult });
      },
    }),
    [edit, engine, runDigitize],
  );

  // Seed (tests, opening a project).
  useEffect(() => {
    if (initialDesign) void actions.loadDesign(initialDesign);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live result: once something is digitized, option changes re-run it after a short pause.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!decoded.current) return;
    const t = setTimeout(() => void runDigitize(), 450);
    return () => clearTimeout(t);
  }, [state.options, runDigitize]);

  const player = useMemo(() => new PlayerController(), []);
  useEffect(() => {
    player.setPlan(state.planResult?.plan ?? null);
  }, [player, state.planResult]);

  const store = useMemo(() => ({ state, actions, player }), [state, actions, player]);
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
