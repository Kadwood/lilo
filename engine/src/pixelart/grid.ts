/**
 * The pixel-art model: a rectangular grid of cells, each a thread id or empty. Plain JSON and
 * immutable helpers (every edit returns a new grid) so it fits the editor store, the project file
 * and a Web Worker.
 */
import type { Thread } from "../model";

export const DEFAULT_GRID_SIZE = 32;
export const DEFAULT_CELL_MM = 2.5;
export const MAX_GRID_SIZE = 256;

export type PixelStyle = "tatami" | "cross" | "satin";

export interface PixelArt {
  width: number;
  height: number;
  /** Side of one cell in mm. */
  cellMm: number;
  /** `width * height` cells, row-major: a `Thread.id` from `threads`, or null for no stitches. */
  cells: (string | null)[];
  /** Threads the cells refer to (the palette in use). */
  threads: Thread[];
  /** How the grid is stitched. */
  style: PixelStyle;
}

export function createPixelArt(
  width = DEFAULT_GRID_SIZE,
  height = DEFAULT_GRID_SIZE,
  cellMm = DEFAULT_CELL_MM,
  style: PixelStyle = "tatami",
): PixelArt {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_GRID_SIZE || height > MAX_GRID_SIZE) {
    throw new Error(`Grid must be 1 to ${MAX_GRID_SIZE} cells on each side.`);
  }
  if (!(cellMm > 0.5 && cellMm <= 10)) throw new Error("A cell must be between 0.5 and 10 mm.");
  return { width, height, cellMm, cells: new Array<string | null>(width * height).fill(null), threads: [], style };
}

const inside = (a: PixelArt, x: number, y: number) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < a.width && y < a.height;

export function getPixel(a: PixelArt, x: number, y: number): string | null {
  return inside(a, x, y) ? a.cells[y * a.width + x] : null;
}

/** Register a thread in the palette (no-op if its id is already there). */
export function addPixelThread(a: PixelArt, t: Thread): PixelArt {
  return a.threads.some((x) => x.id === t.id) ? a : { ...a, threads: [...a.threads, t] };
}

/** Pencil / erase (`threadId` null). Out-of-range cells are ignored; unknown threads throw. */
export function setPixel(a: PixelArt, x: number, y: number, threadId: string | null): PixelArt {
  if (!inside(a, x, y)) return a;
  if (threadId !== null && !a.threads.some((t) => t.id === threadId)) throw new Error(`Thread ${threadId} is not in the palette.`);
  if (a.cells[y * a.width + x] === threadId) return a;
  const cells = a.cells.slice();
  cells[y * a.width + x] = threadId;
  return { ...a, cells };
}

/** Paint several cells at once (a drag stroke). */
export function setPixels(a: PixelArt, points: readonly (readonly [number, number])[], threadId: string | null): PixelArt {
  let out = a;
  for (const [x, y] of points) out = setPixel(out, x, y, threadId);
  return out;
}

/** Bucket fill: 4-connected flood of the cell's current value. */
export function floodFillPixels(a: PixelArt, x: number, y: number, threadId: string | null): PixelArt {
  if (!inside(a, x, y)) return a;
  const target = a.cells[y * a.width + x];
  if (target === threadId) return a;
  if (threadId !== null && !a.threads.some((t) => t.id === threadId)) throw new Error(`Thread ${threadId} is not in the palette.`);
  const cells = a.cells.slice();
  const stack = [y * a.width + x];
  while (stack.length) {
    const i = stack.pop()!;
    if (cells[i] !== target) continue;
    cells[i] = threadId;
    const cx = i % a.width;
    const cy = (i - cx) / a.width;
    if (cx > 0) stack.push(i - 1);
    if (cx < a.width - 1) stack.push(i + 1);
    if (cy > 0) stack.push(i - a.width);
    if (cy < a.height - 1) stack.push(i + a.width);
  }
  return { ...a, cells };
}

/** Eyedropper: the thread under a cell, or null. */
export function pickPixelThread(a: PixelArt, x: number, y: number): Thread | null {
  const id = getPixel(a, x, y);
  return id ? (a.threads.find((t) => t.id === id) ?? null) : null;
}

/** Resize the canvas, keeping the content anchored top-left (cells beyond the new size are dropped). */
export function resizePixelArt(a: PixelArt, width: number, height: number): PixelArt {
  const out = createPixelArt(width, height, a.cellMm, a.style);
  for (let y = 0; y < Math.min(height, a.height); y++) {
    for (let x = 0; x < Math.min(width, a.width); x++) out.cells[y * width + x] = a.cells[y * a.width + x];
  }
  return { ...out, threads: a.threads };
}

/** Threads actually used, with cell counts, most used first. */
export function usedPixelThreads(a: PixelArt): { thread: Thread; cells: number }[] {
  const counts = new Map<string, number>();
  for (const id of a.cells) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  return a.threads
    .filter((t) => counts.has(t.id))
    .map((thread) => ({ thread, cells: counts.get(thread.id)! }))
    .sort((p, q) => q.cells - p.cells);
}

/** Drop palette entries no cell uses. */
export function prunePixelThreads(a: PixelArt): PixelArt {
  const used = new Set(a.cells);
  return { ...a, threads: a.threads.filter((t) => used.has(t.id)) };
}

/** Check a grid read from a file: right size, cells point at known threads. Throws a readable error. */
export function validatePixelArt(a: PixelArt): void {
  if (a.cells.length !== a.width * a.height) throw new Error("The pixel grid is the wrong size for its cells.");
  const ids = new Set(a.threads.map((t) => t.id));
  for (const c of a.cells) if (c !== null && !ids.has(c)) throw new Error(`The pixel grid uses an unknown thread (${c}).`);
}
