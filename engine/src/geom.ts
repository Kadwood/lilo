// Side effect: attaches the overlay/relate methods (`intersection`, `covers`, `getInteriorPoint`...)
// to jsts geometries. The modular build leaves them off otherwise.
import "jsts/org/locationtech/jts/monkey";
import { Coordinate, GeometryFactory } from "jsts/org/locationtech/jts/geom";
import BufferOp from "jsts/org/locationtech/jts/operation/buffer/BufferOp";
import BufferParameters from "jsts/org/locationtech/jts/operation/buffer/BufferParameters";
import Polygonizer from "jsts/org/locationtech/jts/operation/polygonize/Polygonizer";
import UnaryUnionOp from "jsts/org/locationtech/jts/operation/union/UnaryUnionOp";
import TopologyPreservingSimplifier from "jsts/org/locationtech/jts/simplify/TopologyPreservingSimplifier";
import type { Pt } from "./model";

/*
 * jsts's bundled typings are inconsistent (its own Polygon is not assignable to its own Geometry),
 * so geometry is treated as opaque here. The helpers below are the only place that touches it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Geom = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Poly = any;

/** Thin helpers over jsts for polygons expressed as plain `Pt[]` rings. */

export const factory = new GeometryFactory();

const closeRing = (ring: readonly Pt[]): Coordinate[] => {
  const c = ring.map(([x, y]) => new Coordinate(x, y));
  const f = c[0];
  const l = c[c.length - 1];
  if (f.x !== l.x || f.y !== l.y) c.push(new Coordinate(f.x, f.y));
  return c;
};

/** Build a polygon from an outer ring and holes (rings may be open or closed). */
export function polygonFromRings(shell: readonly Pt[], holes: readonly (readonly Pt[])[] = []): Poly {
  const s = factory.createLinearRing(closeRing(shell));
  const h = holes.filter((r) => r.length >= 3).map((r) => factory.createLinearRing(closeRing(r)));
  return factory.createPolygon(s, h);
}

/** The Polygon parts of any geometry (Polygon, MultiPolygon, collection), skipping empties. */
export function polygonsOf(g: Geom): Poly[] {
  if (g.isEmpty()) return [];
  const out: Poly[] = [];
  const type = g.getGeometryType();
  if (type === "Polygon") out.push(g);
  else if (type === "MultiPolygon" || type === "GeometryCollection") {
    const n = g.getNumGeometries();
    for (let i = 0; i < n; i++) out.push(...polygonsOf(g.getGeometryN(i)));
  }
  return out;
}

const ringPts = (ring: { getCoordinates(): Coordinate[] }): Pt[] => {
  const c = ring.getCoordinates();
  const pts: Pt[] = c.map((p) => [p.x, p.y] as const);
  return pts.slice(0, -1); // drop the closing duplicate
};

/** Open shell + open holes of a polygon. */
export function ringsOf(p: Poly): { shell: Pt[]; holes: Pt[][] } {
  const holes: Pt[][] = [];
  for (let i = 0; i < p.getNumInteriorRing(); i++) holes.push(ringPts(p.getInteriorRingN(i)));
  return { shell: ringPts(p.getExteriorRing()), holes };
}

/** Grow (d > 0) or shrink (d < 0) a geometry. Mitre-free (round joins, coarse arcs: we want stitch geometry, not CAD). */
export function bufferGeom(g: Geom, d: number): Geom {
  const params = new BufferParameters();
  params.setQuadrantSegments(4);
  return BufferOp.bufferOp(g, d, params);
}

export function simplifyGeom(g: Geom, tolerance: number): Geom {
  return TopologyPreservingSimplifier.simplify(g, tolerance);
}


/** An empty polygonal geometry (the neutral result when an overlay cannot be computed). */
export const emptyPoly = (): Geom => factory.createPolygon();

/** `g` made valid: invalid polygons (bow-ties, self-touching rings) are rebuilt with a zero buffer. */
function validPoly(p: Poly): Poly {
  try {
    if (p.isValid()) return p;
    // buffer(0) keeps only ONE lobe of a bow-tie (a satin strip folded on a tight bend loses half its
    // area). For a hole-free polygon, node the ring and keep every face instead.
    if (p.getNumInteriorRing() === 0) {
      const c: Coordinate[] = p.getExteriorRing().getCoordinates();
      const segs: Geom[] = [];
      for (let i = 0; i + 1 < c.length; i++) segs.push(factory.createLineString([c[i], c[i + 1]]));
      const noded = UnaryUnionOp.union(factory.createGeometryCollection(segs)); // unions the linework, i.e. nodes it
      const polygonizer = new Polygonizer();
      polygonizer.add(noded);
      const faces: Poly[] = polygonizer.getPolygons().toArray();
      if (faces.length) return faces.length === 1 ? faces[0] : factory.createMultiPolygon(faces);
    }
    return p.buffer(0);
  } catch {
    return emptyPoly();
  }
}

/**
 * The polygonal content of any geometry as one valid Polygon / MultiPolygon: collections are
 * flattened, non-areal parts (lines, points, empties) are dropped, invalid polygons are repaired.
 *
 * Why this exists: jsts overlays (`union`, `intersection`, `difference`) of nearly touching or
 * self-intersecting polygons can return a `GeometryCollection` (a polygon plus a degenerate line or
 * point), and the NEXT overlay on that result throws "This method does not support
 * GeometryCollection arguments". Every overlay in the engine goes through the helpers below, which
 * only ever hand back (and accept) polygonal geometry.
 */
export function polygonal(g: Geom): Geom {
  const parts = polygonsOf(g).map(validPoly).flatMap((p: Poly) => polygonsOf(p));
  if (parts.length === 0) return emptyPoly();
  if (parts.length === 1) return parts[0];
  return factory.createMultiPolygon(parts);
}

/** Union of many geometries (cascaded, robust for lists of adjacent or invalid polygons and collections). */
export function unionAll(geoms: Geom[]): Geom {
  const parts = geoms.flatMap((g) => polygonsOf(g)).map(validPoly).flatMap((p: Poly) => polygonsOf(p));
  if (parts.length === 0) return emptyPoly();
  try {
    return polygonal(UnaryUnionOp.union(factory.createGeometryCollection(parts)));
  } catch {
    // A topology failure in the cascade: slightly fatten, union, and shrink back.
    try {
      return polygonal(bufferGeom(UnaryUnionOp.union(factory.createGeometryCollection(parts.map((p: Poly) => bufferGeom(p, 1e-6)))), -1e-6));
    } catch {
      return emptyPoly();
    }
  }
}

type Overlay = "intersection" | "difference" | "union";

function overlay(a: Geom, b: Geom, op: Overlay): Geom {
  const pa = polygonal(a);
  const pb = polygonal(b);
  if (op === "union") return unionAll([pa, pb]);
  if (pa.isEmpty()) return emptyPoly();
  if (pb.isEmpty()) return op === "difference" ? pa : emptyPoly();
  try {
    return polygonal(pa[op](pb));
  } catch {
    // Robustness retry on slightly regularised inputs (buffer(0) snaps rings to a valid noding).
    try {
      return polygonal(pa.buffer(0)[op](pb.buffer(0)));
    } catch {
      return op === "difference" ? pa : emptyPoly();
    }
  }
}

/** `a ∩ b`, polygonal only, never throws. */
export const intersectGeom = (a: Geom, b: Geom): Geom => overlay(a, b, "intersection");
/** `a − b`, polygonal only, never throws. */
export const differenceGeom = (a: Geom, b: Geom): Geom => overlay(a, b, "difference");
/** `a ∪ b`, polygonal only, never throws. */
export const unionGeom = (a: Geom, b: Geom): Geom => overlay(a, b, "union");
/** Area of `a ∩ b`. */
export const intersectionArea = (a: Geom, b: Geom): number => intersectGeom(a, b).getArea();
