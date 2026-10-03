import type { Pt } from "./types";

/**
 * Editable outlines. A drawn shape remembers its nodes so it can be reshaped later; the polyline in
 * `FillGeometry.shell` / `RunGeometry.path` is always the flattened result of those nodes.
 *
 * A node is either a corner (straight lines in and out) or a curve node. A curve node has automatic
 * smooth handles (Catmull-Rom style: the tangent follows the line between its neighbours), so the
 * user only ever toggles "curve" on or off per node and never edits handles.
 *
 * Pure functions, no geometry library: safe to import on the editor's main thread.
 */
export interface PathNode {
  p: Pt;
  /** Smooth node (true) or corner (absent/false). */
  curve?: boolean;
}

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const len = (a: Pt): number => Math.hypot(a[0], a[1]);

/** Points per curve segment: about one every `stepMm`, at least 4. */
const CURVE_STEP_MM = 0.4;
/** Tangent length scale. 1/3 of the chord direction makes a Catmull-Rom spline (tension 0.5). */
const TANGENT = 1 / 6;

/**
 * Flatten nodes into a polyline. Open paths keep their endpoints; closed paths return the ring
 * without repeating the first point.
 */
export function flattenNodes(nodes: readonly PathNode[], closed: boolean): Pt[] {
  const n = nodes.length;
  if (n < 2) return nodes.map((q) => q.p);
  const at = (i: number): PathNode => {
    if (closed) return nodes[((i % n) + n) % n];
    return nodes[Math.max(0, Math.min(n - 1, i))];
  };
  // handle (offset) at node i going toward `dir` (+1 out, -1 in); zero for corners
  const handle = (i: number, dir: 1 | -1): Pt => {
    const node = nodes[((i % n) + n) % n];
    if (!node.curve) return [0, 0];
    const prev = at(i - 1).p;
    const next = at(i + 1).p;
    const t = sub(next, prev);
    // open-path ends: tangent from the single neighbour
    const k = TANGENT * (closed || (i > 0 && i < n - 1) ? 1 : 2);
    return [t[0] * k * dir, t[1] * k * dir];
  };
  const out: Pt[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = at(i);
    const b = at(i + 1);
    const ha = handle(i, 1);
    const hb = handle(i + 1, -1);
    out.push(a.p);
    if (!a.curve && !b.curve) continue;
    const c1: Pt = [a.p[0] + ha[0], a.p[1] + ha[1]];
    const c2: Pt = [b.p[0] + hb[0], b.p[1] + hb[1]];
    const chord = len(sub(b.p, a.p));
    const m = Math.max(4, Math.min(48, Math.ceil(chord / CURVE_STEP_MM)));
    for (let s = 1; s < m; s++) {
      const t = s / m;
      const u = 1 - t;
      const w0 = u * u * u;
      const w1 = 3 * u * u * t;
      const w2 = 3 * u * t * t;
      const w3 = t * t * t;
      out.push([w0 * a.p[0] + w1 * c1[0] + w2 * c2[0] + w3 * b.p[0], w0 * a.p[1] + w1 * c1[1] + w2 * c2[1] + w3 * b.p[1]]);
    }
  }
  if (!closed) out.push(nodes[n - 1].p);
  return out;
}

/** Corner nodes for every vertex of a polyline (how undrawn shapes, e.g. auto-digitized ones, are edited). */
export const nodesFromPolyline = (pts: readonly Pt[]): PathNode[] => pts.map((p) => ({ p }));

/** Nodes of an ellipse through four-or-more curve nodes (8 give a visually exact circle). */
export function ellipseNodes(cx: number, cy: number, rx: number, ry: number): PathNode[] {
  return Array.from({ length: 8 }, (_, i) => {
    const t = (i / 8) * Math.PI * 2;
    return { p: [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as Pt, curve: true };
  });
}

export function rectNodes(x0: number, y0: number, x1: number, y1: number): PathNode[] {
  return [
    { p: [x0, y0] },
    { p: [x1, y0] },
    { p: [x1, y1] },
    { p: [x0, y1] },
  ];
}

/** Ramer-Douglas-Peucker simplification. */
export function simplifyPolyline(pts: readonly Pt[], tolMm: number): Pt[] {
  if (pts.length < 3) return [...pts];
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1;
    let bd = 0;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / l2));
      const d = Math.hypot(pts[i][0] - (ax + dx * t), pts[i][1] - (ay + dy * t));
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (bd > tolMm && best >= 0) {
      keep[best] = true;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Smooth a freehand stroke: drop jitter, then let curve nodes round the corners. */
export function smoothStroke(pts: readonly Pt[], tolMm = 0.25): PathNode[] {
  const simple = simplifyPolyline(pts, tolMm);
  return simple.map((p, i) => ({ p, curve: i > 0 && i < simple.length - 1 }));
}

/** Insert a node after `index` at the point on the segment nearest `to` (corner node). */
export function insertNodeNear(nodes: readonly PathNode[], closed: boolean, to: Pt): { nodes: PathNode[]; index: number } {
  const n = nodes.length;
  const segs = closed ? n : n - 1;
  let best = 0;
  let bd = Infinity;
  let bp: Pt = nodes[0].p;
  for (let i = 0; i < segs; i++) {
    const a = nodes[i].p;
    const b = nodes[(i + 1) % n].p;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((to[0] - a[0]) * dx + (to[1] - a[1]) * dy) / l2));
    const p: Pt = [a[0] + dx * t, a[1] + dy * t];
    const d = Math.hypot(to[0] - p[0], to[1] - p[1]);
    if (d < bd) {
      bd = d;
      best = i;
      bp = p;
    }
  }
  const out = [...nodes];
  const curve = nodes[best].curve && nodes[(best + 1) % n].curve;
  out.splice(best + 1, 0, { p: bp, curve: curve || undefined });
  return { nodes: out, index: best + 1 };
}

/** Delete node `index`, keeping at least the minimum for the shape (3 closed, 2 open). */
export function deleteNode(nodes: readonly PathNode[], closed: boolean, index: number): PathNode[] {
  if (nodes.length <= (closed ? 3 : 2)) return [...nodes];
  return nodes.filter((_, i) => i !== index);
}
