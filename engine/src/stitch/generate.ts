import { Core, Math as StitchMath } from "@stitchables/stitchjs";
import { bufferGeom, polygonFromRings, polygonsOf, ringsOf } from "../geom";
import type { Design, DesignObject, FillObject, FillUnderlay, Pt, SatinObject } from "../model";
import { DEFAULT_FILL_PATTERN, patternInfo } from "../model";
import { generateFill, hashString } from "./fills";
import type { PlanStitch, PlanWarning, StitchPlan, StitchType } from "./plan";
import { PX, STITCHJS_JUMP, closedV, polylineRun, reversedStrip, runObjectRuns, satinOptions, toV, widenStrip, type IRun } from "./runs";

const { Polyline } = StitchMath;

/** Moves shorter than this (mm) are not worth a jump. */
const SAME_SPOT_MM = 0.05;
const UNDERLAY_INSET_MM = 0.5;
const EDGE_RUN_STITCH_MM = 2;
const UNDERLAY_ROW_SPACING_MM = 2.5;
const UNDERLAY_STITCH_MM = 3.5;
/** Fills smaller than this (mm^2) get no underlay: it would be all edge. */
const UNDERLAY_MIN_AREA_MM2 = 6;

/**
 * Stitch generation for object kinds this file doesn't know. Lettering (M4) registers `"text"`
 * here: `runs` turns the object into stitchjs-style runs, `centre` (optional) says where the object
 * sits so the previous object can aim its exit at it.
 */
export interface ObjectGenerator {
  runs: (o: DesignObject, from: Pt, next: Pt) => IRun[];
  centre?: (o: DesignObject) => Pt;
}
const EXTRA_GENERATORS = new Map<string, ObjectGenerator>();
export function registerObjectGenerator(kind: string, gen: ObjectGenerator): void {
  EXTRA_GENERATORS.set(kind, gen);
}

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
  const extra = EXTRA_GENERATORS.get(o.kind)?.centre;
  if (extra) return extra(o);
  const pts: readonly Pt[] = o.kind === "fill" ? o.geometry.shell : o.kind === "satin" ? o.geometry.strip : o.kind === "run" ? o.geometry.path : [[0, 0]];
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

type Rings = { shell: Pt[]; holes: Pt[][] };

function tatami(rings: Rings, ang: number, spacing: number, stitchLen: number, from: Pt, next: Pt): IRun {
  const start = toV(nearest(rings.shell, from));
  const end = toV(nearest(rings.shell, next));
  return new Core.Runs.TatamiFill(
    Polyline.fromVectors(closedV(rings.shell.map(toV)), true as never),
    rings.holes.map((h) => Polyline.fromVectors(closedV(h.map(toV)), true as never)),
    ang,
    spacing,
    stitchLen,
    3,
    start,
    end,
  );
}

const rad = (deg: number) => (deg * Math.PI) / 180;

function fillRuns(o: FillObject, from: Pt, next: Pt): IRun[] {
  const p = o.params;
  const poly = polygonFromRings(o.geometry.shell, o.geometry.holes);
  const grown = p.pullCompMm > 0 ? bufferGeom(poly, p.pullCompMm) : poly;
  const runs: IRun[] = [];
  const enter = o.startPoint ?? from;
  const leave = o.endPoint ?? next;
  const pattern = p.pattern ?? DEFAULT_FILL_PATTERN;
  const hand = p.handStitch ?? 0;
  // Plain tatami keeps stitchjs's router; anything else (patterns, gradient, hand stitch) is ours.
  const usePatternEngine = pattern !== DEFAULT_FILL_PATTERN || !!p.gradient || hand > 0;
  // Open patterns (motifs, crosshatch...) would show a plain underlay through their gaps, so only
  // hand-made underlay passes apply to them.
  const autoUnderlay = p.underlay && patternInfo(pattern).underlay;
  const underlays: FillUnderlay[] =
    p.underlays ?? (autoUnderlay ? [{ angleDeg: p.angleDeg + 90, spacingMm: UNDERLAY_ROW_SPACING_MM, stitchLengthMm: UNDERLAY_STITCH_MM, insetMm: UNDERLAY_INSET_MM }] : []);

  for (const part of polygonsOf(grown)) {
    if (part.getArea() < 0.05) continue;
    if (part.getArea() >= UNDERLAY_MIN_AREA_MM2) {
      if (p.edgeWalk) {
        // Edge walk first: a fence of running stitches just inside the edge (shell and holes).
        for (const inner of polygonsOf(bufferGeom(part, -Math.max(0, p.edgeWalk.insetMm)))) {
          if (inner.getArea() < 0.2) continue;
          const iring = ringsOf(inner);
          for (const ring of [iring.shell, ...iring.holes]) {
            const k = ring.indexOf(nearest(ring, enter));
            const rot = [...ring.slice(k), ...ring.slice(0, k)];
            runs.push(new Core.Runs.Run(closedV(rot.map(toV)), { stitchLengthMm: Math.max(0.5, p.edgeWalk.stitchLengthMm) }));
          }
        }
      }
      for (const u of underlays) {
        for (const inner of polygonsOf(bufferGeom(part, -Math.max(0, u.insetMm)))) {
          if (inner.getArea() < 0.5) continue;
          runs.push(tatami(ringsOf(inner), rad(u.angleDeg), Math.max(0.2, u.spacingMm), Math.max(0.5, u.stitchLengthMm), enter, leave));
        }
      }
    }
    const rings = ringsOf(part);
    if (usePatternEngine) {
      const chains = generateFill({
        poly: part,
        pattern,
        patternParams: p.patternParams,
        angleDeg: p.angleDeg,
        rowSpacingMm: p.rowSpacingMm,
        stitchLengthMm: p.stitchLengthMm,
        handStitch: hand,
        seed: p.seed ?? hashString(o.id),
        underpath: p.underpath,
        gradient: p.gradient,
        center: p.center,
        guides: p.guides,
        from: enter,
      });
      if (chains.length) runs.push(polylineRun(chains));
    } else {
      runs.push(tatami(rings, rad(p.angleDeg), p.rowSpacingMm, p.stitchLengthMm, enter, leave));
    }
    if (p.edgeRun !== false) {
      for (const ring of [rings.shell, ...rings.holes]) {
        // start at the vertex nearest the needle so the outline doesn't add a long jump
        const k = ring.indexOf(nearest(ring, enter));
        const rot = [...ring.slice(k), ...ring.slice(0, k)];
        runs.push(new Core.Runs.Run(closedV(rot.map(toV)), { stitchLengthMm: EDGE_RUN_STITCH_MM }));
      }
    }
  }
  return runs;
}

function satinRuns(o: SatinObject, from: Pt): IRun[] {
  let strip = widenStrip(o.geometry.strip, o.params.pullCompMm);
  const mid = (i: number): Pt => [(strip[i][0] + strip[i + 1][0]) / 2, (strip[i][1] + strip[i + 1][1]) / 2];
  const a = mid(0);
  const b = mid(strip.length - 2);
  const anchor = o.startPoint ?? from;
  const da = (a[0] - anchor[0]) ** 2 + (a[1] - anchor[1]) ** 2;
  const db = (b[0] - anchor[0]) ** 2 + (b[1] - anchor[1]) ** 2;
  if (db < da) strip = reversedStrip(strip);
  return [new Core.Runs.ClassicSatin(strip.map(toV), satinOptions(o.params) as never)];
}

/** A run whose stitch length is at least this is "manual": every path point is one needle drop, in order. */
export { MANUAL_STITCH_LENGTH_MM } from "./runs";

/**
 * Turn a design into a flat, machine-oriented list of needle moves.
 *
 * Each object becomes one or more stitchjs runs (TatamiFill or a pattern fill for fills, with
 * underlay; ClassicSatin for satins; one of the seven run types for runs). Runs are evaluated
 * eagerly, one after another, so each can start near where the needle currently is. Between objects
 * we emit a `jump` (the later `validatePlan` upgrades long ones to `trim`) followed by a stitch at
 * the landing point, and a `colorChange` whenever the thread differs from the previous object's.
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
      const extra = EXTRA_GENERATORS.get(o.kind);
      runs = extra ? extra.runs(o, cur, next) : o.kind === "fill" ? fillRuns(o, cur, next) : o.kind === "satin" ? satinRuns(o, cur) : runObjectRuns(o, cur);
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
    if (prev && s.type === "stitch" && prev.type === "stitch" && Math.hypot(s.x - prev.x, s.y - prev.y) < 0.02) {
      continue;
    }
    out.push(s);
  }
  return out;
}

export type { StitchType };
export type { IRun } from "./runs";
