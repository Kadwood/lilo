import { Coordinate } from "jsts/org/locationtech/jts/geom";
import { describe, expect, it } from "vitest";
import { differenceGeom, factory, intersectGeom, intersectionArea, polygonFromRings, polygonal, unionAll, unionGeom } from "./geom";

const sq = (x: number, y: number, s = 2) =>
  polygonFromRings([
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
  ]);
/** A polygon plus a dangling line: what a jsts overlay of nearly-touching shapes can hand back. */
const collection = () => factory.createGeometryCollection([sq(0, 0), factory.createLineString([new Coordinate(5, 5), new Coordinate(8, 5)])]);
/** A bow-tie: self-intersecting, so invalid. */
const bowtie = () =>
  polygonFromRings([
    [10, 0],
    [14, 4],
    [14, 0],
    [10, 4],
  ]);

describe("robust polygon overlays", () => {
  it("documents the root cause: raw jsts overlays reject GeometryCollection operands", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => (collection() as any).union(sq(1, 1))).toThrow(/GeometryCollection/);
  });

  it("unionAll / unionGeom accept collections and return polygonal geometry", () => {
    const u = unionGeom(collection(), sq(1, 1));
    expect(["Polygon", "MultiPolygon"]).toContain(u.getGeometryType());
    expect(u.getArea()).toBeCloseTo(7, 6);
    expect(unionAll([collection(), sq(10, 10), sq(1, 1)]).getArea()).toBeCloseTo(11, 6);
  });

  it("chains: feeding a result back in never throws", () => {
    let acc = collection();
    for (let i = 0; i < 5; i++) acc = unionGeom(acc, sq(i * 1.5, 0));
    // squares at x = 0, 1.5, ... 6, each 2 wide: covers 0..8 x 0..2
    expect(acc.getArea()).toBeCloseTo(16, 6);
  });

  it("repairs invalid polygons (bow-tie) instead of throwing", () => {
    const fixed = polygonal(bowtie());
    expect(fixed.isValid()).toBe(true);
    expect(fixed.getArea()).toBeCloseTo(8, 6);
    expect(unionAll([bowtie(), sq(0, 0)]).getArea()).toBeCloseTo(12, 6);
  });

  it("intersection and difference tolerate collections and invalid input", () => {
    expect(intersectGeom(collection(), sq(1, 1)).getArea()).toBeCloseTo(1, 6);
    expect(intersectionArea(bowtie(), sq(10, 0, 4))).toBeCloseTo(8, 6);
    expect(differenceGeom(sq(0, 0), collection()).isEmpty()).toBe(true);
    expect(differenceGeom(sq(0, 0, 4), sq(1, 1)).getArea()).toBeCloseTo(12, 6);
    expect(intersectGeom(sq(0, 0), sq(50, 50)).isEmpty()).toBe(true);
  });

  it("empty inputs give empty polygonal results", () => {
    expect(unionAll([]).isEmpty()).toBe(true);
    expect(differenceGeom(sq(0, 0), factory.createPolygon()).getArea()).toBeCloseTo(4, 6);
  });
});
