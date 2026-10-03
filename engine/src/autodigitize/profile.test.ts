import { beforeAll, describe, expect, it } from "vitest";
import { init } from "@stitchables/stitchjs";
import { DEFAULT_HOOP, DEFAULT_SATIN_PARAMS, emptyDesign, type SatinObject } from "../model";
import { resolveSewingSetup } from "../presets";
import { designToStitchPlan } from "../stitch";
import { getCatalogue, toDesignThread } from "../threads";
import { satinDensityFromPitch, satinParamsFor, satinPitchMm, satinPullCompMm, satinUnderlayFor } from "./profile";
import { satinTraits } from "./strokes";

beforeAll(async () => {
  await init();
});

const prm = resolveSewingSetup({ quality: "premium", threadWeight: 40, fabric: "woven" }).engine;
const std = resolveSewingSetup().engine;

describe("satin parameters by column width (premium, 40 wt, woven)", () => {
  // width -> [line pitch, pull comp per side, underlay]
  const table: [number, number, number, string][] = [
    [0.8, 0.32, 0.144, "none"],
    [1.0, 0.32, 0.15, "center"],
    [1.5, 0.328, 0.165, "center"],
    [2.0, 0.335, 0.18, "contour"],
    [3.0, 0.35, 0.21, "contour"],
    [4.0, 0.365, 0.24, "contour-zigzag"],
    [5.0, 0.38, 0.27, "contour-zigzag"],
    [6.0, 0.38, 0.3, "contour-zigzag"],
    [9.0, 0.38, 0.3, "contour-zigzag"],
  ];
  it.each(table)("%f mm column -> pitch %f, pull %f, underlay %s", (w, pitch, pull, underlay) => {
    expect(satinPitchMm(w, prm)).toBeCloseTo(pitch, 3);
    expect(satinPullCompMm(w, prm)).toBeCloseTo(pull, 3);
    const p = satinParamsFor(w, prm);
    expect(p.underlay).toBe(underlay);
    expect(p.densityMm).toBeCloseTo(satinDensityFromPitch(pitch), 2);
    expect(p.shortStitches).toBe(true);
    expect(p.splitMaxWidthMm).toBe(5);
  });

  it("spacing never gets tighter than the 0.25 mm floor or looser than 0.7 mm, for any width", () => {
    for (let w = 0.5; w <= 12; w += 0.25) {
      const pitch = satinPitchMm(w, prm);
      expect(pitch).toBeGreaterThanOrEqual(0.25);
      expect(pitch).toBeLessThanOrEqual(0.7);
    }
  });

  it("pull compensation rises with width and is capped", () => {
    let prev = 0;
    for (let w = 0.8; w <= 6; w += 0.2) {
      const pc = satinPullCompMm(w, prm);
      expect(pc).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = pc;
    }
    expect(satinPullCompMm(12, prm)).toBeLessThanOrEqual(0.3);
  });
});

describe("underlay selection", () => {
  it("none under 1 mm, centre walk to 2 mm, edge walk to 3.5 mm, then edge walk + zig-zag", () => {
    const u = (w: number) => satinUnderlayFor(w, prm).underlay;
    expect([0.8, 0.99, 1.0, 1.99, 2.0, 3.49, 3.5, 7].map(u)).toEqual(["none", "none", "center", "center", "contour", "contour", "contour-zigzag", "contour-zigzag"]);
  });

  it("the edge walk stays inside the column edge and never crosses a narrow column's middle", () => {
    for (const w of [1.5, 2, 3, 5, 7]) {
      const p = satinUnderlayFor(w, prm);
      if (p.underlayInsetMm !== undefined) {
        expect(p.underlayInsetMm).toBeGreaterThan(0);
        expect(p.underlayInsetMm * 2).toBeLessThan(w);
      }
    }
  });

  it("heavy fabrics move the thresholds down, light ones and leather up (leather: no zig-zag)", () => {
    const eng = (f: "knit" | "towel" | "shirting" | "leather") => resolveSewingSetup({ fabric: f, quality: "premium" }).engine;
    expect(satinUnderlayFor(1.7, eng("towel")).underlay).toBe("contour"); // 1.5 mm threshold
    expect(satinUnderlayFor(1.7, prm).underlay).toBe("center");
    expect(satinUnderlayFor(5, eng("leather")).underlay).toBe("contour");
    expect(satinUnderlayFor(3.2, eng("shirting")).underlay).toBe("contour");
  });
});

describe("standard (legacy) satin parameters are unchanged", () => {
  it("matches the original width rules and the 0.4 density", () => {
    for (const w of [0.9, 1.1, 1.2, 2, 3.9, 4, 6]) {
      const t = satinTraits(w);
      const p = satinParamsFor(w, std);
      expect(p).toEqual({ ...DEFAULT_SATIN_PARAMS, widthMm: Math.round(w * 10) / 10, pullCompMm: t.pull, underlay: t.underlay });
      expect(p.densityMm).toBe(0.4);
    }
  });

  it("knit scales only the pull compensation in Standard", () => {
    const knit = resolveSewingSetup({ fabric: "knit" }).engine;
    const p = satinParamsFor(2, knit);
    expect(p.densityMm).toBe(0.4);
    expect(p.pullCompMm).toBeCloseTo(0.15 * 1.5, 3);
  });
});

describe("the pitch unit matches what stitchjs sews", () => {
  it("densityMm is twice the distance between stitch lines (ladder rows)", () => {
    const d = emptyDesign(DEFAULT_HOOP);
    d.threads = [toDesignThread(getCatalogue().threads[0])];
    const strip: [number, number][] = [];
    for (let i = 0; i <= 20; i++) strip.push([i, -1], [i, 1]);
    const pitch = 0.4;
    const obj: SatinObject = {
      id: "a",
      name: "a",
      kind: "satin",
      threadId: d.threads[0].id,
      geometry: { strip },
      params: { ...DEFAULT_SATIN_PARAMS, densityMm: satinDensityFromPitch(pitch), underlay: "none", pullCompMm: 0 },
    };
    d.objects = [obj];
    const plan = designToStitchPlan(d);
    const pts = plan.stitches.filter((s) => s.type === "stitch");
    // stitch lines crossing the column's centre line (y = 0), counted along 20 mm
    let crossings = 0;
    for (let i = 1; i < pts.length; i++) if ((pts[i - 1].y < 0) !== (pts[i].y < 0)) crossings++;
    const perMm = crossings / 20;
    expect(1 / perMm).toBeGreaterThan(pitch * 0.9);
    expect(1 / perMm).toBeLessThan(pitch * 1.1);
  });
});
