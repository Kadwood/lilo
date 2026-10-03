import { Core, Math as StitchMath } from "@stitchables/stitchjs";
import { bufferGeom, polygonFromRings, polygonsOf, ringsOf } from "../geom";
import type { Design, DesignObject, FillObject, RunObject, SatinObject, Pt } from "../model";
import type { PlanStitch, PlanWarning, StitchPlan, StitchType } from "./plan";

const { Vector, Polyline } = StitchMath;
type IRun = { getStitches: (pixelsPerMm: number) => InstanceType<typeof Core.Stitch>[] };
type V = InstanceType<typeof Vector>;

/**
 * stitchjs works in "px" and takes a px-per-mm factor. We author everything in mm and run it at a
 * fixed 10 px/mm, then divide back, so geometry never touches stitchjs in raw mm.
 */
const PX = 10;
/** stitchjs's `StitchType.JUMP` (the enum is not exported at runtime): 0 NORMAL, 1 JUMP, 2 COLOR_CHANGE, 3 TRIM... */
const STITCHJS_JUMP = 1;
/** Moves shorter than this (mm) are not worth a jump. */
const SAME_SPOT_MM = 0.05;
const UNDERLAY_INSET_MM = 0.5;
const EDGE_RUN_STITCH_MM = 2;
const UNDERLAY_ROW_SPACING_MM = 2.5;
const UNDERLAY_STITCH_MM = 3.5;
/** Fills smaller than this (mm^2) get no underlay: it would be all edge. */
const UNDERLAY_MIN_AREA_MM2 = 6;

const toV = (p: Pt): V => new Vector(p[0] * PX, p[1] * PX);
const closed = (pts: V[]): V[] => (pts.length && pts[0].distance(pts[pts.length - 1]) > 1e-9 ? [...pts, pts[0]] : pts);

function nearest(pts: readonly Pt[], to: Pt): Pt {
  let best = pts[0];
  let bd = Infinity;
  for (const p of pts) {
    const d = (p[0] - to[0]) ** 2 + (p[1] - to[1]) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function centreOf(o: DesignObject): Pt {
  const pts = o.kind === "fill" ? o.geometry.shell : o.kind === "satin" ? o.geometry.strip : o.geometry.path;
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

function fillRuns(o: FillObject, from: Pt, next: Pt): IRun[] {
  const p = o.params;
  const poly = polygonFromRings(o.geometry.shell, o.geometry.holes);
  const grown = p.pullCompMm > 0 ? bufferGeom(poly, p.pullCompMm) : poly;
  const runs: IRun[] = [];
  const angle = (p.angleDeg * Math.PI) / 180;

  const tatami = (rings: { shell: Pt[]; holes: Pt[][] }, ang: number, spacing: number, stitchLen: number): IRun => {
    const start = toV(nearest(rings.shell, from));
    const end = toV(nearest(rings.shell, next));
    return new Core.Runs.TatamiFill(
      Polyline.fromVectors(closed(rings.shell.map(toV)), true as never),
      rings.holes.map((h) => Polyline.fromVectors(closed(h.map(toV)), true as never)),
      ang,
      spacing,
      stitchLen,
      3,
      start,
      end,
    );
  };

  for (const part of polygonsOf(grown)) {
    if (part.getArea() < 0.05) continue;
    if (p.underlay && part.getArea() >= UNDERLAY_MIN_AREA_MM2) {
      for (const inner of polygonsOf(bufferGeom(part, -UNDERLAY_INSET_MM))) {
        if (inner.getArea() < 0.5) continue;
        runs.push(tatami(ringsOf(inner), angle + Math.PI / 2, UNDERLAY_ROW_SPACING_MM, UNDERLAY_STITCH_MM));
      }
    }
    const rings = ringsOf(part);
    runs.push(tatami(rings, angle, p.rowSpacingMm, p.stitchLengthMm));
    if (p.edgeRun !== false) {
      for (const ring of [rings.shell, ...rings.holes]) {
        // start at the vertex nearest the needle so the outline doesn't add a long jump
        const k = ring.indexOf(nearest(ring, from));
        const rot = [...ring.slice(k), ...ring.slice(0, k)];
        runs.push(new Core.Runs.Run(closed(rot.map(toV)), { stitchLengthMm: EDGE_RUN_STITCH_MM }));
      }
    }
  }
  return runs;
}

/** Widen a left/right strip by `pc` mm on each side. */
function widenStrip(strip: readonly Pt[], pc: number): Pt[] {
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

function reversedStrip(strip: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = strip.length - 2; i >= 0; i -= 2) out.push(strip[i], strip[i + 1]);
  return out;
}

function satinRuns(o: SatinObject, from: Pt): IRun[] {
  let strip = widenStrip(o.geometry.strip, o.params.pullCompMm);
  const mid = (i: number): Pt => [(strip[i][0] + strip[i + 1][0]) / 2, (strip[i][1] + strip[i + 1][1]) / 2];
  const a = mid(0);
  const b = mid(strip.length - 2);
  const da = (a[0] - from[0]) ** 2 + (a[1] - from[1]) ** 2;
  const db = (b[0] - from[0]) ** 2 + (b[1] - from[1]) ** 2;
  if (db < da) strip = reversedStrip(strip);
  const underlays: { type: string }[] =
    o.params.underlay === "center"
      ? [{ type: "CENTER_LINE" }]
      : o.params.underlay === "contour"
        ? [{ type: "CONTOUR" }]
        : o.params.underlay === "zigzag"
          ? [{ type: "ZIGZAG" }]
          : [];
  return [new Core.Runs.ClassicSatin(strip.map(toV), { densityMm: o.params.densityMm, underlays })];
}

/** A run whose stitch length is at least this is "manual": every path point is one needle drop, in order. */
export const MANUAL_STITCH_LENGTH_MM = 1000;

function runRuns(o: RunObject, from: Pt): IRun[] {
  if (o.params.stitchLengthMm >= MANUAL_STITCH_LENGTH_MM) {
    const pts = o.geometry.closed ? [...o.geometry.path, o.geometry.path[0]] : o.geometry.path;
    const stitches = pts.map((p) => ({ position: { x: p[0] * PX, y: p[1] * PX }, stitchType: 0 }));
    return [{ getStitches: () => stitches as unknown as InstanceType<typeof Core.Stitch>[] }];
  }
  let path = [...o.geometry.path];
  if (o.geometry.closed) path.push(path[0]);
  const first = path[0];
  const last = path[path.length - 1];
  if ((last[0] - from[0]) ** 2 + (last[1] - from[1]) ** 2 < (first[0] - from[0]) ** 2 + (first[1] - from[1]) ** 2) {
    path = path.reverse();
  }
  if (o.params.repeats === 3) {
    const back = [...path].reverse().slice(1);
    path = [...path, ...back, ...path.slice(1)];
  }
  return [new Core.Runs.Run(path.map(toV), { stitchLengthMm: o.params.stitchLengthMm })];
}

/**
 * Turn a design into a flat, machine-oriented list of needle moves.
 *
 * Each object becomes one or more stitchjs runs (TatamiFill for fills, with a perpendicular
 * underlay; ClassicSatin for satins; Run for runs). Runs are evaluated eagerly, one after another,
 * so each can start near where the needle currently is. Between objects we emit a `jump` (the
 * later `validatePlan` upgrades long ones to `trim`) followed by a stitch at the landing point, and
 * a `colorChange` whenever the thread differs from the previous object's.
 *
 * Hidden objects are skipped. An object whose generation throws is skipped with an
 * `object-failed` warning rather than failing the whole design.
 */
export function designToStitchPlan(design: Design): StitchPlan {
  const threadsById = new Map(design.threads.map((t) => [t.id, t]));
  const warnings: PlanWarning[] = [];
  const stitches: PlanStitch[] = [];
  const blocks: StitchPlan["threads"] = [];

  const visible = design.objects.map((o, index) => ({ o, index })).filter(({ o }) => o.visible !== false);
  let cur: Pt = [0, 0];
  let curThreadId: string | null = null;

  visible.forEach(({ o, index }, vi) => {
    const thread = threadsById.get(o.threadId);
    if (!thread) {
      warnings.push({ code: "object-failed", message: `Object "${o.name}" uses an unknown thread`, objectId: o.id });
      return;
    }
    const nextObj = visible[vi + 1]?.o;
    const next: Pt = nextObj ? centreOf(nextObj) : cur;

    let runs: IRun[];
    let produced: PlanStitch[] = [];
    try {
      runs = o.kind === "fill" ? fillRuns(o, cur, next) : o.kind === "satin" ? satinRuns(o, cur) : runRuns(o, cur);
      const newBlock = o.threadId !== curThreadId;
      const blockIndex = newBlock ? blocks.length : blocks.length - 1;
      let at: Pt = cur;
      for (const run of runs) {
        let first = true;
        for (const s of run.getStitches(PX)) {
          const x = s.position.x / PX;
          const y = s.position.y / PX;
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          const jump = first || (s.stitchType as number) === STITCHJS_JUMP;
          first = false;
          if (jump && Math.hypot(x - at[0], y - at[1]) > SAME_SPOT_MM) {
            produced.push({ x, y, type: "jump", threadIndex: blockIndex, objectIndex: index });
          }
          produced.push({ x, y, type: "stitch", threadIndex: blockIndex, objectIndex: index });
          at = [x, y];
        }
      }
      if (produced.length === 0) {
        warnings.push({ code: "object-failed", message: `Object "${o.name}" produced no stitches`, objectId: o.id });
        return;
      }
      if (newBlock) {
        blocks.push(thread);
        if (stitches.length > 0) {
          stitches.push({ x: cur[0], y: cur[1], type: "colorChange", threadIndex: blockIndex, objectIndex: -1 });
        }
        curThreadId = o.threadId;
      }
      stitches.push(...produced);
      cur = at;
    } catch (e) {
      produced = [];
      warnings.push({
        code: "object-failed",
        message: `Object "${o.name}" could not be stitched: ${e instanceof Error ? e.message : String(e)}`,
        objectId: o.id,
      });
    }
  });

  return { threads: blocks, stitches: dedupe(stitches), warnings };
}

/** Drop zero-length needle drops (stitchjs repeats points at junctions). */
function dedupe(list: PlanStitch[]): PlanStitch[] {
  const out: PlanStitch[] = [];
  for (const s of list) {
    const prev = out[out.length - 1];
    if (
      prev &&
      s.type === "stitch" &&
      prev.type === "stitch" &&
      Math.hypot(s.x - prev.x, s.y - prev.y) < 0.02
    ) {
      continue;
    }
    out.push(s);
  }
  return out;
}

export type { StitchType };
