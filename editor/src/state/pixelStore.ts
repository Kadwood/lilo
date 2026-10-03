import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import {
  addPixelThread,
  createPixelArt,
  floodFillPixels,
  pickPixelThread,
  resizePixelArt,
  setPixels,
  type PixelArt,
  type PixelStyle,
  type Thread,
} from "@lilo/engine/light";
import { lineCells, rectCells, type Cell } from "./pixelShapes";
import { findThread, registerThread } from "./editorStore";

export type PixelTool = "pencil" | "fill" | "erase" | "eyedropper" | "line" | "rect";

export interface PixelState {
  art: PixelArt;
  tool: PixelTool;
  /** The thread the pencil, fill, line and rectangle paint with. */
  threadId: string | null;
  /** Rectangles: the edge only, or all of it. */
  rectFilled: boolean;
  undoDepth: number;
  redoDepth: number;
  undoLabel: string | null;
  /** The grid has been painted on or loaded since the app started (or since New). */
  touched: boolean;
  /** The Export dialog of the pixel view is open. */
  exportOpen: boolean;
  /** Last result worth telling the user about (import, send, error). */
  message: { kind: "ok" | "error"; text: string } | null;
}

export const PIXEL_TOOLS: { id: PixelTool; label: string; key: string; help: string }[] = [
  { id: "pencil", label: "Pencil", key: "b", help: "Paint cells; drag to paint several." },
  { id: "fill", label: "Fill", key: "g", help: "Fill the connected cells of one colour." },
  { id: "erase", label: "Erase", key: "e", help: "Clear cells (no stitches there)." },
  { id: "eyedropper", label: "Eyedropper", key: "i", help: "Pick the colour of a cell." },
  { id: "line", label: "Line", key: "l", help: "Drag a straight line." },
  { id: "rect", label: "Rectangle", key: "r", help: "Drag a rectangle (edge or filled)." },
];

const MAX_UNDO = 100;

interface Entry {
  label: string;
  art: PixelArt;
}

/** True when no cell has a thread. */
export const isBlank = (a: PixelArt): boolean => a.cells.every((c) => c === null);

/**
 * The pixel-art editor's state: the grid (an immutable `PixelArt`), the tool and colour, and its own
 * undo history (snapshots: a grid is a few kilobytes). Everything the canvas does goes through here.
 */
export function createPixelStore() {
  const store = createStore<PixelState>(() => ({
    art: createPixelArt(),
    tool: "pencil",
    threadId: null,
    rectFilled: false,
    undoDepth: 0,
    redoDepth: 0,
    undoLabel: null,
    touched: false,
    exportOpen: false,
    message: null,
  }));
  const get = store.getState;
  const set = store.setState;
  let undo: Entry[] = [];
  let redo: Entry[] = [];
  /** The grid before the stroke in progress, so the whole stroke is one undo step. */
  let stroke: { label: string; before: PixelArt } | null = null;

  /** `art` with the thread `id` in its palette (it can be missing after an undo or an import), or null if unknown. */
  const withThread = (art: PixelArt, id: string | null): PixelArt | null => {
    if (!id) return null;
    if (art.threads.some((t) => t.id === id)) return art;
    const t = findThread(id);
    return t ? addPixelThread(art, t) : null;
  };

  const sync = () => set({ undoDepth: undo.length, redoDepth: redo.length, undoLabel: undo[undo.length - 1]?.label ?? null });
  const record = (label: string, before: PixelArt) => {
    undo.push({ label, art: before });
    if (undo.length > MAX_UNDO) undo.shift();
    redo = [];
  };
  /** Replace the grid as one undo step. */
  const change = (label: string, next: PixelArt) => {
    const before = get().art;
    if (next === before) return;
    record(label, before);
    set({ art: next, touched: true });
    sync();
  };

  const actions = {
    setTool: (tool: PixelTool) => set({ tool }),
    setExportOpen: (exportOpen: boolean) => set({ exportOpen }),
    setMessage: (message: PixelState["message"]) => set({ message }),
    setRectFilled: (rectFilled: boolean) => set({ rectFilled }),
    /** Choose the paint colour. The thread joins the grid's palette at once (the palette is not undone). */
    setThread(t: Thread) {
      registerThread(t);
      set((s) => ({ threadId: t.id, art: addPixelThread(s.art, t) }));
    },
    /** Use a thread already in the grid's palette. */
    selectThread: (threadId: string | null) => set({ threadId }),

    /** Start a drag (pencil, erase): everything until `endStroke` is one undo step. */
    beginStroke(label: string) {
      stroke = { label, before: get().art };
    },
    /** Paint cells with the current colour (or erase them) as part of the stroke in progress. */
    paintCells(cells: readonly Cell[], erase: boolean) {
      const s = get();
      const art = erase ? s.art : withThread(s.art, s.threadId);
      if (!art) return;
      const next = setPixels(art, cells, erase ? null : s.threadId);
      if (next !== s.art) set({ art: next, touched: true });
    },
    endStroke() {
      if (!stroke) return;
      const { label, before } = stroke;
      stroke = null;
      if (get().art !== before) {
        record(label, before);
        sync();
      }
    },

    /** One-shot tools. */
    fill(x: number, y: number) {
      const s = get();
      const art = withThread(s.art, s.threadId);
      if (art) change("Fill", floodFillPixels(art, x, y, s.threadId));
    },
    eyedrop(x: number, y: number): boolean {
      const t = pickPixelThread(get().art, x, y);
      if (t) set({ threadId: t.id });
      return t !== null;
    },
    line(from: Cell, to: Cell) {
      const s = get();
      const art = withThread(s.art, s.threadId);
      if (art) change("Line", setPixels(art, lineCells(from[0], from[1], to[0], to[1]), s.threadId));
    },
    rect(from: Cell, to: Cell) {
      const s = get();
      const art = withThread(s.art, s.threadId);
      if (art) change("Rectangle", setPixels(art, rectCells(from[0], from[1], to[0], to[1], s.rectFilled), s.threadId));
    },

    resize(width: number, height: number) {
      const a = get().art;
      if (width === a.width && height === a.height) return;
      change("Resize grid", resizePixelArt(a, width, height));
    },
    setCellMm(cellMm: number) {
      const a = get().art;
      if (cellMm === a.cellMm) return;
      change("Cell size", { ...a, cellMm });
    },
    setStyle(style: PixelStyle) {
      const a = get().art;
      if (style === a.style) return;
      change("Stitch style", { ...a, style });
    },
    /** A grid made from a picture (or anything else): replaces the grid, undoable. */
    replace(art: PixelArt, label = "Import picture") {
      change(label, art);
      const id = get().threadId;
      if (!id || !art.threads.some((t) => t.id === id)) set({ threadId: art.threads[0]?.id ?? null });
    },
    clear() {
      const a = get().art;
      if (isBlank(a)) return;
      change("Clear", { ...a, cells: a.cells.map(() => null) });
    },

    undo() {
      const e = undo.pop();
      if (!e) return;
      redo.push({ label: e.label, art: get().art });
      set({ art: e.art });
      sync();
    },
    redo() {
      const e = redo.pop();
      if (!e) return;
      undo.push({ label: e.label, art: get().art });
      set({ art: e.art });
      sync();
    },

    /** Open a grid from a project (clears history). `null` gives a fresh 32 x 32 grid. */
    load(art: PixelArt | null) {
      undo = [];
      redo = [];
      stroke = null;
      set({ art: art ?? createPixelArt(), threadId: art?.threads[0]?.id ?? null, touched: art !== null });
      sync();
    },
  };

  return { store, actions };
}

export type PixelStore = ReturnType<typeof createPixelStore>;

/** The one pixel-art editor of the app. */
export const pixel: PixelStore = createPixelStore();

export function usePixel(): PixelState {
  return useStore(pixel.store);
}
