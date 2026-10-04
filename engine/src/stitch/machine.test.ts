import { describe, expect, it } from "vitest";
import { DEFAULT_RUN_PARAMS, emptyDesign, makeRun, nodesFromPolyline, type Design, type Hoop } from "../model";
import { HOOP_LIBRARY, findHoopSpec, hoopFromSpec, hoopTurned, machineHoop, rotateHoop } from "../hoops";
import { applyOrigin, CENTER_ORIGIN, writePes } from "../pes";
import { designToEmbroidery, designToPes } from "../export";
import { createPixelArt, pixelArtToPes } from "../pixelart";
import { designToStitchPlan } from "./generate";
import { planStats, type PlanStitch, type StitchPlan } from "./plan";
import { toMachineFrame, validateForMachine } from "./machine";
import { validatePlan } from "./validate";

const THREAD = { id: "t", brand: "B", code: "1", name: "x", hex: "#000000" };
const nv = (id: string): Hoop => hoopFromSpec(findHoopSpec(id)!);
const box = (hoop: Hoop, w: number, h: number): Design => {
  const d = emptyDesign(hoop);
  d.threads = [THREAD];
  d.objects = [makeRun("r", "r", "t", nodesFromPolyline([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]), true, DEFAULT_RUN_PARAMS)];
  return d;
};
const st = (x: number, y: number): PlanStitch => ({ x, y, type: "stitch", threadIndex: 0, objectIndex: 0 });
const plan1 = (x: number, y: number): StitchPlan => ({ threads: [THREAD], stitches: [st(x, y)], warnings: [] });
const SIDE = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] } as const;

describe("turned hoops", () => {
  it("hoopTurned / machineHoop derive from the library id", () => {
    const base = nv("brother-nv2700-160x260");
    expect(hoopTurned(base)).toBe(false);
    const t = rotateHoop(base);
    expect(t.widthMm).toBe(260);
    expect(t.clamp).toBe("bottom");
    expect(hoopTurned(t)).toBe(true);
    expect(machineHoop(t)).toEqual(base);
    expect(machineHoop(rotateHoop(rotateHoop(base)))).toEqual(base);
    expect(machineHoop(base)).toBe(base);
    expect(hoopTurned({ name: "mine", widthMm: 100, heightMm: 50 })).toBe(false);
  });

  it("every library hoop with a clamp: the on-screen clamp edge lands on the physical clamp edge", () => {
    let checked = 0;
    for (const spec of HOOP_LIBRARY) {
      if (!spec.clamp || spec.clamp === "none") continue;
      const base = hoopFromSpec(spec);
      let screen = base;
      for (let q = 0; q < 4; q++) {
        if (q > 0) screen = rotateHoop(screen);
        if (q === 0) continue;
        expect(hoopTurned(screen), spec.id).toBe(true);
        const [sx, sy] = SIDE[screen.clamp as keyof typeof SIDE];
        const p = toMachineFrame(plan1((sx * screen.widthMm) / 2, (sy * screen.heightMm) / 2), screen).stitches[0];
        const [px, py] = SIDE[spec.clamp as keyof typeof SIDE];
        expect(p.x * px + p.y * py, spec.id).toBeCloseTo(((px !== 0 ? base.widthMm : base.heightMm) / 2), 6);
        expect(Math.abs(p.x * py) + Math.abs(p.y * px), spec.id).toBeCloseTo(0, 6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("turned NV2700: 200 mm wide now fits (it is written 20 wide), 200 mm tall does not (machine X is 160)", () => {
    const turned = rotateHoop(nv("brother-nv2700-160x260"));
    const wide = designToPes(box(turned, 200, 20));
    expect(wide.warnings.map((w) => w.code)).not.toContain("outside-hoop");
    expect(wide.stats.widthMm).toBeCloseTo(20, 1);
    expect(wide.stats.heightMm).toBeCloseTo(200, 1);
    const tall = designToPes(box(turned, 20, 200));
    expect(tall.warnings.map((w) => w.code)).toContain("outside-hoop");
    expect(tall.warnings.find((w) => w.code === "outside-hoop")?.message).toContain("160 x 260");
    expect(tall.warnings.find((w) => w.code === "hoop-turned")?.message).toContain("Hoop is turned in Lilo");
    // the old bug: a 260 wide design sewed 260 along the machine's 160 X. Now it is Y.
    expect(designToPes(box(turned, 250, 20)).stats.widthMm).toBeCloseTo(20, 1);
  });

  it("turned: a 60x28 design is written 28 wide and 60 tall; no outside-hoop", () => {
    for (const id of ["brother-nv2700-160x260", "brother-nv2700-130x180"]) {
      const turned = rotateHoop(nv(id));
      const d = box(turned, 60, 28);
      const onScreen = planStats(designToStitchPlan(d));
      expect(onScreen.widthMm).toBeCloseTo(60, 1);
      const r = designToPes(d);
      expect(r.stats.widthMm).toBeCloseTo(28, 1);
      expect(r.stats.heightMm).toBeCloseTo(60, 1);
      expect(r.warnings.map((w) => w.code)).not.toContain("outside-hoop");
      const e = designToEmbroidery(d, "dst");
      expect(e.stats.widthMm).toBeCloseTo(28, 1);
      expect(e.stats.heightMm).toBeCloseTo(60, 1);
      expect(e.warnings.map((w) => w.code)).toContain("hoop-turned");
    }
  });

  it("not turned: nothing changes, bytes identical to the old path, no extra warning", () => {
    const d = box(nv("brother-nv2700-160x260"), 60, 28);
    const old = validatePlan(designToStitchPlan(d), d.hoop, { quality: d.sewing?.quality });
    const placed = applyOrigin(old.plan, CENTER_ORIGIN);
    const r = designToPes(d, { label: "x" });
    expect(Array.from(r.pes)).toEqual(Array.from(writePes(placed, { label: "x" })));
    expect(r.warnings).toEqual(old.warnings);
    const p = plan1(3, 4);
    expect(toMachineFrame(p, d.hoop)).toBe(p);
  });

  it("validateForMachine checks the real hoop size", () => {
    const turned = rotateHoop(nv("brother-nv2700-160x260"));
    const tall: StitchPlan = { threads: [THREAD], stitches: Array.from({ length: 21 }, (_, i) => st(0, -100 + i * 10)), warnings: [] };
    const r = validateForMachine(tall, turned, { lockStitchMm: 0 });
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["outside-hoop", "hoop-turned"]));
    expect(r.plan.warnings).toBe(r.warnings);
  });

  it("pixel art export goes through the same path", () => {
    const turned = rotateHoop(nv("brother-nv2700-160x260"));
    const art = { ...createPixelArt(20, 4, 3), threads: [THREAD] };
    art.cells = art.cells.map(() => "t");
    const r = pixelArtToPes(art, turned);
    expect(r.warnings.map((w) => w.code)).toContain("hoop-turned");
  });
});
