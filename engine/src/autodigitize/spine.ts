import { Geometry } from "@stitchables/stitchjs";
import { polygonFromRings, ringsOf, type Poly } from "../geom";
import type { Pt } from "../model";

/**
 * Medial-axis ("spine") extraction for thin shapes, via stitchjs's straight skeleton (str8/CGAL
 * WASM; call stitchjs `init()` once before using this). The straight skeleton of a stroke-like
 * polygon is a tree/graph whose interior edges run along the stroke's centre; `time` at each node is
 * the distance to the outline there, i.e. half the local stroke width.
 *
 * From it we make:
 * - satin columns: one quad strip (left/right point pairs) per skeleton branch, with each rung cast
 *   perpendicular to the spine out to the real outline, so edges follow the artwork exactly;
 * - run paths: the same branches as plain centre lines.
 */

type V2 = [number, number];
export interface Branch {
  /** Spine points (mm). */
  pts: V2[];
  /** Half-width (distance to outline) at each point. */
  half: number[];
  closed: boolean;
  /** True where the end is a stroke end (leaf) rather than a junction. */
  leafStart: boolean;
  leafEnd: boolean;
}

interface Skeleton {
  vertices: Float32Array;
  faces: number[][];
}

const EPS_TIME = 1e-4;

/** Interior skeleton graph: edges whose both endpoints are away from the outline. */
function spineGraph(sk: Skeleton): { adj: Map<number, Set<number>>; xy: (i: number) => V2; time: (i: number) => number } {
  const v = sk.vertices;
  const xy = (i: number): V2 => [v[i * 3], v[i * 3 + 1]];
  const time = (i: number) => v[i * 3 + 2];
  const adj = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (a === b) return;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  for (const face of sk.faces) {
    for (let k = 0; k < face.length; k++) {
      const a = face[k];
      const b = face[(k + 1) % face.length];
      if (time(a) > EPS_TIME && time(b) > EPS_TIME) link(a, b);
    }
  }
  return { adj, xy, time };
}

/** Remove short leaf chains hanging off junctions (boundary noise, rounded-cap fans). */
function prune(adj: Map<number, Set<number>>, xy: (i: number) => V2, time: (i: number) => number): void {
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const leaf of [...adj.keys()]) {
      if (!adj.has(leaf) || adj.get(leaf)!.size !== 1) continue;
      // Walk the chain from the leaf to the first node that is not degree 2.
      const chain = [leaf];
      let prev = leaf;
      let cur = [...adj.get(leaf)!][0];
      let length = Math.hypot(xy(cur)[0] - xy(leaf)[0], xy(cur)[1] - xy(leaf)[1]);
      while (adj.get(cur)!.size === 2) {
        chain.push(cur);
        const next = [...adj.get(cur)!].find((n) => n !== prev)!;
        length += Math.hypot(xy(next)[0] - xy(cur)[0], xy(next)[1] - xy(cur)[1]);
        prev = cur;
        cur = next;
      }
      const endsAtJunction = adj.get(cur)!.size >= 3;
      if (endsAtJunction && length < Math.max(0.5, 1.2 * time(cur))) {
        for (const n of chain) {
          for (const m of adj.get(n)!) adj.get(m)?.delete(n);
          adj.delete(n);
        }
        changed = true;
      }
    }
    // Collapse nodes that became isolated.
    for (const [k, s] of [...adj]) if (s.size === 0) adj.delete(k);
    if (!changed) break;
  }
}

/** Split the pruned graph into branches between terminals (leaves/junctions); lone cycles too. */
function branchesOf(adj: Map<number, Set<number>>, xy: (i: number) => V2, time: (i: number) => number): Branch[] {
  const out: Branch[] = [];
  const seenEdge = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const isTerminal = (n: number) => adj.get(n)!.size !== 2;
  const walk = (start: number, first: number): Branch => {
    const nodes = [start, first];
    seenEdge.add(key(start, first));
    let prev = start;
    let cur = first;
    while (!isTerminal(cur) && cur !== start) {
      const next = [...adj.get(cur)!].find((n) => n !== prev)!;
      if (seenEdge.has(key(cur, next))) break;
      seenEdge.add(key(cur, next));
      nodes.push(next);
      prev = cur;
      cur = next;
    }
    const closed = nodes[0] === nodes[nodes.length - 1];
    return {
      pts: nodes.map(xy),
      half: nodes.map(time),
      closed,
      leafStart: adj.get(nodes[0])!.size === 1,
      leafEnd: adj.get(nodes[nodes.length - 1])!.size === 1,
    };
  };
  for (const n of adj.keys()) {
    if (!isTerminal(n)) continue;
    for (const m of adj.get(n)!) if (!seenEdge.has(key(n, m))) out.push(walk(n, m));
  }
  // Pure cycles (e.g. a ring): all nodes degree 2, never visited above.
  for (const n of adj.keys()) {
    for (const m of adj.get(n)!) if (!seenEdge.has(key(n, m))) out.push(walk(n, m));
  }
  return out.filter((b) => b.pts.length >= 2);
}

/** Skeleton branches of a (single) polygon, or null if the skeleton is unavailable/degenerate. */
export function skeletonBranches(poly: Poly): Branch[] | null {
  let sk: Skeleton | null | undefined;
  try {
    sk = Geometry.getStraightSkeleton(poly)[0] as Skeleton | null | undefined;
  } catch {
    return null;
  }
  if (!sk || sk.faces.length === 0) return null;
  const { adj, xy, time } = spineGraph(sk);
  if (adj.size === 0) return null;
  prune(adj, xy, time);
  if (adj.size === 0) return null;
  const b = branchesOf(adj, xy, time);
  return b.length ? b : null;
}

// ---------------------------------------------------------------------------------------------
// Ray casting against the outline
// ---------------------------------------------------------------------------------------------

type Edge = [number, number, number, number];

export function edgesOf(poly: Poly): Edge[] {
  const { shell, holes } = ringsOf(poly);
  const edges: Edge[] = [];
  for (const ring of [shell, ...holes]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      edges.push([a[0], a[1], b[0], b[1]]);
    }
  }
  return edges;
}

/** Distance along (dx, dy) from (px, py) to the nearest outline edge, or null if none within `max`. */
function cast(edges: Edge[], px: number, py: number, dx: number, dy: number, max: number): number | null {
  let best = Infinity;
  for (const [ax, ay, bx, by] of edges) {
    const ex = bx - ax;
    const ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((ax - px) * ey - (ay - py) * ex) / den; // along ray
    const u = ((ax - px) * dy - (ay - py) * dx) / den; // along edge
    if (t > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t;
  }
  return best <= max ? best : null;
}

const norm = (x: number, y: number): V2 => {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
};

/** Re-sample a polyline so no segment exceeds `maxSeg` (linear in position and half-width). */
function subdivide(pts: V2[], half: number[], maxSeg: number): { pts: V2[]; half: number[] } {
  const op: V2[] = [pts[0]];
  const oh: number[] = [half[0]];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const n = Math.max(1, Math.ceil(d / maxSeg));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      op.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
      oh.push(half[i - 1] + (half[i] - half[i - 1]) * t);
    }
  }
  return { pts: op, half: oh };
}

/**
 * Turn a branch into a left/right strip. Rungs are perpendicular to the (smoothed) spine direction
 * and run out to the actual outline. Leaf ends are extended to the outline along the spine
 * direction, so a stroke is covered right up to its tip.
 */
export function branchToStrip(b: Branch, edges: Edge[], maxSeg = 1.5): Pt[] | null {
  let pts = b.pts.map((p) => [...p] as V2);
  let half = [...b.half];
  const capIdx = new Set<number>(); // 0 = first point, -1 = last point: flat-cap rungs, not ray-cast

  // Extend leaf ends out to the outline.
  const extend = (atStart: boolean) => {
    const n = pts.length;
    const p = atStart ? pts[0] : pts[n - 1];
    const q = atStart ? pts[Math.min(1, n - 1)] : pts[Math.max(0, n - 2)];
    const [dx, dy] = norm(p[0] - q[0], p[1] - q[1]);
    const h = atStart ? half[0] : half[n - 1];
    const d = cast(edges, p[0], p[1], dx, dy, 2 * h + 1);
    if (d === null || d < 1e-6) return;
    // End flat: stop just short of the tip with the same width (round caps lose their corners,
    // which is what satin columns do anyway) instead of tapering to a point.
    const np: V2 = [p[0] + dx * d * 0.92, p[1] + dy * d * 0.92];
    if (atStart) {
      pts = [np, ...pts];
      half = [h, ...half];
      capIdx.add(0);
    } else {
      pts.push(np);
      half.push(h);
      capIdx.add(-1);
    }
  };
  if (!b.closed) {
    if (b.leafStart) extend(true);
    if (b.leafEnd) extend(false);
  }

  const sub = subdivide(pts, half, maxSeg);
  pts = sub.pts;
  half = sub.half;
  const n = pts.length;
  if (n < 2) return null;

  // Tangent baseline: points about 0.8 mm behind/ahead along the path (clamped to the ends), so
  // tiny skeleton segments don't make the rungs jitter.
  const cum: number[] = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const back: number[] = [];
  const ahead: number[] = [];
  for (let i = 0; i < n; i++) {
    let lo = i;
    while (lo > 0 && cum[i] - cum[lo] < 0.8) lo--;
    let hi = i;
    while (hi < n - 1 && cum[hi] - cum[i] < 0.8) hi++;
    back.push(lo);
    ahead.push(hi);
  }

  const strip: Pt[] = [];
  let prevL: V2 | null = null;
  let prevR: V2 | null = null;
  let prevT: V2 | null = null;
  for (let i = 0; i < n; i++) {
    const a = pts[back[i]];
    const c = pts[ahead[i]];
    let t = norm(c[0] - a[0], c[1] - a[1]);
    if (b.closed && (i === 0 || i === n - 1)) {
      const a2 = pts[n >= 3 ? n - 2 : 0];
      const c2 = pts[1];
      t = norm(c2[0] - a2[0], c2[1] - a2[1]);
    }
    const nx = -t[1];
    const ny = t[0];
    const p = pts[i];
    const reach = Math.max(1.5, 2.5 * half[i]);
    // A rung can't honestly be much longer than the local inscribed radius; where a ray runs on
    // (through the mouth of a junction into another arm) fall back to the radius.
    const limit = 1.35 * half[i] + 0.3;
    const isCap = (i === 0 && capIdx.has(0)) || (i === n - 1 && capIdx.has(-1));
    let dl = isCap ? null : cast(edges, p[0], p[1], nx, ny, reach);
    let dr = isCap ? null : cast(edges, p[0], p[1], -nx, -ny, reach);
    if (dl === null || dl > limit) dl = Math.max(half[i], 0);
    if (dr === null || dr > limit) dr = Math.max(half[i], 0);
    const L: V2 = [p[0] + nx * dl, p[1] + ny * dl];
    const R: V2 = [p[0] - nx * dr, p[1] - ny * dr];
    // Drop rungs that fold back on the inside of a tight bend.
    if (prevL && prevR && prevT) {
      const fl = (L[0] - prevL[0]) * prevT[0] + (L[1] - prevL[1]) * prevT[1];
      const fr = (R[0] - prevR[0]) * prevT[0] + (R[1] - prevR[1]) * prevT[1];
      if (fl < -1e-6 || fr < -1e-6) continue;
    }
    strip.push([L[0], L[1]], [R[0], R[1]]);
    prevL = L;
    prevR = R;
    prevT = t;
  }
  if (strip.length >= 4) return strip;
  // Ray casting failed (a short link between junctions): fall back to constant-radius rungs.
  const plain: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = norm(pts[ahead[i]][0] - pts[back[i]][0], pts[ahead[i]][1] - pts[back[i]][1]);
    const r = Math.max(half[i], 0.05);
    plain.push([pts[i][0] - t[1] * r, pts[i][1] + t[0] * r], [pts[i][0] + t[1] * r, pts[i][1] - t[0] * r]);
  }
  return plain.length >= 4 ? plain : null;
}

/** The polygon covered by a strip (left chain then right chain reversed). */
export function stripPolygon(strip: readonly Pt[]): Poly | null {
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i + 1 < strip.length; i += 2) {
    left.push(strip[i]);
    right.push(strip[i + 1]);
  }
  const ring = [...left, ...right.reverse()];
  if (ring.length < 3) return null;
  try {
    const p = polygonFromRings(ring);
    return p.isValid() ? p : p.buffer(0);
  } catch {
    return null;
  }
}

export interface SatinColumns {
  strips: Pt[][];
  /** Fraction of the polygon's area covered by the strips (0..1). */
  coverage: number;
  /** Total spine length (mm) and mean width, for the elongation test. */
  spineLengthMm: number;
}

/**
 * Satin columns for a stroke-like polygon, or null if the skeleton fails. Callers should check
 * `coverage` and fall back to a fill when it is low.
 */
export function satinColumns(poly: Poly): SatinColumns | null {
  const branches = skeletonBranches(poly);
  if (!branches) return null;
  const edges = edgesOf(poly);
  const strips: Pt[][] = [];
  let spineLength = 0;
  for (const b of branches) {
    const s = branchToStrip(b, edges);
    if (!s) continue;
    strips.push(s);
    for (let i = 1; i < b.pts.length; i++) spineLength += Math.hypot(b.pts[i][0] - b.pts[i - 1][0], b.pts[i][1] - b.pts[i - 1][1]);
  }
  if (strips.length === 0) return null;
  let union: Poly | null = null;
  for (const s of strips) {
    const sp = stripPolygon(s);
    if (!sp || sp.isEmpty()) continue;
    union = union ? union.union(sp) : sp;
  }
  if (!union) return null;
  const covered = union.intersection(poly).getArea();
  return { strips, coverage: Math.min(1, covered / poly.getArea()), spineLengthMm: spineLength };
}

/** Centre-line paths (one per branch) for hairline shapes. */
export function runPaths(poly: Poly): { paths: Pt[][]; closed: boolean[] } | null {
  const branches = skeletonBranches(poly);
  if (!branches) return null;
  return { paths: branches.map((b) => b.pts.map((p) => [p[0], p[1]] as Pt)), closed: branches.map((b) => b.closed) };
}

