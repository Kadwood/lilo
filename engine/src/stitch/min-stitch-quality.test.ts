import { describe, expect, it } from "vitest";
import { DEFAULT_HOOP, DEFAULT_RUN_PARAMS, emptyDesign, makeRun, nodesFromPolyline, type Design } from "../model";
import { DEFAULTS } from "../presets/defaults";
import { designToPes } from "../export";
import { minStitchFor, validatePlan } from "./validate";
import type { PlanStitch, StitchPlan } from "./plan";

const st = (x: number, y = 0): PlanStitch => ({ x, y, type: "stitch", threadIndex: 0, objectIndex: 0 });
const THREAD = { id: "t", brand: "B", code: "1", name: "x", hex: "#000000" };
// drops 0.55 mm apart: kept at Standard (0.5), merged at Premium (0.6)
const plan = (): StitchPlan => ({ threads: [THREAD], stitches: Array.from({ length: 12 }, (_, i) => st(i * 0.55)), warnings: [] });
const gaps = (p: StitchPlan) => {
  const s = p.stitches.filter((x) => x.type === "stitch" && !x.lock);
  return s.slice(1).map((x, i) => Math.hypot(x.x - s[i].x, x.y - s[i].y));
};

describe("minimum stitch follows quality", () => {
  it("is 0.5 at Standard and 0.6 at Premium, from the one table", () => {
    expect(minStitchFor("standard")).toBe(DEFAULTS.limits.minStitchMm);
    expect(minStitchFor(undefined)).toBe(0.5);
    expect(minStitchFor("premium")).toBe(0.6);
    expect(DEFAULTS.limits.minStitchPremiumMm).toBe(0.6);
  });

  it("validatePlan merges 0.55 mm drops at Premium but not at Standard", () => {
    const std = validatePlan(plan(), DEFAULT_HOOP, { lockStitchMm: 0 }).plan;
    const pre = validatePlan(plan(), DEFAULT_HOOP, { lockStitchMm: 0, quality: "premium" }).plan;
    expect(Math.min(...gaps(std))).toBeCloseTo(0.55, 6);
    expect(Math.min(...gaps(pre))).toBeGreaterThanOrEqual(0.6 - 1e-9);
    expect(pre.stitches.length).toBeLessThan(std.stitches.length);
  });

  it("export reads the design's own quality", () => {
    const d: Design = emptyDesign(DEFAULT_HOOP);
    d.threads = [THREAD];
    d.objects = [makeRun("r", "r", "t", nodesFromPolyline([[0, 0], [5, 0]]), false, { ...DEFAULT_RUN_PARAMS, stitchLengthMm: 0.55 })];
    const std = designToPes({ ...d, sewing: { fabric: "suiting", threadWeight: 40, quality: "standard" } }, { lockStitchMm: 0 }).plan;
    const pre = designToPes({ ...d, sewing: { fabric: "suiting", threadWeight: 40, quality: "premium" } }, { lockStitchMm: 0 }).plan;
    expect(Math.min(...gaps(pre))).toBeGreaterThanOrEqual(0.6 - 1e-9);
    expect(pre.stitches.length).toBeLessThanOrEqual(std.stitches.length);
  });
});
