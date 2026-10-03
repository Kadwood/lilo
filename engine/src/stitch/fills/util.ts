import { Coordinate } from "jsts/org/locationtech/jts/geom";
import { factory, type Geom, type Poly } from "../../geom";
import type { Pt } from "../../model";

/** Small deterministic PRNG (mulberry32). Same seed, same sequence, on every machine. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string, for deriving per-object seeds. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Insert points so no edge is longer than `maxLen`. */
export function densify(pts: readonly Pt[], maxLen: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i > 0) {
      const q = pts[i - 1];
      const d = dist(p, q);
      const n = Math.ceil(d / maxLen);
      for (let k = 1; k < n; k++) out.push([q[0] + ((p[0] - q[0]) * k) / n, q[1] + ((p[1] - q[1]) * k) / n]);
    }
    out.push(p);
  }
  return out;
}

/** Drop consecutive points closer than `minGap`, always keeping the first and last. */
export function tidy(pts: readonly Pt[], minGap: number): Pt[] {
  if (pts.length <= 2) return [...pts];
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    if (dist(pts[i], out[out.length - 1]) >= minGap) out.push(pts[i]);
  }
  const last = pts[pts.length - 1];
  if (out.length > 1 && dist(last, out[out.length - 1]) < minGap) out.pop();
  out.push(last);
  return out;
}

export const lineString = (pts: readonly Pt[]): Geom => factory.createLineString(pts.map(([x, y]) => new Coordinate(x, y)));

/** The line pieces of `pts` that lie inside `poly`. Pieces keep the direction of `pts`. */
export function clipLine(poly: Poly, pts: readonly Pt[]): Pt[][] {
  if (pts.length < 2) return [];
  let r: Geom;
  try {
    r = lineString(pts).intersection(poly);
  } catch {
    return [];
  }
  if (r.isEmpty()) return [];
  const out: Pt[][] = [];
  const walk = (g: Geom): void => {
    const t = g.getGeometryType();
    if (t === "LineString" || t === "LinearRing") {
      const c = g.getCoordinates() as Coordinate[];
      if (c.length >= 2) out.push(c.map((p) => [p.x, p.y] as Pt));
    } else if (t === "MultiLineString" || t === "GeometryCollection") {
      for (let i = 0; i < g.getNumGeometries(); i++) walk(g.getGeometryN(i));
    }
  };
  walk(r);
  return out;
}

/** Even-odd point-in-polygon over shell + holes. */
export function pointInRings(p: Pt, shell: readonly Pt[], holes: readonly (readonly Pt[])[]): boolean {
  const inside = (ring: readonly Pt[]): boolean => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  if (!inside(shell)) return false;
  for (const h of holes) if (inside(h)) return false;
  return true;
}

/** Total length of a polyline. */
export function pathLength(pts: readonly Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i], pts[i - 1]);
  return l;
}

/** Resample a polyline at equal arc-length steps (always keeps the end). */
export function resampleEven(pts: readonly Pt[], step: number): Pt[] {
  if (pts.length < 2) return [...pts];
  const out: Pt[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = dist(a, b);
    if (d === 0) continue;
    let at = step - carry;
    while (at <= d) {
      const t = at / d;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      at += step;
    }
    carry = d - (at - step);
  }
  const last = pts[pts.length - 1];
  if (dist(out[out.length - 1], last) > 1e-6) out.push(last);
  return out;
}
