import { describe, expect, it } from "vitest";
import { DEFAULT_HOOP, DEFAULT_SATIN_PARAMS, emptyDesign, type Design, type DesignObject } from "../model";
import { getCatalogue, toDesignThread } from "../threads";
import { designToPes } from "../export";
import { designToStitchPlan } from "./generate";
import { COLOR_CHANGE_SECONDS, planStats, REAL_WORLD_FACTOR, TRIM_SECONDS, type PlanStitch, type StitchPlan } from "./plan";
import { validateForMachine } from "./machine";
import { validatePlan } from "./validate";

const blue = toDesignThread(getCatalogue().threads.find((t) => t.name === "Blue")!);

const satinBar = (w: number): DesignObject => ({
  id: "s1",
  name: "Bar",
  kind: "satin",
  threadId: blue.id,
  geometry: { strip: [[-10, 0], [-10, w], [-4, 0], [-4, w], [2, 0], [2, w], [8, 0], [8, w]] },
  params: { ...DEFAULT_SATIN_PARAMS, widthMm: w },
});
const designOf = (w: number, threadWeight: 40 | 60, fabric: "suiting" | "towel" = "suiting"): Design => {
  const d = emptyDesign(DEFAULT_HOOP);
  d.threads = [blue];
  d.objects = [satinBar(w)];
  d.sewing = { fabric, threadWeight, quality: "premium" };
  return d;
};
const codes = (d: Design) => validatePlan(designToStitchPlan(d), d.hoop, { quality: "premium", design: d }).warnings.map((w) => w.code);

describe("thin-satin warning", () => {
  it("fires at 1.0 mm on 40 wt", () => {
    expect(codes(designOf(1.0, 40))).toContain("thin-satin");
  });
  it("does not fire at 1.0 mm on 60 wt", () => {
    expect(codes(designOf(1.0, 60))).not.toContain("thin-satin");
  });
  it("fires on 60 wt below 1.0 mm, and not at 1.5 mm on 40 wt", () => {
    expect(codes(designOf(0.8, 60))).toContain("thin-satin");
    expect(codes(designOf(1.5, 40))).not.toContain("thin-satin");
  });
  it("names the object and says why, in plain words", () => {
    const d = designOf(1.0, 40);
    const w = validatePlan(designToStitchPlan(d), d.hoop, { design: d }).warnings.find((x) => x.code === "thin-satin")!;
    expect(w.objectId).toBe("s1");
    expect(w.message).toMatch(/thinner than 1.5 mm/);
    expect(w.message).toMatch(/running stitch/);
  });
  it("only runs when the design is given, and it comes through the export path too", () => {
    const d = designOf(1.0, 40);
    expect(validatePlan(designToStitchPlan(d), d.hoop).warnings.map((w) => w.code)).not.toContain("thin-satin");
    expect(designToPes(d).warnings.map((w) => w.code)).toContain("thin-satin");
    expect(validateForMachine(designToStitchPlan(d), d.hoop, { design: d }).warnings.map((w) => w.code)).toContain("thin-satin");
  });
});

describe("long-stitch-snag warning", () => {
  const line = (mm: number): StitchPlan => ({ threads: [blue], warnings: [], stitches: [0, 1, 2].map((i): PlanStitch => ({ x: i * mm, y: 0, type: "stitch", threadIndex: 0, objectIndex: 0 })) });
  const run = (mm: number, fabric: "suiting" | "towel") => {
    const d = designOf(3, 40, fabric);
    return validatePlan(line(mm), DEFAULT_HOOP, { lockStitchMm: 0, design: d });
  };
  it("fires over 7 mm on cloth that is worn, and keeps the 12.1 mm hard split", () => {
    const r = run(9, "suiting");
    expect(r.warnings.map((w) => w.code)).toContain("long-stitch-snag");
    expect(r.warnings.map((w) => w.code)).not.toContain("stitch-too-long");
    expect(r.plan.stitches.length).toBe(3);
    const split = run(14, "suiting");
    expect(split.warnings.map((w) => w.code)).toContain("stitch-too-long");
  });
  it("stays quiet at 7 mm or less, and on things that are not worn", () => {
    expect(run(7, "suiting").warnings.map((w) => w.code)).not.toContain("long-stitch-snag");
    expect(run(9, "towel").warnings.map((w) => w.code)).not.toContain("long-stitch-snag");
  });
  it("does not count a jump or a trim as a stitch", () => {
    const p = line(2);
    p.stitches.push({ x: 60, y: 0, type: "trim", threadIndex: 0, objectIndex: 0 }, { x: 62, y: 0, type: "stitch", threadIndex: 0, objectIndex: 0 });
    const r = validatePlan(p, DEFAULT_HOOP, { lockStitchMm: 0, design: designOf(3, 40) });
    expect(r.warnings.map((w) => w.code)).not.toContain("long-stitch-snag");
  });
});

describe("planStats time model", () => {
  const at = (type: PlanStitch["type"], i = 0): PlanStitch => ({ x: i, y: 0, type, threadIndex: 0, objectIndex: 0 });
  const plan: StitchPlan = {
    threads: [blue],
    warnings: [],
    stitches: [...Array.from({ length: 850 }, (_, i) => at("stitch", i)), at("trim"), at("trim"), at("colorChange"), at("colorChange"), at("colorChange")],
  };
  it("counts stitches, 7 s per trim and 45 s per colour change", () => {
    const s = planStats(plan, 850);
    expect([s.trimCount, s.colorChanges]).toEqual([2, 3]);
    expect(TRIM_SECONDS).toBe(7);
    expect(COLOR_CHANGE_SECONDS).toBe(45);
    expect(s.machineSeconds).toBeCloseTo(60 + 2 * 7 + 3 * 45, 6);
  });
  it("adds a quarter for real-world stops, on top of the machine time", () => {
    const s = planStats(plan, 850);
    expect(REAL_WORLD_FACTOR).toBe(1.25);
    expect(s.estimatedSeconds).toBeCloseTo(s.machineSeconds * 1.25, 6);
  });
  it("slower speed means more time, and the 850 default is used when no speed is given", () => {
    expect(planStats(plan, 450).machineSeconds).toBeGreaterThan(planStats(plan, 850).machineSeconds);
    expect(planStats(plan).machineSeconds).toBe(planStats(plan, 850).machineSeconds);
    expect(planStats(plan, 425).machineSeconds - planStats(plan, 850).machineSeconds).toBeCloseTo(60, 6);
  });
  it("an empty plan takes no time", () => {
    expect(planStats({ threads: [], stitches: [], warnings: [] }).estimatedSeconds).toBe(0);
  });
});
