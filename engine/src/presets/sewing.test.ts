import { describe, expect, it } from "vitest";
import {
  FABRICS,
  FABRIC_IDS,
  QUALITIES,
  QUALITY_IDS,
  THREAD_WEIGHTS,
  THREAD_WEIGHT_IDS,
  canonicalFabric,
  resolveSewingSetup,
  type FabricId,
} from "./sewing";

const finite = (n: unknown): boolean => typeof n === "number" && Number.isFinite(n);

describe("sewing presets: every combination resolves to safe numbers", () => {
  const combos = FABRIC_IDS.flatMap((fabric) => THREAD_WEIGHT_IDS.flatMap((threadWeight) => QUALITY_IDS.map((quality) => ({ fabric, threadWeight, quality }))));

  it("covers 7 fabrics x 2 weights x 2 qualities", () => {
    expect(combos).toHaveLength(7 * 2 * 2);
  });

  it.each(combos)("$fabric / $threadWeight wt / $quality", (c) => {
    const s = resolveSewingSetup(c);
    const e = s.engine;
    for (const v of [e.minSatinWidthMm, e.minRunMm, e.hairlineSatinMinLengthMm, e.satinDensityNarrowMm, e.satinDensityMediumMm, e.satinDensityWideMm, e.satinDensityStandardMm, e.pullCompFactor, e.underlayBias]) expect(finite(v)).toBe(true);
    // safe ranges: line density 0.35 (0.30 at 60 wt) to 0.70 mm, never a column narrower than 0.6 mm
    const floor = c.threadWeight === 60 ? 0.3 : 0.35;
    for (const d of [e.satinDensityNarrowMm, e.satinDensityMediumMm, e.satinDensityWideMm, e.satinDensityStandardMm]) {
      expect(d).toBeGreaterThanOrEqual(floor - 1e-9);
      expect(d).toBeLessThanOrEqual(0.7);
    }
    expect(e.minSatinWidthMm).toBeGreaterThanOrEqual(0.6);
    expect(e.minSatinWidthMm).toBeLessThanOrEqual(2.5);
    expect(e.pullCompFactor).toBeGreaterThanOrEqual(0.5);
    expect(e.pullCompFactor).toBeLessThanOrEqual(2);
    expect(e.underlayBias).toBeGreaterThan(0.5);
    expect(e.underlayBias).toBeLessThan(2);
    if (e.junctionOverlapMm !== null) {
      expect(e.junctionOverlapMm).toBeGreaterThanOrEqual(0.3);
      expect(e.junctionOverlapMm).toBeLessThanOrEqual(0.5);
    }
    const f = e.fill;
    if (f.rowSpacingMm !== undefined) {
      expect(f.rowSpacingMm).toBeGreaterThanOrEqual(0.3);
      expect(f.rowSpacingMm).toBeLessThanOrEqual(0.6);
    }
    expect(finite(f.pullCompMm)).toBe(true);
    expect(f.pullCompMm!).toBeGreaterThan(0);
    expect(f.pullCompMm!).toBeLessThanOrEqual(0.6);
    // text for the UI is present and never has a NaN / undefined in it
    expect(s.checklist.length).toBeGreaterThanOrEqual(6);
    for (const line of [...s.checklist, s.summary]) {
      expect(line.length).toBeGreaterThan(10);
      expect(line).not.toMatch(/NaN|undefined|\[object/);
    }
    expect(JSON.stringify(e)).not.toMatch(/null.*NaN|NaN/);
    expect(s.engine.quality).toBe(c.quality);
    expect(s.engine.threadWeight).toBe(c.threadWeight);
    expect(s.engine.fabric).toBe(c.fabric);
  });

  it("is a pure function", () => {
    const a = resolveSewingSetup({ fabric: "knit", threadWeight: 60, quality: "premium" });
    const b = resolveSewingSetup({ fabric: "knit", threadWeight: 60, quality: "premium" });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

describe("sewing presets: the table", () => {
  it("defaults to standard suiting at 40 wt", () => {
    const s = resolveSewingSetup();
    expect(s.input).toEqual({ fabric: "suiting", threadWeight: 40, quality: "standard" });
    expect(s.engine.satinMode).toBe("legacy");
    expect(s.engine.minSatinWidthMm).toBe(1.5);
    expect(s.engine.hairlinesAsSatin).toBe(false);
    expect(s.engine.junctionOverlapMm).toBe(0.3); // both qualities trim columns that meet (fewer stacked stitches)
    expect(s.engine.splitMaxWidthMm).toBe(6.8);
    expect(s.engine.fill).toEqual({ pullCompMm: 0.2 });
  });

  it("maps the legacy fabric names", () => {
    expect(canonicalFabric("woven")).toBe("suiting");
    expect(canonicalFabric("cap")).toBe("twill");
    expect(resolveSewingSetup({ fabric: "woven" }).engine.fabric).toBe("suiting");
    expect(resolveSewingSetup({ fabric: "cap" }).engine.fabric).toBe("twill");
  });

  it("premium 40 wt woven: 1.5 mm minimum column, density 0.45 / 0.38 / 0.42 by width", () => {
    const e = resolveSewingSetup({ quality: "premium", threadWeight: 40, fabric: "woven" }).engine;
    expect(e.minSatinWidthMm).toBe(1.5);
    expect(e.satinDensityNarrowMm).toBe(0.45);
    expect(e.satinDensityMediumMm).toBe(0.38);
    expect(e.satinDensityWideMm).toBe(0.42);
    expect(e.hairlinesAsSatin).toBe(true);
    expect(e.satinMode).toBe("width-scaled");
    expect(e.splitMaxWidthMm).toBe(6.8);
    expect(e.fill.underlays?.[0].spacingMm).toBe(3.5);
    expect(e.fill.stitchLengthMm).toBe(4);
    expect(e.fill.edgeWalk).toBeDefined();
  });

  it("60 wt: density 0.35 standard, tighter premium, finer columns, shorter cap height", () => {
    const std = resolveSewingSetup({ threadWeight: 60 }).engine;
    expect(std.satinDensityStandardMm).toBe(0.35);
    const a = resolveSewingSetup({ quality: "premium", threadWeight: 40 }).engine;
    const b = resolveSewingSetup({ quality: "premium", threadWeight: 60 }).engine;
    expect(b.satinDensityMediumMm).toBeLessThan(a.satinDensityMediumMm);
    expect(b.satinDensityMediumMm).toBeGreaterThanOrEqual(0.3);
    expect(b.minSatinWidthMm).toBeLessThan(a.minSatinWidthMm);
    expect(THREAD_WEIGHTS[40].minLetterHeightMm).toBe(6);
    expect(THREAD_WEIGHTS[60].minLetterHeightMm).toBe(4);
    expect(THREAD_WEIGHTS[60].needle).toMatch(/65\/9/);
  });

  it("40 wt never goes below 0.35 mm density on any fabric", () => {
    for (const f of FABRIC_IDS) {
      const e = resolveSewingSetup({ quality: "premium", fabric: f }).engine;
      expect(Math.min(e.satinDensityNarrowMm, e.satinDensityMediumMm, e.satinDensityWideMm, e.satinDensityStandardMm)).toBeGreaterThanOrEqual(0.35);
    }
  });

  it("fabric adjustments point the way the research says", () => {
    const eng = (f: FabricId) => resolveSewingSetup({ fabric: f, quality: "premium" }).engine;
    expect(eng("knit").pullCompFactor).toBeGreaterThan(eng("suiting").pullCompFactor);
    // [CAL] knit pull 0.35 to 0.40 at premium 0.20 base; terry 0.55 to 0.70, twill 0.40 to 0.45, pique-like knit 0.45 to 0.50
    expect(0.2 * eng("knit").pullCompFactor).toBeGreaterThanOrEqual(0.35);
    expect(0.2 * eng("knit").pullCompFactor).toBeLessThanOrEqual(0.4);
    expect(eng("towel").satinDensityStandardMm).toBeGreaterThanOrEqual(0.55);
    expect(eng("twill").satinDensityStandardMm).toBeGreaterThanOrEqual(0.4);
    expect(eng("twill").satinDensityStandardMm).toBeLessThanOrEqual(0.45);
    expect(eng("knit").satinDensityStandardMm).toBeGreaterThanOrEqual(0.45);
    expect(eng("leather").satinDensityMediumMm).toBeGreaterThan(eng("suiting").satinDensityMediumMm); // looser: do not perforate
    expect(eng("leather").zigzagUnderlay).toBe(false);
    expect(eng("towel").minSatinWidthMm).toBeGreaterThanOrEqual(2); // no fine satin in pile
    expect(eng("towel").underlayBias).toBeLessThan(1); // heavier underlay
    expect(FABRICS.knit.needle.type).toBe("ballpoint");
    expect(FABRICS.knit.stabiliser.type).toBe("cut-away");
    expect(FABRICS.towel.topping).toBe("water-soluble");
    expect(FABRICS.suiting.topping).toBe("none");
  });

  it("every fabric carries the plain-English advice the UI shows", () => {
    for (const id of FABRIC_IDS) {
      const f = FABRICS[id];
      expect(f.id).toBe(id);
      expect(f.label.length).toBeGreaterThan(3);
      expect(f.description.length).toBeGreaterThan(20);
      expect(f.needle.size).toMatch(/^\d+\/\d+$/);
      expect(f.stabiliser.weight.length).toBeGreaterThan(3);
      expect(f.hooping.length).toBeGreaterThan(0);
      expect(f.sources.length).toBeGreaterThan(0);
    }
  });

  it("quality summaries and the stitch count multiplier", () => {
    expect(QUALITIES.standard.stitchCountMultiplier).toBe(1);
    expect(QUALITIES.premium.stitchCountMultiplier).toBeGreaterThan(0.5);
    expect(QUALITIES.premium.stitchCountMultiplier).toBeLessThan(2);
    for (const q of QUALITY_IDS) expect(QUALITIES[q].summary.length).toBeGreaterThan(30);
  });

  it("the checklist names the needle, stabiliser and topping", () => {
    const text = resolveSewingSetup({ fabric: "towel", threadWeight: 60 }).checklist.join("\n");
    expect(text).toMatch(/Needle: 75\/11/);
    expect(text).toMatch(/65\/9/); // 60 wt advice
    expect(text).toMatch(/Stabiliser: tear-away/);
    expect(text).toMatch(/water-soluble topping/i);
  });
});
