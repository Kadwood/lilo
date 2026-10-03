import { Core, Math as StitchMath } from "@stitchables/stitchjs";
import type { Pt, RunObject, RunType, SatinParams } from "../../model";
import { DEFAULT_SATIN_PARAMS } from "../../model";

const { Vector } = StitchMath;
type V = InstanceType<typeof Vector>;

/**
 * stitchjs works in "px" and takes a px-per-mm factor. We author everything in mm and run it at a
 * fixed 10 px/mm, then divide back, so geometry never touches stitchjs in raw mm.
 */
export const PX = 10;
/** `StitchType.JUMP` in stitchjs (the enum is not exported at runtime): 0 NORMAL, 1 JUMP, 2 COLOR_CHANGE, 3 TRIM... */
export const STITCHJS_JUMP = 1;

/** The slice of a stitchjs stitch we read. */
export interface RawStitch {
  position: { x: number; y: number };
  stitchType: number;
}

/** What `designToStitchPlan` consumes: anything that can list needle positions at a px-per-mm scale. */
export interface IRun {
  getStitches: (pixelsPerMm: number) => RawStitch[];
}

export const toV = (p: Pt): V => new Vector(p[0] * PX, p[1] * PX);
export const closedV = (pts: V[]): V[] => (pts.length && pts[0].distance(pts[pts.length - 1]) > 1e-9 ? [...pts, pts[0]] : pts);

/**
 * Sew exactly these polylines: each polyline's first stitch is a jump (the generator drops the jump
 * when the needle is already there), the rest are plain stitches at the given positions.
 */
export function polylineRun(polys: readonly (readonly Pt[])[]): IRun {
  return {
    getStitches(pxPerMm) {
      const out: RawStitch[] = [];
      for (const poly of polys) {
        poly.forEach((p, i) => out.push({ position: { x: p[0] * pxPerMm, y: p[1] * pxPerMm }, stitchType: i === 0 ? STITCHJS_JUMP : 0 }));
      }
      return out;
    },
  };
}

/** Rungs for a satin column of constant `widthMm` along a centreline: `[l0, r0, l1, r1, ...]`. */
export function stripFromCentreline(path: readonly Pt[], widthMm: number, closed = false): Pt[] {
  const pts = closed && path.length > 1 ? [...path, path[0]] : [...path];
  // dense enough that a bend keeps its shape (the satin resamples by density anyway)
  const dense: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      const a = pts[i - 1];
      const b = pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.8));
      for (let k = 1; k < n; k++) dense.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    dense.push(pts[i]);
  }
  const strip: Pt[] = [];
  const h = widthMm / 2;
  for (let i = 0; i < dense.length; i++) {
    const prev = dense[Math.max(0, i - 1)];
    const next = dense[Math.min(dense.length - 1, i + 1)];
    const tx0 = dense[i][0] - prev[0];
    const ty0 = dense[i][1] - prev[1];
    const tx1 = next[0] - dense[i][0];
    const ty1 = next[1] - dense[i][1];
    const l0 = Math.hypot(tx0, ty0);
    const l1 = Math.hypot(tx1, ty1);
    // unit tangents in and out; their sum bisects the corner
    const ux0 = l0 ? tx0 / l0 : 0;
    const uy0 = l0 ? ty0 / l0 : 0;
    const ux1 = l1 ? tx1 / l1 : 0;
    const uy1 = l1 ? ty1 / l1 : 0;
    let tx = ux0 + ux1;
    let ty = uy0 + uy1;
    const tl = Math.hypot(tx, ty);
    if (tl < 1e-6) {
      tx = ux1 || ux0;
      ty = uy1 || uy0;
    } else {
      tx /= tl;
      ty /= tl;
    }
    // miter: widen at corners so the column keeps its width, capped so spikes don't explode
    const dot = l0 && l1 ? Math.max(0.5, ux0 * ux1 + uy0 * uy1) : 1;
    const miter = 1 / Math.sqrt((1 + dot) / 2);
    const nx = -ty * h * Math.min(miter, 2);
    const ny = tx * h * Math.min(miter, 2);
    strip.push([dense[i][0] + nx, dense[i][1] + ny], [dense[i][0] - nx, dense[i][1] - ny]);
  }
  return strip;
}

/** ClassicSatin options from satin params. */
export function satinOptions(p: SatinParams): Record<string, unknown> {
  const underlays: { type: string }[] =
    p.underlay === "center" ? [{ type: "CENTER_LINE" }] : p.underlay === "contour" ? [{ type: "CONTOUR" }] : p.underlay === "zigzag" ? [{ type: "ZIGZAG" }] : [];
  const opts: Record<string, unknown> = { densityMm: Math.max(0.1, p.densityMm), underlays };
  if (p.splitMaxWidthMm && p.splitMaxWidthMm > 0) {
    opts.split = {
      maxWidthMm: p.splitMaxWidthMm,
      ...(p.staggerCycles ? { staggerCycles: p.staggerCycles } : {}),
      ...(p.staggerAmountMm ? { staggerAmountMm: p.staggerAmountMm } : {}),
    };
  }
  if (p.shortStitches) opts.shortening = {};
  return opts;
}

/** Widen a left/right strip by `pc` mm on each side (pull compensation). */
export function widenStrip(strip: readonly Pt[], pc: number): Pt[] {
  if (pc <= 0) return [...strip];
  const out: Pt[] = [];
  for (let i = 0; i + 1 < strip.length; i += 2) {
    const l = strip[i];
    const r = strip[i + 1];
    const dx = l[0] - r[0];
    const dy = l[1] - r[1];
    const d = Math.hypot(dx, dy) || 1;
    out.push([l[0] + (dx / d) * pc, l[1] + (dy / d) * pc], [r[0] - (dx / d) * pc, r[1] - (dy / d) * pc]);
  }
  return out;
}

export function reversedStrip(strip: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = strip.length - 2; i >= 0; i -= 2) out.push(strip[i], strip[i + 1]);
  return out;
}

/** `RunObject.params.type`, falling back to the legacy `repeats` field. */
export const runTypeOf = (o: RunObject): RunType => o.params.type ?? (o.params.repeats === 3 ? "triple" : "single");

const d2 = (a: Pt, b: Pt) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** Stitch runs for a run object. `from` is where the needle is now, used to pick the sewing direction. */
export function runObjectRuns(o: RunObject, from: Pt): IRun[] {
  const type = runTypeOf(o);
  const p = o.params;
  let path: Pt[] = [...o.geometry.path];
  if (path.length < 2) return [];
  if (o.geometry.closed && type !== "manual") path.push(path[0]);

  // Manual stitches are sewn exactly in the order they were placed; everything else may be reversed
  // so it starts at the end nearest the needle (or nearest the user's start marker).
  if (type !== "manual") {
    const anchor = o.startPoint ?? from;
    if (d2(path[path.length - 1], anchor) < d2(path[0], anchor)) path = path.reverse();
  } else {
    return [polylineRun([path])];
  }

  // Only pass a tolerance the user set; otherwise stitchjs keeps its own default.
  const tolOpt = p.toleranceMm !== undefined ? { stitchToleranceMm: Math.max(0.1, p.toleranceMm) } : {};
  const len = Math.max(0.1, p.stitchLengthMm);
  const verts = path.map(toV);
  const entry = verts[0];
  const exit = verts[verts.length - 1];
  switch (type as Exclude<RunType, "manual">) {
    case "single":
      return [new Core.Runs.Run(verts, { stitchLengthMm: len, ...tolOpt })];
    case "triple":
      // Bean stitch: every stitch is sewn forward, back, forward (three needle drops per hop).
      return [new Core.Runs.Bean(verts, entry, exit, { repeatsPattern: [2], stitchLengthMm: len, ...tolOpt })];
    case "satin": {
      const sp: SatinParams = { ...DEFAULT_SATIN_PARAMS, widthMm: p.widthMm ?? 2, ...p.satin };
      const width = p.widthMm ?? sp.widthMm;
      let strip = stripFromCentreline(path, width);
      strip = widenStrip(strip, sp.pullCompMm);
      return [new Core.Runs.ClassicSatin(strip.map(toV), satinOptions(sp))];
    }
    case "estitch":
      return [
        new Core.Runs.EStitch(verts, {
          startPosition: entry,
          endPosition: exit,
          widthMm: p.widthMm ?? 3,
          isFlipped: p.flipped ?? false,
          stitchLengthMm: len,
          stitchToleranceMm: Math.max(0.1, p.toleranceMm ?? 1),
        }),
      ];
    case "doublerope":
      return [new Core.Runs.DoubleRope(verts, { widthMm: p.widthMm ?? 0.4, startPosition: entry, endPosition: exit, stitchLengthMm: len, ...tolOpt })];
    case "triplerope":
      return [new Core.Runs.TripleRope(verts, { widthMm: p.widthMm ?? 0.4, startPosition: entry, endPosition: exit, stitchLengthMm: len, ...tolOpt })];
  }
  return [];
}
