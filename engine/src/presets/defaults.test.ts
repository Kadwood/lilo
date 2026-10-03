import { describe, expect, it } from "vitest";
import { DEFAULT_FILL_PARAMS, DEFAULT_RUN_PARAMS, DEFAULT_SATIN_PARAMS } from "../model";
import { DEFAULT_AUTODIGITIZE_OPTIONS } from "../autodigitize";
import { DENSITY_WARN_PER_MM2, LOCK_STITCH_MM, MAX_STITCH_MM, MIN_STITCH_MM, TRIM_JUMP_MM } from "../stitch/validate";
import { satinDensityMm, satinParamsFor } from "../autodigitize/profile";
import { DEFAULTS, fillRowsPerCm, satinLegsPerCm } from "./defaults";
import { resolveSewingSetup } from "./sewing";

/** Every consumer reads the one table, so a calibration only ever edits defaults.ts. */
describe("stitch defaults are single-sourced", () => {
  it("model defaults come from the table", () => {
    expect(DEFAULT_SATIN_PARAMS.densityMm).toBe(DEFAULTS.satin.densityMm);
    expect(DEFAULT_SATIN_PARAMS.pullCompMm).toBe(DEFAULTS.satin.pullCompMm);
    expect(DEFAULT_FILL_PARAMS.rowSpacingMm).toBe(DEFAULTS.fill.rowSpacingMm);
    expect(DEFAULT_FILL_PARAMS.pullCompMm).toBe(DEFAULTS.fill.pullCompMm);
    expect(DEFAULT_RUN_PARAMS.stitchLengthMm).toBe(DEFAULTS.run.stitchLengthMm);
    expect(DEFAULT_AUTODIGITIZE_OPTIONS.minRegionMm2).toBe(DEFAULTS.fill.minRegionMm2);
  });

  it("limits come from the table", () => {
    expect([MAX_STITCH_MM, TRIM_JUMP_MM, DENSITY_WARN_PER_MM2, MIN_STITCH_MM, LOCK_STITCH_MM]).toEqual([
      DEFAULTS.limits.maxStitchMm,
      DEFAULTS.limits.trimJumpMm,
      DEFAULTS.limits.densityWarnPerMm2,
      DEFAULTS.limits.minStitchMm,
      DEFAULTS.limits.lockStitchMm,
    ]);
  });

  it("the satin default is the commercial 0.40 mm same-side spacing: a leg every 0.2 mm, 50 per cm", () => {
    expect(DEFAULTS.satin.densityMm).toBe(0.4);
    expect(satinLegsPerCm(DEFAULTS.satin.densityMm)).toBeCloseTo(50, 6);
    expect(fillRowsPerCm(DEFAULTS.fill.rowSpacingMm)).toBeCloseTo(25, 6);
  });

  it("premium presets read their density band and thresholds from it", () => {
    const e = resolveSewingSetup({ quality: "premium" }).engine;
    expect(e.satinDensityNarrowMm).toBe(DEFAULTS.satin.premiumDensityNarrowMm);
    expect(e.satinDensityMediumMm).toBe(DEFAULTS.satin.premiumDensityMediumMm);
    expect(e.satinDensityWideMm).toBe(DEFAULTS.satin.premiumDensityWideMm);
    expect(e.splitMaxWidthMm).toBe(DEFAULTS.satin.splitMm);
    expect(e.junctionOverlapMm).toBe(DEFAULTS.satin.junctionOverlapMm);
    expect(satinDensityMm(1, e)).toBe(DEFAULTS.satin.premiumDensityNarrowMm);
    expect(satinParamsFor(1.1, e).underlay).toBe("none");
  });

  it("every value is a finite positive number", () => {
    const walk = (o: unknown, path: string): void => {
      if (typeof o === "number") expect(Number.isFinite(o) && o > 0, path).toBe(true);
      else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    };
    walk(DEFAULTS, "DEFAULTS");
  });
});
