import type { PathNode } from "./path";
import type { DesignObject, Pt } from "./types";

/**
 * Moving, scaling, rotating and flipping objects. All pure functions on plain data, safe to use on
 * the editor's main thread and inside Immer recipes.
 */

/** x' = a x + c y + e ; y' = b x + d y + f. */
export type Affine = readonly [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export const applyAffine = (m: Affine, p: Pt): Pt => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];

/** `a` then `b`. */
export const compose = (a: Affine, b: Affine): Affine => [
  b[0] * a[0] + b[2] * a[1],
  b[1] * a[0] + b[3] * a[1],
  b[0] * a[2] + b[2] * a[3],
  b[1] * a[2] + b[3] * a[3],
  b[0] * a[4] + b[2] * a[5] + b[4],
  b[1] * a[4] + b[3] * a[5] + b[5],
];

export const translation = (dx: number, dy: number): Affine => [1, 0, 0, 1, dx, dy];
export const scaling = (sx: number, sy: number, cx = 0, cy = 0): Affine => [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
export const rotation = (rad: number, cx = 0, cy = 0): Affine => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
};
/** Mirror left-right about x = cx. */
export const flipH = (cx: number): Affine => scaling(-1, 1, cx, 0);
/** Mirror top-bottom about y = cy. */
export const flipV = (cy: number): Affine => scaling(1, -1, 0, cy);

/** Mean scale factor of the transform (square root of |determinant|). */
export const meanScale = (m: Affine): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

const nodes = (m: Affine, ns: readonly PathNode[] | undefined): PathNode[] | undefined => ns?.map((n) => ({ ...n, p: applyAffine(m, n.p) }));

/** A copy of `o` with all its geometry (and start/end markers, centre, guides) transformed. */
export function transformObject<T extends DesignObject>(o: T, m: Affine): T {
  const f = (p: Pt) => applyAffine(m, p);
  const base = {
    startPoint: o.startPoint ? f(o.startPoint) : undefined,
    endPoint: o.endPoint ? f(o.endPoint) : undefined,
  };
  if (base.startPoint === undefined) delete (base as { startPoint?: Pt }).startPoint;
  if (base.endPoint === undefined) delete (base as { endPoint?: Pt }).endPoint;
  const k = meanScale(m);
  switch (o.kind) {
    case "fill": {
      const g = o.geometry;
      const p = o.params;
      return {
        ...o,
        ...base,
        geometry: {
          ...g,
          shell: g.shell.map(f),
          holes: g.holes.map((h) => h.map(f)),
          ...(g.shellNodes ? { shellNodes: nodes(m, g.shellNodes) } : {}),
          ...(g.holeNodes ? { holeNodes: g.holeNodes.map((h) => nodes(m, h)) } : {}),
        },
        params: {
          ...p,
          ...(p.center ? { center: f(p.center) } : {}),
          ...(p.guides ? { guides: p.guides.map((l) => l.map(f)) } : {}),
          // a rotation turns the stitch direction with the shape; flips mirror it
          angleDeg: transformAngleDeg(m, p.angleDeg),
          ...(p.underlays ? { underlays: p.underlays.map((u) => ({ ...u, angleDeg: transformAngleDeg(m, u.angleDeg) })) } : {}),
        },
      } as T;
    }
    case "satin":
      return { ...o, ...base, geometry: { strip: o.geometry.strip.map(f) } } as T;
    case "run": {
      const g = o.geometry;
      return {
        ...o,
        ...base,
        geometry: { ...g, path: g.path.map(f), ...(g.nodes ? { nodes: nodes(m, g.nodes) } : {}) },
        params: o.params.widthMm !== undefined ? { ...o.params, widthMm: o.params.widthMm * k } : o.params,
      } as T;
    }
  }
}

/** Direction of a line at `deg` after the transform, in degrees. */
export function transformAngleDeg(m: Affine, deg: number): number {
  const r = (deg * Math.PI) / 180;
  const x = m[0] * Math.cos(r) + m[2] * Math.sin(r);
  const y = m[1] * Math.cos(r) + m[3] * Math.sin(r);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Outline points of an object: what a person would call its shape. */
export function outlinePoints(o: DesignObject): Pt[] {
  switch (o.kind) {
    case "fill":
      return o.geometry.shell;
    case "satin":
      return o.geometry.strip;
    case "run":
      return o.geometry.path;
  }
}

export function boundsOfPoints(pts: readonly Pt[]): Box | null {
  if (pts.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export const objectBox = (o: DesignObject): Box | null => boundsOfPoints(outlinePoints(o));

export function unionBox(boxes: readonly (Box | null)[]): Box | null {
  let out: Box | null = null;
  for (const b of boxes) {
    if (!b) continue;
    out = out ? { minX: Math.min(out.minX, b.minX), minY: Math.min(out.minY, b.minY), maxX: Math.max(out.maxX, b.maxX), maxY: Math.max(out.maxY, b.maxY) } : { ...b };
  }
  return out;
}

const inRing = (p: Pt, ring: readonly Pt[]): boolean => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

/** Distance from `p` to the polyline (or closed ring). */
export function distToPolyline(p: Pt, pts: readonly Pt[], closed: boolean): number {
  let best = Infinity;
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)));
  }
  return best;
}

/** The outline of a satin strip as a closed ring: left side down, right side back up. */
export function satinOutline(strip: readonly Pt[]): Pt[] {
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i + 1 < strip.length; i += 2) {
    left.push(strip[i]);
    right.push(strip[i + 1]);
  }
  return [...left, ...right.reverse()];
}

/** Does a click at `p` (mm) hit this object? `tol` is the pick radius in mm for thin things. */
export function hitObject(o: DesignObject, p: Pt, tol: number): boolean {
  if (o.visible === false) return false;
  switch (o.kind) {
    case "fill": {
      if (inRing(p, o.geometry.shell) && !o.geometry.holes.some((h) => inRing(p, h))) return true;
      return distToPolyline(p, o.geometry.shell, true) <= tol;
    }
    case "satin": {
      const ring = satinOutline(o.geometry.strip);
      return inRing(p, ring) || distToPolyline(p, ring, true) <= tol;
    }
    case "run":
      return distToPolyline(p, o.geometry.path, o.geometry.closed) <= Math.max(tol, (o.params.widthMm ?? 0) / 2);
  }
}

/** Is the object entirely inside the box? (Marquee selection.) */
export function objectInBox(o: DesignObject, b: Box): boolean {
  const ob = objectBox(o);
  return !!ob && ob.minX >= b.minX && ob.maxX <= b.maxX && ob.minY >= b.minY && ob.maxY <= b.maxY;
}

/** Does the object's box touch the marquee box? */
export function objectTouchesBox(o: DesignObject, b: Box): boolean {
  const ob = objectBox(o);
  return !!ob && ob.maxX >= b.minX && ob.minX <= b.maxX && ob.maxY >= b.minY && ob.minY <= b.maxY;
}
