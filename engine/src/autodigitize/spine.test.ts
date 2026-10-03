import { beforeAll, describe, expect, it } from "vitest";
import { init } from "@stitchables/stitchjs";
import { polygonFromRings } from "../geom";
import { runPaths, satinColumns } from "./spine";

beforeAll(async () => {
  await init();
});

const T = polygonFromRings([
  [0, 0],
  [20, 0],
  [20, 4],
  [12, 4],
  [12, 20],
  [8, 20],
  [8, 4],
  [0, 4],
]);
const bar = polygonFromRings([
  [0, 0],
  [30, 0],
  [30, 3],
  [0, 3],
]);

describe("skeleton satin columns", () => {
  it("covers a straight bar with one column running its full length", () => {
    const sc = satinColumns(bar)!;
    expect(sc.strips).toHaveLength(1);
    expect(sc.coverage).toBeGreaterThan(0.9);
    const strip = sc.strips[0];
    const xs = strip.map((p) => p[0]);
    expect(Math.min(...xs)).toBeLessThan(1);
    expect(Math.max(...xs)).toBeGreaterThan(29);
    // Rung widths are the bar's 3 mm.
    for (let i = 0; i + 1 < strip.length; i += 2) {
      expect(Math.hypot(strip[i][0] - strip[i + 1][0], strip[i][1] - strip[i + 1][1])).toBeGreaterThan(2.5);
    }
    expect(sc.spineLengthMm).toBeGreaterThan(24);
  });

  it("splits a T at its junction into three columns that cover it", () => {
    const sc = satinColumns(T)!;
    expect(sc.strips.length).toBe(3);
    expect(sc.coverage).toBeGreaterThan(0.85);
  });

  it("gives a centre line for run stitching", () => {
    const rp = runPaths(bar)!;
    expect(rp.paths).toHaveLength(1);
    const p = rp.paths[0];
    expect(Math.abs(p[0][1] - 1.5)).toBeLessThan(0.01);
    expect(Math.abs(p[p.length - 1][0] - p[0][0])).toBeGreaterThan(20);
  });

  it("treats a ring as one closed column", () => {
    const n = 48;
    const ring = (r: number) => Array.from({ length: n }, (_, k) => [r * Math.cos((2 * Math.PI * k) / n), r * Math.sin((2 * Math.PI * k) / n)] as [number, number]);
    const annulus = polygonFromRings(ring(10), [ring(7)]);
    const sc = satinColumns(annulus)!;
    expect(sc.strips).toHaveLength(1);
    expect(sc.coverage).toBeGreaterThan(0.9);
  });
});
