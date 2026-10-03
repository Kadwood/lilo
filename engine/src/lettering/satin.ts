import type { Pt } from "../model";

/**
 * Ink/Stitch satin columns (two rails + rungs) to Lilo's quad strip `[l0, r0, l1, r1, ...]`.
 *
 * Ported from the idea in Ink/Stitch `lib/elements/satin_column.py`: rungs cut both rails into
 * sections; inside a section the two rails are walked in step (proportional arc length), so
 * a curved column keeps its stitches perpendicular-ish and a rung forces the exact stitch direction
 * where the digitizer wanted a corner.
 */

type V = readonly [number, number];

const dist = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Flat `[x, y, ...]` -> points. */
export function toPts(flat: readonly number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

interface Line {
  pts: Pt[];
  /** cum[i] = arc length at pts[i]. */
  cum: number[];
  length: number;
}

function lineOf(pts: Pt[]): Line {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  return { pts, cum, length: cum[cum.length - 1] };
}

function pointAt(l: Line, s: number): Pt {
  if (s <= 0) return l.pts[0];
  if (s >= l.length) return l.pts[l.pts.length - 1];
  // binary search the segment
  let lo = 0;
  let hi = l.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (l.cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = l.cum[hi] - l.cum[lo] || 1;
  const t = (s - l.cum[lo]) / seg;
  return [l.pts[lo][0] + (l.pts[hi][0] - l.pts[lo][0]) * t, l.pts[lo][1] + (l.pts[hi][1] - l.pts[lo][1]) * t];
}

/** Segment (p, p+r) x (q, q+s): parameters (t along p-seg, u along q-seg) or null. */
function segIntersect(p: V, p2: V, q: V, q2: V): [number, number] | null {
  const rx = p2[0] - p[0];
  const ry = p2[1] - p[1];
  const sx = q2[0] - q[0];
  const sy = q2[1] - q[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((q[0] - p[0]) * sy - (q[1] - p[1]) * sx) / den;
  const u = ((q[0] - p[0]) * ry - (q[1] - p[1]) * rx) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [t, u];
}

/** Arc-length position on `rail` where `rung` crosses it (or the closest approach if it doesn't). */
function railPosition(rail: Line, rung: Pt[]): number {
  let best: number | null = null;
  for (let i = 0; i + 1 < rung.length; i++) {
    for (let j = 0; j + 1 < rail.pts.length; j++) {
      const hit = segIntersect(rung[i], rung[i + 1], rail.pts[j], rail.pts[j + 1]);
      if (hit) {
        const s = rail.cum[j] + hit[1] * (rail.cum[j + 1] - rail.cum[j]);
        if (best === null || s < best) best = s; // first crossing along the rail
      }
    }
  }
  if (best !== null) return best;
  // Closest approach: nearest rail vertex/segment point to any rung vertex.
  let bd = Infinity;
  let bs = 0;
  for (const q of rung) {
    for (let j = 0; j + 1 < rail.pts.length; j++) {
      const a = rail.pts[j];
      const b = rail.pts[j + 1];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2));
      const d = Math.hypot(a[0] + dx * t - q[0], a[1] + dy * t - q[1]);
      if (d < bd) {
        bd = d;
        bs = rail.cum[j] + t * (rail.cum[j + 1] - rail.cum[j]);
      }
    }
  }
  return bs;
}

function build(r1: Line, r2: Line, rungs: Pt[][], spacing: number): { strip: Pt[]; reversedScore: number } {
  // Breakpoints (s1, s2) sorted by s1.
  const raw = rungs.map((r) => ({ s1: railPosition(r1, r), s2: railPosition(r2, r) })).sort((a, b) => a.s1 - b.s1);
  let up = 0;
  let down = 0;
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].s2 > raw[i - 1].s2 + 1e-9) up++;
    else if (raw[i].s2 < raw[i - 1].s2 - 1e-9) down++;
  }
  // Keep a monotone chain (drop rungs that would make a rail double back).
  const marks: { s1: number; s2: number }[] = [{ s1: 0, s2: 0 }];
  for (const m of raw) {
    const last = marks[marks.length - 1];
    if (m.s1 > last.s1 + 1e-6 && m.s2 > last.s2 + 1e-6 && m.s1 < r1.length - 1e-6 && m.s2 < r2.length - 1e-6) marks.push(m);
  }
  marks.push({ s1: r1.length, s2: r2.length });

  const strip: Pt[] = [];
  for (let k = 0; k + 1 < marks.length; k++) {
    const a = marks[k];
    const b = marks[k + 1];
    const n = Math.max(1, Math.ceil(Math.max(b.s1 - a.s1, b.s2 - a.s2) / spacing));
    for (let i = k === 0 ? 0 : 1; i <= n; i++) {
      const t = i / n;
      strip.push(pointAt(r1, a.s1 + (b.s1 - a.s1) * t), pointAt(r2, a.s2 + (b.s2 - a.s2) * t));
    }
  }
  return { strip, reversedScore: down - up };
}

/**
 * Quad strip for a satin column.
 * @param rails two rails (flat xy arrays or points), in mm
 * @param rungs rungs crossing both rails (may be empty)
 * @param spacingMm distance between sampled left/right pairs along curved parts (default 0.6 mm)
 */
export function railsToStrip(
  rails: readonly [readonly number[] | readonly Pt[], readonly number[] | readonly Pt[]],
  rungs: readonly (readonly number[] | readonly Pt[])[] = [],
  spacingMm = 0.6,
): Pt[] {
  const asPts = (p: readonly number[] | readonly Pt[]): Pt[] => (typeof p[0] === "number" ? toPts(p as readonly number[]) : [...(p as readonly Pt[])]);
  const p1 = asPts(rails[0]);
  const p2 = asPts(rails[1]);
  if (p1.length < 2 || p2.length < 2) return [];
  const rr = rungs.map(asPts).filter((r) => r.length >= 2);
  const l1 = lineOf(p1);
  const l2 = lineOf(p2);
  if (l1.length < 1e-6 || l2.length < 1e-6) return [];
  let out = build(l1, l2, rr, spacingMm);
  if (rr.length > 1 && out.reversedScore > 0) {
    out = build(l1, lineOf([...l2.pts].reverse()), rr, spacingMm);
  }
  return out.strip;
}

/** Width (mm) of a strip at pair `i` (distance between left and right). */
export function stripWidths(strip: readonly Pt[]): number[] {
  const w: number[] = [];
  for (let i = 0; i + 1 < strip.length; i += 2) w.push(dist(strip[i], strip[i + 1]));
  return w;
}
