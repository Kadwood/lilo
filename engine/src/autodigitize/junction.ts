import { Coordinate } from "jsts/org/locationtech/jts/geom";
import { bufferGeom, factory, unionAll, type Geom } from "../geom";
import type { Pt } from "../model";
import { stripPolygon } from "./spine";

/**
 * Junctions between satin columns (the crotch of a W, the arm and leg of a K, the lens where two O's
 * cross). The skeleton cuts every branch at the junction node but each rung is cast out to the
 * outline, so neighbouring columns lie on top of each other over the whole wedge; two layers of
 * satin there make a hard, high lump that breaks needles and shows as a dark patch (the validator's
 * density warning). Digitizers butt the columns and let them overlap by a hair, about the width of
 * one thread, so there is no gap and no stack [UNVERIFIED as a numeric norm: practitioners say
 * "overlap a little", 0.3-0.5 mm is the working range here].
 *
 * `trimJunctions` shortens each strip's ends until it reaches `overlapMm` inside the other columns.
 */

type V = readonly [number, number];

const mid = (l: Pt, r: Pt): V => [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2];
const meanWidth = (strip: readonly Pt[]): number => {
  let n = 0;
  let k = 0;
  for (let i = 0; i + 1 < strip.length; i += 2) {
    n += Math.hypot(strip[i][0] - strip[i + 1][0], strip[i][1] - strip[i + 1][1]);
    k++;
  }
  return k ? n / k : 0;
};
const centreLength = (strip: readonly Pt[]): number => {
  let n = 0;
  for (let i = 2; i + 1 < strip.length; i += 2) {
    const a = mid(strip[i - 2], strip[i - 1]);
    const b = mid(strip[i], strip[i + 1]);
    n += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return n;
};

/** Insert linearly interpolated rungs so no two neighbours are further than `stepMm` apart (centre to centre). */
export function resampleStrip(strip: readonly Pt[], stepMm: number): Pt[] {
  const out: Pt[] = [strip[0], strip[1]];
  for (let i = 2; i + 1 < strip.length; i += 2) {
    const a = mid(strip[i - 2], strip[i - 1]);
    const b = mid(strip[i], strip[i + 1]);
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / stepMm));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const l0 = strip[i - 2];
      const r0 = strip[i - 1];
      const l1 = strip[i];
      const r1 = strip[i + 1];
      out.push([l0[0] + (l1[0] - l0[0]) * t, l0[1] + (l1[1] - l0[1]) * t], [r0[0] + (r1[0] - r0[0]) * t, r0[1] + (r1[1] - r0[1]) * t]);
    }
  }
  return out;
}

/**
 * Skeleton centre lines often hook into the junction node at the very end of a branch (a few tenths
 * of a millimetre running sideways), which sews as a stray bar across the column. Cut the end rungs
 * that point more than `maxTurnDeg` away from the direction of the column 1 mm further in.
 */
export function cutHooks(strip: readonly Pt[], maxTurnDeg = 50): Pt[] {
  const rs = resampleStrip(strip, STEP_MM);
  const n = rs.length / 2;
  if (n < 12) return [...strip];
  const c = Array.from({ length: n }, (_, i) => mid(rs[2 * i], rs[2 * i + 1]));
  const cos = Math.cos((maxTurnDeg * Math.PI) / 180);
  const dirAt = (i: number, j: number): V => {
    const dx = c[j][0] - c[i][0];
    const dy = c[j][1] - c[i][1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  const back = (i: number, mm: number): number => Math.max(0, i - Math.round(mm / STEP_MM));
  let a = 0;
  let b = n - 1;
  // start: reference direction from rung ~0.9 mm to ~1.5 mm in; walk the start forward while it disagrees
  const refA = dirAt(Math.min(n - 1, Math.round(0.9 / STEP_MM)), Math.min(n - 1, Math.round(1.5 / STEP_MM)));
  // A rung stands wrong when it is tilted more than `maxTurnDeg` from perpendicular to the reference direction.
  const rungOk = (i: number, ref: V): boolean => {
    const rx = rs[2 * i + 1][0] - rs[2 * i][0];
    const ry = rs[2 * i + 1][1] - rs[2 * i][1];
    const l = Math.hypot(rx, ry) || 1;
    return Math.abs((rx * ref[0] + ry * ref[1]) / l) <= Math.sin((maxTurnDeg * Math.PI) / 180);
  };
  while (a < n / 3) {
    const d = dirAt(a, Math.min(n - 1, a + 2));
    if (d[0] * refA[0] + d[1] * refA[1] >= cos && rungOk(a, refA)) break;
    a++;
  }
  const refB = dirAt(back(n - 1, 1.5), back(n - 1, 0.9));
  while (b > (2 * n) / 3) {
    const d = dirAt(Math.max(0, b - 2), b);
    if (d[0] * refB[0] + d[1] * refB[1] >= cos && rungOk(b, refB)) break;
    b--;
  }
  if (a === 0 && b === n - 1) return [...strip];
  const out = rs.slice(2 * a, 2 * b + 2);
  return out.length >= 4 && centreLength(out) >= MIN_KEEP_MM ? out : [...strip];
}

const STEP_MM = 0.15;
/** A strip left with less centre line than this after trimming is a stub inside its neighbours: dropped. */
const MIN_KEEP_MM = 0.8;

function inside(g: Geom, p: V): boolean {
  return g.contains(factory.createPoint(new Coordinate(p[0], p[1])));
}

/**
 * Trim both ends of `strip` back until the end rung sits at most `overlapMm` inside `others`.
 * Returns the strip untouched when its ends are clear of the others, or null when nothing worth
 * sewing is left.
 */
export function trimStripEnds(strip: readonly Pt[], others: readonly { poly: Geom; widthMm: number }[], overlapMm: number): Pt[] | null {
  if (others.length === 0) return [...strip];
  // Erode each neighbour by the overlap, but never past 30 % of its own width: a 0.8 mm hairline
  // column has to leave a core to trim against, or crossing hairlines would never retreat.
  const cores = others.map((o) => bufferGeom(o.poly, -Math.min(overlapMm, 0.3 * o.widthMm))).filter((g: Geom) => !g.isEmpty());
  if (cores.length === 0) return [...strip];
  const eroded = cores.length === 1 ? cores[0] : unionAll(cores);
  if (eroded.isEmpty()) return [...strip];
  // Cheap exit: neither end rung touches the eroded neighbours.
  const n0 = strip.length;
  if (!inside(eroded, mid(strip[0], strip[1])) && !inside(eroded, mid(strip[n0 - 2], strip[n0 - 1]))) return [...strip];
  const rs = resampleStrip(strip, STEP_MM);
  let a = 0;
  let b = rs.length / 2 - 1;
  while (a < b && inside(eroded, mid(rs[2 * a], rs[2 * a + 1]))) a++;
  while (b > a && inside(eroded, mid(rs[2 * b], rs[2 * b + 1]))) b--;
  if (a === 0 && b === rs.length / 2 - 1) return [...strip];
  const out = rs.slice(2 * a, 2 * b + 2);
  if (out.length < 4 || centreLength(out) < MIN_KEEP_MM) return null;
  return out;
}

/**
 * Trim a set of strips that belong to one shape so they overlap by about `overlapMm` instead of
 * stacking. Smaller columns yield first (they are the ones sitting on a bigger neighbour), then
 * larger ones are checked against the trimmed result. Strips that vanish are removed. Returns the
 * indexes of the strips that survive with their new geometry.
 */
export function trimJunctions(strips: readonly (readonly Pt[])[], overlapMm: number): ({ index: number; strip: Pt[] })[] {
  const hooked = strips.map((s) => cutHooks(s));
  const polys: (Geom | null)[] = hooked.map((s) => stripPolygon(s));
  const area = (i: number) => polys[i]?.getArea() ?? 0;
  const order = strips.map((_, i) => i).sort((x, y) => area(x) - area(y));
  const cur: (Pt[] | null)[] = hooked.map((s) => [...s]);
  if (strips.length > 1 && strips.length <= 60) {
    for (const i of order) {
      const others: { poly: Geom; widthMm: number }[] = [];
      polys.forEach((p, j) => {
        if (j !== i && p && cur[j]) others.push({ poly: p, widthMm: meanWidth(cur[j]!) });
      });
      if (others.length === 0 || !cur[i]) continue;
      const trimmed = trimStripEnds(cur[i]!, others, overlapMm);
      cur[i] = trimmed;
      polys[i] = trimmed ? stripPolygon(trimmed) : null;
    }
  }
  const out: { index: number; strip: Pt[] }[] = [];
  cur.forEach((s, index) => {
    if (s) out.push({ index, strip: s });
  });
  return out;
}
