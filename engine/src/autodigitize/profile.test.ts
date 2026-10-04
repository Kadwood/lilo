import { beforeAll, describe, expect, it } from "vitest";
import { init } from "@stitchables/stitchjs";
import { DEFAULT_HOOP, DEFAULT_SATIN_PARAMS, emptyDesign, type SatinObject } from "../model";
import { resolveSewingSetup } from "../presets";
import { designToStitchPlan } from "../stitch";
import { getCatalogue, toDesignThread } from "../threads";
import { satinDensityMm, satinParamsFor, satinPullCompMm, satinUnderlayFor } from "./profile";
import { satinTraits } from "./strokes";

beforeAll(async () => {
  await init();
});

const prm = resolveSewingSetup({ quality: "premium", threadWeight: 40, fabric: "woven" }).engine;
const std = resolveSewingSetup().engine;

describe("premium satin parameters by column width (40 wt, woven)", () => {
  // width -> [density, pull comp per side, underlay]
  const table: [number, number, number, string][] = [
    [1.0, 0.45, 0.2, "none"],
    [1.2, 0.45, 0.2, "center"],
    [1.5, 0.45, 0.2, "center"],
    [2.0, 0.415, 0.2, "center"],
    [2.5, 0.38, 0.2, "center-contour"],
    [3.0, 0.38, 0.2, "center-contour"],
    [4.0, 0.38, 0.2, "contour-zigzag"],
    [5.0, 0.38, 0.2, "contour-zigzag"],
    [6.0, 0.393, 0.2, "double-zigzag"],
    [8.0, 0.42, 0.2, "double-zigzag"],
    [9.0, 0.42, 0.2, "double-zigzag"],
  ];
  it.each(table)("%f mm column -> density %f, pull %f, underlay %s", (w, density, pull, underlay) => {
    expect(satinDensityMm(w, prm)).toBeCloseTo(density, 3);
    expect(satinPullCompMm(w, prm)).toBeCloseTo(pull, 3);
    const p = satinParamsFor(w, prm);
    expect(p.underlay).toBe(underlay);
    expect(p.densityMm).toBeCloseTo(density, 3);
    expect(p.shortStitches).toBe(true);
    expect(p.splitMaxWidthMm).toBe(6.8); // splits just under 7 mm so no satin leg passes the snag limit
  });

  it("density stays in 0.35 to 0.45 mm for every width at 40 wt", () => {
    for (let w = 0.5; w <= 12; w += 0.25) {
      const d = satinDensityMm(w, prm);
      expect(d).toBeGreaterThanOrEqual(0.35);
      expect(d).toBeLessThanOrEqual(0.45);
    }
  });

  it("is open on very narrow columns, tightest on medium ones, a little open again on wide ones", () => {
    expect(satinDensityMm(1, prm)).toBeGreaterThan(satinDensityMm(3, prm));
    expect(satinDensityMm(9, prm)).toBeGreaterThan(satinDensityMm(3, prm));
  });
});

describe("underlay selection by width", () => {
  it("<2.5 centre walk, 2.5-4 centre + edge, 4-6 edge + zig-zag, >6 double zig-zag", () => {
    const u = (w: number) => satinUnderlayFor(w, prm, 0).underlay;
    expect([1.5, 2.49, 2.5, 3.99, 4, 5.99, 6, 9].map(u)).toEqual(["center", "center", "center-contour", "center-contour", "contour-zigzag", "contour-zigzag", "double-zigzag", "double-zigzag"]);
  });

  it("premium hairline satin gets none", () => {
    expect(satinUnderlayFor(1.0, prm).underlay).toBe("none");
  });

  it("the edge walk stays inside the column edge and never crosses a narrow column's middle", () => {
    for (const w of [2, 3, 5, 7]) {
      const p = satinUnderlayFor(w, prm);
      if (p.underlayInsetMm !== undefined) {
        expect(p.underlayInsetMm).toBeGreaterThan(0);
        expect(p.underlayInsetMm * 2).toBeLessThan(w);
      }
    }
  });

  it("heavy fabrics move the thresholds down; leather stops at an edge walk", () => {
    const eng = (f: "towel" | "leather") => resolveSewingSetup({ fabric: f, quality: "premium" }).engine;
    expect(satinUnderlayFor(2.0, eng("towel")).underlay).toBe("center-contour"); // 1.875 mm threshold
    expect(satinUnderlayFor(2.0, prm).underlay).toBe("center");
    expect(satinUnderlayFor(7, eng("leather")).underlay).toBe("contour");
  });
});

describe("standard satin parameters", () => {
  it("fixed 0.40 mm density, flat 0.15 mm pull, the shared underlay rule", () => {
    for (const w of [1.5, 2, 3, 4.5, 7]) {
      const p = satinParamsFor(w, std);
      expect(p.densityMm).toBe(0.4);
      expect(p.pullCompMm).toBe(0.15);
      expect(p.underlay).toBe(satinTraits(w).underlay);
      expect(p.splitMaxWidthMm).toBe(6.8);
      expect(p.shortStitches).toBeUndefined();
    }
    expect(satinParamsFor(2, std).underlay).toBe("center");
    expect(satinParamsFor(3, std).underlay).toBe("center-contour");
  });

  it("knit scales the pull and opens the density; 60 wt tightens it", () => {
    const knit = resolveSewingSetup({ fabric: "knit" }).engine;
    const p = satinParamsFor(2, knit);
    expect(p.pullCompMm).toBeCloseTo(0.15 * 1.8, 3);
    expect(p.densityMm).toBeCloseTo(0.476, 3);
    expect(satinParamsFor(2, resolveSewingSetup({ threadWeight: 60 }).engine).densityMm).toBeCloseTo(0.35, 3);
  });
});

describe("the density unit matches what stitchjs sews", () => {
  it("densityMm is the same-side spacing: 0.4 sews a drop every 0.4 mm along the column", () => {
    const d = emptyDesign(DEFAULT_HOOP);
    d.threads = [toDesignThread(getCatalogue().threads[0])];
    const strip: [number, number][] = [];
    for (let i = 0; i <= 20; i++) strip.push([i, -1], [i, 1]);
    const obj: SatinObject = {
      id: "a",
      name: "a",
      kind: "satin",
      threadId: d.threads[0].id,
      geometry: { strip },
      params: { ...DEFAULT_SATIN_PARAMS, densityMm: 0.4, underlay: "none", pullCompMm: 0 },
    };
    d.objects = [obj];
    const pts = designToStitchPlan(d).stitches.filter((s) => s.type === "stitch");
    expect(pts.length).toBe(104);
    // same-side spacing: consecutive drops on the top side are 0.4 mm apart in x
    const top = pts.filter((p) => p.y > 0);
    const dx = (top[top.length - 1].x - top[0].x) / (top.length - 1);
    expect(dx).toBeGreaterThan(0.38);
    expect(dx).toBeLessThan(0.42);
  });
});
