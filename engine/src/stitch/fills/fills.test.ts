import { describe, expect, it } from "vitest";
import { Coordinate } from "jsts/org/locationtech/jts/geom";
import { bufferGeom, factory, polygonFromRings } from "../../geom";
import { FILL_PATTERNS, type Pt } from "../../model";
import { generateFill, MAX_EDGE_MM } from "./index";

const rect = (w: number, h: number): Pt[] => [[0, 0], [w, 0], [w, h], [0, h]];
const rectPoly = () => polygonFromRings(rect(40, 30));
/** An L shape with a round-ish hole: concave + hole, the nasty case for clipping. */
const nasty = () =>
  polygonFromRings(
    [[0, 0], [40, 0], [40, 14], [18, 14], [18, 30], [0, 30]],
    [[[4, 4], [14, 4], [14, 12], [4, 12]]],
  );

const base = { angleDeg: 45, rowSpacingMm: 0.4, stitchLengthMm: 3, seed: 7, from: [0, 0] as Pt };

function allPoints(chains: Pt[][]): Pt[] {
  return chains.flat();
}

function maxEdge(chains: Pt[][]): number {
  let m = 0;
  for (const c of chains) for (let i = 1; i < c.length; i++) m = Math.max(m, Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]));
  return m;
}

describe("fill patterns", () => {
  it("ships at least 34 patterns: the 24 documented ones plus our own", () => {
    expect(FILL_PATTERNS.length).toBeGreaterThanOrEqual(34);
    expect(FILL_PATTERNS.filter((p) => p.origin === "standard").length).toBe(24);
    expect(FILL_PATTERNS.filter((p) => p.origin === "lilo").length).toBeGreaterThanOrEqual(11);
    expect(new Set(FILL_PATTERNS.map((p) => p.id)).size).toBe(FILL_PATTERNS.length);
  });

  describe.each(FILL_PATTERNS.map((p) => [p.id, p.label] as const))("%s (%s)", (id) => {
    const poly = rectPoly();
    const run = () => generateFill({ ...base, poly, pattern: id });

    it("fills a 40 x 30 mm rectangle with real stitches, all inside it", () => {
      const chains = run();
      const pts = allPoints(chains);
      expect(pts.length).toBeGreaterThan(40);
      const area = bufferGeom(poly, 0.1);
      const bad = pts.filter(([x, y]) => !area.covers(factory.createPoint(new Coordinate(x, y))));
      expect(bad.slice(0, 3)).toEqual([]);
      // it should reach most of the shape, not hug one corner
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(30);
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(22);
    });

    it("never makes a stitch longer than 12 mm", () => {
      expect(maxEdge(run())).toBeLessThanOrEqual(12);
      expect(maxEdge(run())).toBeLessThanOrEqual(MAX_EDGE_MM + 1e-6);
    });

    it("is deterministic", () => {
      expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
    });

    it("stays out of holes and inside concave shapes", () => {
      const p = nasty();
      const chains = generateFill({ ...base, poly: p, pattern: id });
      const area = bufferGeom(p, 0.1);
      const pts = allPoints(chains);
      expect(pts.length).toBeGreaterThan(20);
      const bad = pts.filter(([x, y]) => !area.covers(factory.createPoint(new Coordinate(x, y))));
      expect(bad.slice(0, 3)).toEqual([]);
    });
  });

  it("hand stitch changes the needle positions but stays deterministic and inside", () => {
    const poly = rectPoly();
    const a = generateFill({ ...base, poly, pattern: "tatami" });
    const b = generateFill({ ...base, poly, pattern: "tatami", handStitch: 4 });
    const b2 = generateFill({ ...base, poly, pattern: "tatami", handStitch: 4 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(JSON.stringify(b)).toBe(JSON.stringify(b2));
    const area = bufferGeom(poly, 0.1);
    expect(allPoints(b).filter(([x, y]) => !area.covers(factory.createPoint(new Coordinate(x, y))))).toEqual([]);
  });

  it("a different seed gives a different rainfall", () => {
    const poly = rectPoly();
    const a = generateFill({ ...base, poly, pattern: "rainfall", seed: 1 });
    const b = generateFill({ ...base, poly, pattern: "rainfall", seed: 2 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("a gradient makes the rows sparser toward one end", () => {
    const poly = rectPoly();
    const solid = generateFill({ ...base, angleDeg: 0, poly, pattern: "tatami" });
    const ramp = generateFill({ ...base, angleDeg: 0, poly, pattern: "tatami", gradient: { kind: "ramp", from: 1, to: 4 } });
    expect(allPoints(ramp).length).toBeLessThan(allPoints(solid).length * 0.7);
    // denser at the top (small y) than at the bottom for a forward ramp
    const top = allPoints(ramp).filter((p) => p[1] < 15).length;
    const bottom = allPoints(ramp).filter((p) => p[1] >= 15).length;
    expect(top).toBeGreaterThan(bottom * 1.5);
  });

  it("streamlines bend toward a guide curve", () => {
    const poly = rectPoly();
    const guide: Pt[] = [[0, 30], [20, 15], [40, 0]];
    const plain = generateFill({ ...base, angleDeg: 0, poly, pattern: "streamlines" });
    const guided = generateFill({ ...base, angleDeg: 0, poly, pattern: "streamlines", guides: [guide] });
    expect(JSON.stringify(plain)).not.toBe(JSON.stringify(guided));
  });

  it("a movable centre moves a circular fill", () => {
    const poly = rectPoly();
    const a = generateFill({ ...base, poly, pattern: "circular", center: [10, 10] });
    const b = generateFill({ ...base, poly, pattern: "circular", center: [30, 20] });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});
