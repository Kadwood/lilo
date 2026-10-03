import { Coordinate } from "jsts/org/locationtech/jts/geom";
import { bufferGeom, differenceGeom, factory, polygonFromRings, polygonsOf, ringsOf } from "./geom";
import type { DesignObject, FillObject, Pt, RunObject, SatinObject } from "./model";
import { nodesFromPolyline } from "./model";

/**
 * Boolean shape operations that need a real geometry library (jsts), so they run in the engine
 * worker: slicing a fill with the knife, and cutting a hole out of it. Satin and run slicing are
 * plain plane geometry and live here too so the knife tool has one entry point.
 */

const MIN_PIECE_MM2 = 0.3;
/** Width of the cut the knife leaves in a fill (mm). Too small to see, big enough to separate pieces robustly. */
const KNIFE_KERF_MM = 0.02;

const lineOf = (a: Pt, b: Pt) => factory.createLineString([new Coordinate(a[0], a[1]), new Coordinate(b[0], b[1])]);

function fillPiece(src: FillObject, part: ReturnType<typeof polygonsOf>[number], id: string, name: string): FillObject {
  const { shell, holes } = ringsOf(part);
  return { ...src, id, name, geometry: { shell, holes } };
}

/** Pieces of a fill, as fill objects. The first reuses the source id. */
function fillPieces(src: FillObject, geom: ReturnType<typeof bufferGeom>, newId: () => string, label: string): FillObject[] {
  const parts = polygonsOf(geom).filter((p) => p.getArea() >= MIN_PIECE_MM2);
  return parts.map((p, i) => fillPiece(src, p, i === 0 ? src.id : newId(), i === 0 ? src.name : `${src.name} ${label} ${i + 1}`));
}

/** Slice a fill along the segment a-b. Returns the pieces (one piece if the line doesn't cross it). */
export function knifeFill(o: FillObject, a: Pt, b: Pt, newId: () => string): FillObject[] {
  const poly = polygonFromRings(o.geometry.shell, o.geometry.holes);
  // run the cut a little past both ends so a line ending exactly on the outline still separates
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  const ext = 0.05;
  const a2: Pt = [a[0] - (dx / l) * ext, a[1] - (dy / l) * ext];
  const b2: Pt = [b[0] + (dx / l) * ext, b[1] + (dy / l) * ext];
  const cutter = bufferGeom(lineOf(a2, b2), KNIFE_KERF_MM);
  const rest = differenceGeom(poly, cutter);
  const pieces = fillPieces(o, rest, newId, "part");
  return pieces.length >= 2 ? pieces : [o];
}

/** Cut `hole` out of a fill. Parts of the hole outside the shape are ignored; may split the fill. */
export function cutHole(o: FillObject, hole: Pt[], newId: () => string): FillObject[] {
  if (hole.length < 3) return [o];
  const poly = polygonFromRings(o.geometry.shell, o.geometry.holes);
  const cutter = polygonFromRings(hole);
  const rest = differenceGeom(poly, cutter);
  const pieces = fillPieces(o, rest, newId, "part");
  if (pieces.length === 0) return [o];
  return pieces;
}

// ---- runs and satins (plane geometry, no jsts) -------------------------------------------------

interface Cross {
  /** Distance along the path to the crossing. */
  s: number;
  p: Pt;
  seg: number;
  t: number;
}

function segIntersect(p: Pt, q: Pt, a: Pt, b: Pt): { t: number; u: number } | null {
  const r: Pt = [q[0] - p[0], q[1] - p[1]];
  const s: Pt = [b[0] - a[0], b[1] - a[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((a[0] - p[0]) * s[1] - (a[1] - p[1]) * s[0]) / den;
  const u = ((a[0] - p[0]) * r[1] - (a[1] - p[1]) * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

function crossings(path: readonly Pt[], closed: boolean, a: Pt, b: Pt): Cross[] {
  const pts = closed ? [...path, path[0]] : [...path];
  const out: Cross[] = [];
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const h = segIntersect(pts[i - 1], pts[i], a, b);
    const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (h && h.t > 1e-9 && h.t < 1 - 1e-9) {
      out.push({ s: run + len * h.t, p: [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * h.t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * h.t], seg: i - 1, t: h.t });
    }
    run += len;
  }
  return out;
}

/** Slice a run along a-b. Open runs split at each crossing; closed runs into as many arcs as crossings. */
export function knifeRun(o: RunObject, a: Pt, b: Pt, newId: () => string): RunObject[] {
  const path = o.geometry.path;
  const cs = crossings(path, o.geometry.closed, a, b);
  if (cs.length === 0 || (o.geometry.closed && cs.length < 2)) return [o];
  const pts = o.geometry.closed ? [...path, path[0]] : [...path];
  // arcs between consecutive crossings
  const arcs: Pt[][] = [];
  const arc = (from: Cross | null, to: Cross | null): Pt[] => {
    const out: Pt[] = [];
    if (from) out.push(from.p);
    const i0 = from ? from.seg + 1 : 0;
    const i1 = to ? to.seg : pts.length - 1;
    for (let i = i0; i <= i1; i++) out.push(pts[i]);
    if (to) out.push(to.p);
    return out;
  };
  if (!o.geometry.closed) {
    arcs.push(arc(null, cs[0]));
    for (let i = 0; i + 1 < cs.length; i++) arcs.push(arc(cs[i], cs[i + 1]));
    arcs.push(arc(cs[cs.length - 1], null));
  } else {
    for (let i = 0; i + 1 < cs.length; i++) arcs.push(arc(cs[i], cs[i + 1]));
    // wrap-around arc: from the last crossing to the end, then from the start to the first crossing
    const wrap = [...arc(cs[cs.length - 1], null), ...arc(null, cs[0]).slice(1)];
    arcs.push(wrap);
  }
  const usable = arcs.filter((p) => p.length >= 2);
  return usable.map((p, i) => ({
    ...o,
    id: i === 0 ? o.id : newId(),
    name: i === 0 ? o.name : `${o.name} part ${i + 1}`,
    geometry: { path: p, closed: false, nodes: nodesFromPolyline(p) },
  }));
}

/** Slice a satin column across at the knife line. */
export function knifeSatin(o: SatinObject, a: Pt, b: Pt, newId: () => string): SatinObject[] {
  const strip = o.geometry.strip;
  const mids: Pt[] = [];
  for (let i = 0; i + 1 < strip.length; i += 2) mids.push([(strip[i][0] + strip[i + 1][0]) / 2, (strip[i][1] + strip[i + 1][1]) / 2]);
  const cs = crossings(mids, false, a, b);
  if (cs.length === 0) return [o];
  const c = cs[0];
  const i = c.seg;
  const lerp = (p: Pt, q: Pt, t: number): Pt => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const l = lerp(strip[2 * i], strip[2 * i + 2], c.t);
  const r = lerp(strip[2 * i + 1], strip[2 * i + 3], c.t);
  const first = [...strip.slice(0, 2 * i + 2), l, r];
  const second = [l, r, ...strip.slice(2 * i + 2)];
  const mk = (s: Pt[], id: string, name: string): SatinObject => ({ ...o, id, name, geometry: { strip: s } });
  return [mk(first, o.id, o.name), mk(second, newId(), `${o.name} part 2`)];
}

/** Knife any object. Returns the pieces replacing it (just `[o]` if the line misses). */
export function knifeObject(o: DesignObject, a: Pt, b: Pt, newId: () => string): DesignObject[] {
  switch (o.kind) {
    case "fill":
      return knifeFill(o, a, b, newId);
    case "satin":
      return knifeSatin(o, a, b, newId);
    case "run":
      return knifeRun(o, a, b, newId);
  }
}

/** Requests the editor can send to the worker. */
export type ShapeOpRequest =
  | { op: "knife"; object: DesignObject; a: Pt; b: Pt; firstId: number }
  | { op: "cutHole"; object: FillObject; hole: Pt[]; firstId: number };

/**
 * Run a shape op. New pieces get ids `o<firstId>`, `o<firstId+1>`... The caller picks `firstId`
 * past every id already in the design (see `makeIdGen`), so the result can be dropped in as is.
 */
export function runShapeOp(req: ShapeOpRequest): DesignObject[] {
  let n = req.firstId;
  const newId = () => `o${n++}`;
  return req.op === "knife" ? knifeObject(req.object, req.a, req.b, newId) : cutHole(req.object, req.hole, newId);
}
