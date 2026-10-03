import { ringsOf, polygonsOf, type Poly } from "../../geom";
import { patternValue, type FillGradient, type Pt } from "../../model";
import { pointInRings } from "./util";

/** Everything a pattern generator needs. All lengths in mm, angles in radians. */
export interface FillCtx {
  patternId: string;
  /** The (pull-compensated) polygon to fill. */
  poly: Poly;
  parts: { shell: Pt[]; holes: Pt[][] }[];
  angle: number;
  spacing: number;
  stitchLen: number;
  hand: number;
  rand: () => number;
  /** Pattern setting by key (override or default). */
  get: (key: string) => number;
  centre: Pt;
  guides: Pt[][];
  gradient?: FillGradient;
  /** Local frame: origin `o`, rotated by `angle`. */
  o: Pt;
  toLocal: (p: Pt) => Pt;
  toWorld: (p: Pt) => Pt;
  /** Extent of the polygon in the local frame. */
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** Largest distance from `centre` to any polygon vertex. */
  radius: number;
  inside: (p: Pt) => boolean;
}

export interface CtxInput {
  patternId: string;
  poly: Poly;
  angleDeg: number;
  rowSpacingMm: number;
  stitchLengthMm: number;
  handStitch: number;
  rand: () => number;
  params?: Record<string, number>;
  center?: Pt;
  guides?: Pt[][];
  gradient?: FillGradient;
}

export function makeCtx(i: CtxInput): FillCtx {
  const parts = polygonsOf(i.poly).map(ringsOf);
  const all: Pt[] = parts.flatMap((p) => p.shell);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of all) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const o: Pt = [(minX + maxX) / 2, (minY + maxY) / 2];
  const angle = (i.angleDeg * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const toLocal = (p: Pt): Pt => [(p[0] - o[0]) * c + (p[1] - o[1]) * s, -(p[0] - o[0]) * s + (p[1] - o[1]) * c];
  const toWorld = (p: Pt): Pt => [o[0] + p[0] * c - p[1] * s, o[1] + p[0] * s + p[1] * c];
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const p of all) {
    const [u, v] = toLocal(p);
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  // A point inside the shape for the default centre (the polygon's interior point, which is
  // always inside even for concave shapes).
  let centre = i.center;
  if (!centre) {
    const ip = i.poly.getInteriorPoint?.();
    centre = ip ? [ip.getX(), ip.getY()] : o;
    // prefer the bbox centre when it is inside: it looks more natural for symmetric shapes
    if (pointInRings(o, parts[0]?.shell ?? [], parts[0]?.holes ?? [])) centre = o;
  }
  let radius = 0;
  for (const p of all) radius = Math.max(radius, Math.hypot(p[0] - centre[0], p[1] - centre[1]));
  const inside = (p: Pt): boolean => parts.some((q) => pointInRings(p, q.shell, q.holes));
  return {
    patternId: i.patternId,
    poly: i.poly,
    parts,
    angle,
    spacing: Math.max(0.1, i.rowSpacingMm),
    stitchLen: Math.max(0.5, i.stitchLengthMm),
    hand: Math.max(0, Math.min(5, i.handStitch)),
    rand: i.rand,
    get: (key) => patternValue(i.patternId, i.params, key),
    centre,
    guides: i.guides ?? [],
    gradient: i.gradient,
    o,
    toLocal,
    toWorld,
    u0,
    u1,
    v0,
    v1,
    radius,
    inside,
  };
}
