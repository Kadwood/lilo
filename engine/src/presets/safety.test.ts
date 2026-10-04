import { describe, expect, it } from "vitest";
import { DEFAULT_FILL_PARAMS, DEFAULT_RUN_PARAMS, DEFAULT_SATIN_PARAMS, type Design, type DesignObject } from "../model";
import { checkSafe, isWearable, SAFE_RANGES, SAFE_SLIDER_PARAMS, safeRangeFor, satinWidthOf, stripWidthMm, thinSatinMinMm, thinSatins, type SafeParam } from "./safety";

const strip = (w: number, n = 4) => Array.from({ length: n }, (_, i) => [[i * 2, 0], [i * 2, w]]).flat() as [number, number][];
const satin = (id: string, w: number): DesignObject => ({ id, name: id, kind: "satin", threadId: "t", geometry: { strip: strip(w) }, params: { ...DEFAULT_SATIN_PARAMS, widthMm: w } });
const design = (objects: DesignObject[], threadWeight: 40 | 60 = 40): Pick<Design, "objects" | "sewing"> => ({ objects, sewing: { fabric: "suiting", threadWeight, quality: "premium" } });

describe("SAFE_RANGES", () => {
  const params = Object.keys(SAFE_RANGES) as SafeParam[];
  it("has an entry for every slider parameter", () => {
    for (const p of SAFE_SLIDER_PARAMS) expect(SAFE_RANGES[p], p).toBeDefined();
  });
  it("every slider range has min < max", () => {
    for (const p of SAFE_SLIDER_PARAMS) {
      const r = SAFE_RANGES[p];
      expect(r.min, p).not.toBeNull();
      expect(r.max, p).not.toBeNull();
      expect(r.min!, p).toBeLessThan(r.max!);
    }
  });
  it("every limit that exists has a non-empty plain reason, and every entry names its source", () => {
    for (const p of params) {
      const r = SAFE_RANGES[p];
      if (r.min !== null) expect(r.reasonLow.length, `${p} low`).toBeGreaterThan(10);
      if (r.max !== null) expect(r.reasonHigh.length, `${p} high`).toBeGreaterThan(10);
      expect(["researched", "lilo-default"]).toContain(r.source);
      expect(r.sourceNote.length).toBeGreaterThan(10);
    }
  });
  it("matches the numbers in the spec", () => {
    expect([SAFE_RANGES.satinWidth.min, SAFE_RANGES.satinWidth.max]).toEqual([1.5, 10]);
    expect([SAFE_RANGES.satinDensity.min, SAFE_RANGES.satinDensity.max]).toEqual([0.35, 0.6]);
    expect([SAFE_RANGES.fillStitchLength.min, SAFE_RANGES.fillStitchLength.max]).toEqual([3, 4.5]);
    expect([SAFE_RANGES.runStitchLength.min, SAFE_RANGES.runStitchLength.max]).toEqual([1.5, 4]);
    expect([SAFE_RANGES.pullComp.min, SAFE_RANGES.pullComp.max]).toEqual([0.1, 0.4]);
    expect(SAFE_RANGES.minStitch.min).toBe(0.5);
    expect(SAFE_RANGES.longStitch.max).toBe(7);
  });
});

describe("safeRangeFor / checkSafe", () => {
  it("60 wt allows finer columns and tighter spacing", () => {
    expect(safeRangeFor("satinWidth", { threadWeight: 60 }).min).toBe(1);
    expect(safeRangeFor("satinWidth", { threadWeight: 40 }).min).toBe(1.5);
    expect(safeRangeFor("satinDensity", { threadWeight: 60 }).min).toBe(0.3);
    expect(safeRangeFor("satinDensity", { threadWeight: 40 }).min).toBe(0.35);
  });
  it("towel allows looser satin spacing, things not worn allow longer running stitches", () => {
    expect(safeRangeFor("satinDensity", { fabric: "towel" }).max).toBe(0.7);
    expect(safeRangeFor("satinDensity", { fabric: "suiting" }).max).toBe(0.6);
    expect(safeRangeFor("runStitchLength", { fabric: "towel" }).max).toBe(5);
    expect(safeRangeFor("runStitchLength", { fabric: "suiting" }).max).toBe(4);
    expect(isWearable("towel")).toBe(false);
    expect(isWearable("denim")).toBe(true);
  });
  it("says low, high or ok with the reason", () => {
    expect(checkSafe("satinWidth", 1.0)).toEqual({ status: "low", reason: SAFE_RANGES.satinWidth.reasonLow });
    expect(checkSafe("satinWidth", 1.0, { threadWeight: 60 }).status).toBe("ok");
    expect(checkSafe("satinWidth", 11)).toEqual({ status: "high", reason: SAFE_RANGES.satinWidth.reasonHigh });
    expect(checkSafe("satinDensity", 0.4)).toEqual({ status: "ok", reason: "" });
    expect(checkSafe("satinDensity", 0.35).status).toBe("ok");
    expect(checkSafe("satinDensity", 0.349).status).toBe("low");
  });
  it("defaults of the engine itself sit inside the green band", () => {
    expect(checkSafe("fillRowSpacing", DEFAULT_FILL_PARAMS.rowSpacingMm).status).toBe("ok");
    expect(checkSafe("fillStitchLength", DEFAULT_FILL_PARAMS.stitchLengthMm).status).toBe("ok");
    expect(checkSafe("satinDensity", DEFAULT_SATIN_PARAMS.densityMm).status).toBe("ok");
    expect(checkSafe("runStitchLength", DEFAULT_RUN_PARAMS.stitchLengthMm).status).toBe("ok");
  });
});

describe("satin widths in a design", () => {
  it("measures a strip by its median, so tapered ends do not count", () => {
    expect(stripWidthMm(strip(2))).toBeCloseTo(2);
    const tapered = [[0, 0], [0, 0.1], [2, 0], [2, 2], [4, 0], [4, 2], [6, 0], [6, 0.1]] as [number, number][];
    expect(stripWidthMm(tapered)).toBeCloseTo(2, 1); // the upper median: the tapered ends do not count
    expect(stripWidthMm([])).toBe(0);
  });
  it("reads run-type satin from its width", () => {
    const run: DesignObject = { id: "r", name: "r", kind: "run", threadId: "t", geometry: { path: [[0, 0], [5, 0]], closed: false }, params: { ...DEFAULT_RUN_PARAMS, type: "satin", widthMm: 1.2 } };
    expect(satinWidthOf(run)).toBe(1.2);
    expect(satinWidthOf({ ...run, params: { ...DEFAULT_RUN_PARAMS } })).toBeNull();
  });
  it("lists thin columns: 1.0 mm is thin at 40 wt and fine at 60 wt", () => {
    const objs = [satin("a", 1.0), satin("b", 2.5)];
    expect(thinSatins(design(objs, 40)).map((t) => t.id)).toEqual(["a"]);
    expect(thinSatins(design(objs, 60))).toEqual([]);
    expect(thinSatinMinMm(40)).toBe(1.5);
    expect(thinSatinMinMm(60)).toBe(1);
  });
  it("ignores hidden objects", () => {
    expect(thinSatins(design([{ ...satin("a", 1.0), visible: false }]))).toEqual([]);
  });
});
