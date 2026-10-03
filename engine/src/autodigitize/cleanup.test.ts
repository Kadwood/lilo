import { beforeAll, describe, expect, it } from "vitest";
import { init } from "@stitchables/stitchjs";
import { polygonFromRings } from "../geom";
import { validateDesign, type Pt } from "../model";
import { getCatalogue } from "../threads";
import { regionsToDesign, RUN_MAX_WIDTH_MM, SATIN_MAX_WIDTH_MM } from "./cleanup";

beforeAll(async () => {
  await init();
});

const threads = getCatalogue().threads;
const rect = (x: number, y: number, w: number, h: number): Pt[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
const NAVY = "#0b3d91";
const RED = "#ed171f";
const opts = { minRegionMm2: 2, simplifyMm: 0.1, widthMm: 60 };

describe("regionsToDesign", () => {
  it("classifies by width: hairline -> run, stroke -> satin, wide -> fill", () => {
    // units are mm already (widthMm 60 over a 60 wide bbox keeps scale 1)
    const d = regionsToDesign(
      [
        { hex: NAVY, geom: polygonFromRings(rect(0, 0, 60, 0.7)) }, // 0.7 mm hairline
        { hex: NAVY, geom: polygonFromRings(rect(0, 10, 60, 3)) }, // 3 mm stroke
        { hex: NAVY, geom: polygonFromRings(rect(0, 20, 30, 20)) }, // 20 mm block
      ],
      threads,
      opts,
    );
    expect(validateDesign(d)).toEqual([]);
    const kinds = d.objects.map((o) => o.kind).sort();
    expect(kinds).toEqual(["fill", "run", "satin"]);
    expect(RUN_MAX_WIDTH_MM).toBeLessThan(SATIN_MAX_WIDTH_MM);
    const fill = d.objects.find((o) => o.kind === "fill")!;
    expect(fill.kind === "fill" && fill.params).toMatchObject({ angleDeg: 45, rowSpacingMm: 0.4, stitchLengthMm: 3, underlay: true });
  });

  it("merges a speck into its neighbour and drops an isolated one", () => {
    const d = regionsToDesign(
      [
        { hex: NAVY, geom: polygonFromRings(rect(0, 0, 40, 40)) },
        { hex: RED, geom: polygonFromRings(rect(40, 0, 20, 40)) },
        { hex: RED, geom: polygonFromRings(rect(10, 10, 1, 1)) }, // 1 mm2 red speck inside the navy block
        { hex: RED, geom: polygonFromRings(rect(100, 100, 1, 1)) }, // far-away speck
      ],
      threads,
      { ...opts, widthMm: undefined },
    );
    expect(d.objects).toHaveLength(2);
    expect(d.threads).toHaveLength(2);
  });

  it("orders by colour so each thread appears once, and centres the design on the origin", () => {
    const d = regionsToDesign(
      [
        { hex: NAVY, geom: polygonFromRings(rect(0, 0, 20, 20)) },
        { hex: RED, geom: polygonFromRings(rect(30, 0, 20, 20)) },
        { hex: NAVY, geom: polygonFromRings(rect(60, 0, 20, 20)) },
      ],
      threads,
      opts,
    );
    expect(d.objects.map((o) => o.threadId)).toEqual([d.threads[0].id, d.threads[0].id, d.threads[1].id]);
    const xs = d.objects.flatMap((o) => (o.kind === "fill" ? o.geometry.shell.map((p) => p[0]) : []));
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0, 6);
  });

  it("scales to the requested box", () => {
    const g = [{ hex: NAVY, geom: polygonFromRings(rect(0, 0, 100, 50)) }];
    const w = (d: ReturnType<typeof regionsToDesign>) => {
      const xs = d.objects.flatMap((o) => (o.kind === "fill" ? o.geometry.shell.map((p) => p[0]) : []));
      const ys = d.objects.flatMap((o) => (o.kind === "fill" ? o.geometry.shell.map((p) => p[1]) : []));
      return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    };
    expect(w(regionsToDesign(g, threads, { minRegionMm2: 2, simplifyMm: 0 }))).toEqual([60, 30]);
    expect(w(regionsToDesign(g, threads, { minRegionMm2: 2, simplifyMm: 0, widthMm: 40 }))).toEqual([40, 20]);
    expect(w(regionsToDesign(g, threads, { minRegionMm2: 2, simplifyMm: 0, heightMm: 10 }))).toEqual([20, 10]);
    expect(w(regionsToDesign(g, threads, { minRegionMm2: 2, simplifyMm: 0, widthMm: 100, heightMm: 10 }))).toEqual([20, 10]);
  });

  it("refuses an empty input", () => {
    expect(() => regionsToDesign([], threads, opts)).toThrow(/Nothing to digitize/);
  });
});
