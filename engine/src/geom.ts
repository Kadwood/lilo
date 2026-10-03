// Side effect: attaches the overlay/relate methods (`intersection`, `covers`, `getInteriorPoint`...)
// to jsts geometries. The modular build leaves them off otherwise.
import "jsts/org/locationtech/jts/monkey";
import { Coordinate, GeometryFactory } from "jsts/org/locationtech/jts/geom";
import BufferOp from "jsts/org/locationtech/jts/operation/buffer/BufferOp";
import BufferParameters from "jsts/org/locationtech/jts/operation/buffer/BufferParameters";
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


/** Union of many geometries (cascaded, robust for lists of adjacent polygons). */
export function unionAll(geoms: Geom[]): Geom {
  return UnaryUnionOp.union(factory.createGeometryCollection(geoms));
}
