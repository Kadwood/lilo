/**
 * Pixel art to stitches. Each thread is sewn once (colour-ordered, so a 32x32 picture with 5 colours
 * is 4 colour changes). Within a colour, horizontal runs of same-colour cells are merged into one
 * block, and the blocks are routed nearest-first, entered from whichever end is closer.
 *
 * Styles
 * - tatami: each run is a filled rectangle of horizontal rows (brick-staggered).
 * - cross: an X per cell, a run is sewn "/" along the bottom then "\" back.
 * - satin: each run is a satin bar across the cell height, zig-zagging along the run, over a centre
 *   underlay line.
 *
 * The result is an ordinary `StitchPlan`, so `validatePlan` adds lock stitches, trims and the hoop
 * check, exactly as for a normal design.
 */
import type { Hoop } from "../model";
import { DEFAULTS as STITCH_DEFAULTS } from "../presets/defaults";
import type { PlanStitch, StitchPlan } from "../stitch/plan";
import { validatePlan } from "../stitch/validate";
import { validateForMachine } from "../stitch/machine";
import { applyOrigin, CENTER_ORIGIN, writePes, type Origin } from "../pes";
import type { PixelArt, PixelStyle } from "./grid";

export interface PixelStitchOptions {
  /** Overrides `art.style`. */
  style?: PixelStyle;
  /** Tatami: distance between rows. Default 0.4 mm. */
  rowSpacingMm?: number;
  /** Tatami: stitch length along a row. Default 3 mm. */
  stitchLengthMm?: number;
  /** Grow each block/bar by this much so neighbours meet. Default 0.1 mm. */
  pullCompMm?: number;
  /** Satin: distance between zig-zag stitches. Default 0.4 mm. */
  satinDensityMm?: number;
  /** Satin: sew a centre underlay first. Default true. */
  underlay?: boolean;
  /** `area`: biggest colour first (details end up on top). `appearance`: reading order. Default `area`. */
  colorOrder?: "area" | "appearance";
}

/** A horizontal run of same-thread cells on one row. */
export interface PixelRun {
  threadId: string;
  row: number;
  /** First cell column. */
  col: number;
  /** Number of cells. */
  length: number;
}

/** Merge each row's neighbouring same-thread cells. Reading order. */
export function pixelRuns(art: PixelArt): PixelRun[] {
  const runs: PixelRun[] = [];
  for (let row = 0; row < art.height; row++) {
    let col = 0;
    while (col < art.width) {
      const id = art.cells[row * art.width + col];
      if (id === null) {
        col++;
        continue;
      }
      let end = col + 1;
      while (end < art.width && art.cells[row * art.width + end] === id) end++;
      runs.push({ threadId: id, row, col, length: end - col });
      col = end;
    }
  }
  return runs;
}

type P = [number, number];

interface Geometry {
  x0: number;
  y0: number;
  c: number;
}

/** Tatami rows for one run, starting at the left (`dir` 1) or right (-1). */
function tatamiPiece(run: PixelRun, g: Geometry, dir: 1 | -1, o: Required<PixelStitchOptions>): P[] {
  const xa = g.x0 + run.col * g.c - o.pullCompMm;
  const xb = g.x0 + (run.col + run.length) * g.c + o.pullCompMm;
  const ya = g.y0 + run.row * g.c;
  const rows = Math.max(1, Math.round(g.c / o.rowSpacingMm));
  const step = g.c / rows;
  const L = o.stitchLengthMm;
  const out: P[] = [];
  let left = dir === 1;
  for (let j = 0; j < rows; j++) {
    const y = ya + (j + 0.5) * step;
    // global brick offset so neighbouring blocks line up
    const gj = run.row * rows + j;
    const offset = (gj % 3) * (L / 3);
    const pts: number[] = [];
    const first = Math.ceil((xa + 0.6 - offset) / L);
    for (let k = first; offset + k * L < xb - 0.6; k++) pts.push(offset + k * L);
    const xs = [xa, ...pts, xb];
    if (!left) xs.reverse();
    for (const x of xs) out.push([x, y]);
    left = !left;
  }
  return out;
}

/** Cross stitches for one run: "/" along the run, then "\" back. */
function crossPiece(run: PixelRun, g: Geometry, dir: 1 | -1): P[] {
  const cols = Array.from({ length: run.length }, (_, i) => run.col + i);
  const ya = g.y0 + run.row * g.c;
  const yb = ya + g.c;
  const X = (col: number) => g.x0 + col * g.c;
  if (dir === 1) {
    const out: P[] = [];
    for (const col of cols) out.push([X(col), yb], [X(col + 1), ya]);
    for (const col of [...cols].reverse()) out.push([X(col + 1), yb], [X(col), ya]);
    return out;
  }
  // mirrored: start at the right end, "\" first
  const out: P[] = [];
  for (const col of [...cols].reverse()) out.push([X(col + 1), yb], [X(col), ya]);
  for (const col of cols) out.push([X(col), yb], [X(col + 1), ya]);
  return out;
}

/** Satin bar for one run: centre underlay out, zig-zag back. */
function satinPiece(run: PixelRun, g: Geometry, dir: 1 | -1, o: Required<PixelStitchOptions>): P[] {
  const xa = g.x0 + run.col * g.c - o.pullCompMm;
  const xb = g.x0 + (run.col + run.length) * g.c + o.pullCompMm;
  const y0 = g.y0 + run.row * g.c - o.pullCompMm;
  const y1 = g.y0 + (run.row + 1) * g.c + o.pullCompMm;
  const mid = (y0 + y1) / 2;
  const [from, to] = dir === 1 ? [xa, xb] : [xb, xa];
  const out: P[] = [];
  if (o.underlay) {
    const n = Math.max(1, Math.ceil(Math.abs(to - from) / 2.5));
    for (let i = 0; i <= n; i++) out.push([from + ((to - from) * i) / n, mid]);
  } else out.push([from, mid]);
  // zig-zag back from `to` to `from`
  const len = Math.abs(to - from);
  // zig-zag: every drop is on the opposite side to the last, so same-side spacing = 2 x the drop spacing
  const n = Math.max(1, Math.round(len / (o.satinDensityMm / 2)));
  for (let i = 0; i <= n; i++) {
    const x = to + ((from - to) * i) / n;
    out.push([x, i % 2 === 0 ? y0 : y1]);
  }
  return out;
}

const DEFAULTS: Required<PixelStitchOptions> = {
  style: "tatami",
  rowSpacingMm: STITCH_DEFAULTS.pixelArt.rowSpacingMm,
  stitchLengthMm: STITCH_DEFAULTS.pixelArt.stitchLengthMm,
  pullCompMm: STITCH_DEFAULTS.pixelArt.pullCompMm,
  satinDensityMm: STITCH_DEFAULTS.pixelArt.satinDensityMm,
  underlay: true,
  colorOrder: "area",
};

/** The plan for a grid, centred on (0, 0). Returns an empty plan (with a warning) for an empty grid. */
export function pixelArtToStitchPlan(art: PixelArt, options: PixelStitchOptions = {}): StitchPlan {
  const o: Required<PixelStitchOptions> = { ...DEFAULTS, style: art.style, ...stripUndefined(options) };
  if (!(o.rowSpacingMm >= 0.1 && o.satinDensityMm >= 0.1 && o.stitchLengthMm >= 1)) throw new Error("Stitch settings out of range.");
  const runs = pixelRuns(art);
  const threadsById = new Map(art.threads.map((t) => [t.id, t]));
  const plan: StitchPlan = { threads: [], stitches: [], warnings: [] };
  if (runs.length === 0) {
    plan.warnings.push({ code: "empty", message: "The pixel grid is empty." });
    return plan;
  }
  for (const r of runs) {
    if (!threadsById.has(r.threadId)) throw new Error(`The pixel grid uses an unknown thread (${r.threadId}).`);
  }
  const g: Geometry = { x0: -(art.width * art.cellMm) / 2, y0: -(art.height * art.cellMm) / 2, c: art.cellMm };

  // colour order
  const area = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  runs.forEach((r, i) => {
    area.set(r.threadId, (area.get(r.threadId) ?? 0) + r.length);
    if (!firstSeen.has(r.threadId)) firstSeen.set(r.threadId, i);
  });
  const order = [...area.keys()].sort((a, b) =>
    o.colorOrder === "area" ? area.get(b)! - area.get(a)! || firstSeen.get(a)! - firstSeen.get(b)! : firstSeen.get(a)! - firstSeen.get(b)!,
  );

  const make = (run: PixelRun, dir: 1 | -1): P[] =>
    o.style === "cross" ? crossPiece(run, g, dir) : o.style === "satin" ? satinPiece(run, g, dir, o) : tatamiPiece(run, g, dir, o);

  let cur: P = [0, 0];
  let started = false;
  order.forEach((threadId, blockIndex) => {
    const thread = threadsById.get(threadId)!;
    plan.threads.push(thread);
    const mine = runs.filter((r) => r.threadId === threadId).map((run) => ({ fwd: make(run, 1), rev: make(run, -1) }));
    if (started) plan.stitches.push({ x: cur[0], y: cur[1], type: "colorChange", threadIndex: blockIndex, objectIndex: -1 });
    // nearest-first routing; each run can be entered from either end
    const left = new Set(mine.keys());
    while (left.size > 0) {
      let best = -1;
      let bestRev = false;
      let bestD = Infinity;
      for (const i of left) {
        for (const rev of [false, true]) {
          const p = (rev ? mine[i].rev : mine[i].fwd)[0];
          const d = (p[0] - cur[0]) ** 2 + (p[1] - cur[1]) ** 2;
          if (d < bestD - 1e-9) {
            bestD = d;
            best = i;
            bestRev = rev;
          }
        }
      }
      left.delete(best);
      const pts = bestRev ? mine[best].rev : mine[best].fwd;
      const emit = (p: P, type: PlanStitch["type"]) =>
        plan.stitches.push({ x: p[0], y: p[1], type, threadIndex: blockIndex, objectIndex: -1 });
      if (Math.hypot(pts[0][0] - cur[0], pts[0][1] - cur[1]) > 0.05) emit(pts[0], "jump");
      for (const p of pts) emit(p, "stitch");
      cur = pts[pts.length - 1];
      started = true;
    }
  });
  return plan;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export interface PixelPesResult {
  plan: StitchPlan;
  warnings: ReturnType<typeof validatePlan>["warnings"];
  pes: Uint8Array;
}

/** Grid to a ready-to-send PES: stitches, validation (locks, trims, hoop), origin, bytes. */
export function pixelArtToPes(
  art: PixelArt,
  hoop: Hoop,
  options: PixelStitchOptions & { origin?: Origin; label?: string; lockStitchMm?: number } = {},
): PixelPesResult {
  const { origin, label, lockStitchMm, ...stitchOptions } = options;
  const raw = pixelArtToStitchPlan(art, stitchOptions);
  const { plan, warnings } = validateForMachine(raw, hoop, { lockStitchMm });
  const placed = applyOrigin(plan, origin ?? CENTER_ORIGIN);
  return { plan: placed, warnings, pes: writePes(placed, { label: label ?? "Pixels" }) };
}
