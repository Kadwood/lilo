import { beforeAll, describe, expect, it } from "vitest";
import { autoDigitizeSvg } from "../src/autodigitize";
import { satinPitchFromDensity } from "../src/autodigitize/profile";
import type { Design, SatinObject } from "../src/model";
import { QUALITIES } from "../src/presets";
import { designToStitchPlan, planStats, validatePlan } from "../src/stitch";
import { ready } from "./lettering-helpers";
import { objectCounts } from "./pipeline";
import { wordmarkSvg } from "./wordmark";

/**
 * Premium quality on the Playfair "DOVE" fixture (a high-contrast serif: thick stems, hairline serifs,
 * an O with hairline top and bottom), plus a plain blob to exercise fills.
 */

beforeAll(async () => {
  await ready();
});

const svg = wordmarkSvg("DOVE");
const blob = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#1a3d7c" d="M10 50 C10 20 40 5 60 12 C90 22 95 60 70 85 C45 100 15 85 10 50 Z"/></svg>`;

async function run(widthMm: number, opts: Record<string, unknown> = {}, source = svg) {
  const { design } = await autoDigitizeSvg(source, { widthMm, ...opts } as never);
  const { plan, warnings } = validatePlan(designToStitchPlan(design), design.hoop);
  return { design, plan, warnings, stats: planStats(plan) };
}

function lengths(plan: ReturnType<typeof validatePlan>["plan"]) {
  let prev: { x: number; y: number } | null = null;
  let min = Infinity;
  let max = 0;
  for (const s of plan.stitches) {
    if (s.type === "stitch" && prev && !s.lock) {
      const len = Math.hypot(s.x - prev.x, s.y - prev.y);
      min = Math.min(min, len);
      max = Math.max(max, len);
    }
    prev = s.type === "stitch" ? s : null;
  }
  return { min, max };
}

const satins = (d: Design): SatinObject[] => d.objects.filter((o): o is SatinObject => o.kind === "satin");

describe("Premium auto-digitize on the DOVE wordmark", () => {
  it.each([80, 100])("%i mm: density validator is clean, no stitch under 0.3 or over 12 mm", async (w) => {
    const { design, plan, warnings } = await run(w, { quality: "premium", threadWeight: 40, fabric: "woven" });
    expect(warnings.filter((x) => x.code === "density" || x.code === "object-failed" || x.code === "outside-hoop")).toEqual([]);
    const l = lengths(plan);
    expect(l.min).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(l.max).toBeLessThanOrEqual(12);
    expect(design.objects.length).toBeGreaterThan(0);
  });

  it("hairlines become narrow satin at the minimum width, not faint single runs", async () => {
    const std = await run(80, { quality: "standard" });
    const prm = await run(80, { quality: "premium" });
    const narrow = satins(prm.design).filter((s) => s.params.widthMm <= 1);
    expect(narrow.length).toBeGreaterThan(0);
    // Standard sews them as runs; premium keeps at most a few triple-run stubs.
    expect(objectCounts(std.design).run).toBeGreaterThan(objectCounts(prm.design).run);
    for (const o of prm.design.objects) if (o.kind === "run") expect(o.params.repeats).toBe(3);
    // The narrowest premium column is the 0.8 mm minimum (40 wt).
    const widths = satins(prm.design).map((s) => s.params.widthMm);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(0.8 - 1e-9);
  });

  it("thread weight and the explicit minSatinWidthMm move the minimum column", async () => {
    const fine = await run(80, { quality: "premium", threadWeight: 60 });
    expect(Math.min(...satins(fine.design).map((s) => s.params.widthMm))).toBeGreaterThanOrEqual(0.7 - 1e-9);
    const forced = await run(80, { quality: "premium", minSatinWidthMm: 1.2 });
    expect(Math.min(...satins(forced.design).map((s) => s.params.widthMm))).toBeGreaterThanOrEqual(1.2 - 1e-9);
  });

  it("every column's density sits in the premium pitch band and underlay follows width", async () => {
    const { design } = await run(100, { quality: "premium" });
    for (const s of satins(design)) {
      const pitch = satinPitchFromDensity(s.params.densityMm);
      expect(pitch).toBeGreaterThanOrEqual(0.32);
      expect(pitch).toBeLessThanOrEqual(0.4);
      expect(s.params.shortStitches).toBe(true);
      // widthMm is rounded to 0.1, so stay clear of the 1 / 2 / 3.5 mm boundaries
      const w = s.params.widthMm;
      if (w < 0.95) expect(s.params.underlay).toBe("none");
      else if (w > 1.05 && w < 1.95) expect(s.params.underlay).toBe("center");
      else if (w > 2.05 && w < 3.45) expect(s.params.underlay).toBe("contour");
      else if (w > 3.55) expect(s.params.underlay).toBe("contour-zigzag");
    }
  });

  it("standard output is untouched by the new options' defaults", async () => {
    const a = await run(60);
    const b = await run(60, { quality: "standard", threadWeight: 40, fabric: "woven" });
    expect(JSON.stringify(b.design)).toEqual(JSON.stringify(a.design));
    expect(JSON.stringify(b.plan.stitches)).toEqual(JSON.stringify(a.plan.stitches));
    for (const s of satins(a.design)) expect(s.params.densityMm).toBe(0.4);
  });

  it("`setup` resolves through the presets and equals the flat options", async () => {
    const flat = await run(80, { quality: "premium", threadWeight: 60, fabric: "knit" });
    const viaSetup = await run(80, { setup: { quality: "premium", threadWeight: 60, fabric: "knit" } });
    expect(JSON.stringify(viaSetup.design)).toEqual(JSON.stringify(flat.design));
  });

  it("fabric changes pull compensation (knit pulls more than suiting)", async () => {
    const woven = satins((await run(100, { quality: "premium", fabric: "woven" })).design);
    const knit = satins((await run(100, { quality: "premium", fabric: "knit" })).design);
    expect(woven.length).toBeGreaterThan(0);
    const mean = (xs: SatinObject[]) => xs.reduce((n, s) => n + s.params.pullCompMm, 0) / xs.length;
    expect(mean(knit)).toBeGreaterThan(mean(woven) * 1.3);
  });

  it("premium stitch count stays near the stated multiplier on the wordmark", async () => {
    for (const w of [80, 100]) {
      const std = (await run(w, { quality: "standard" })).stats.stitchCount;
      const prm = (await run(w, { quality: "premium" })).stats.stitchCount;
      const ratio = prm / std;
      expect(Math.abs(ratio - QUALITIES.premium.stitchCountMultiplier)).toBeLessThan(0.25);
    }
  });
});

describe("Premium fills", () => {
  it("get edge-walk + perpendicular underlay, and sew clean", async () => {
    const { design, warnings, plan } = await run(40, { quality: "premium", fabric: "twill", threadWeight: 40 }, blob);
    const fills = design.objects.filter((o) => o.kind === "fill");
    expect(fills.length).toBeGreaterThan(0);
    for (const f of fills) {
      if (f.kind !== "fill") continue;
      expect(f.params.edgeWalk).toBeDefined();
      expect(f.params.underlays?.[0].angleDeg).toBe(135); // 90 deg off the 45 deg top rows
      expect(f.params.rowSpacingMm).toBeGreaterThanOrEqual(0.3);
      expect(f.params.rowSpacingMm).toBeLessThanOrEqual(0.5);
      expect(f.params.pullCompMm).toBe(0.3); // twill
    }
    expect(warnings.filter((x) => x.code === "density" || x.code === "object-failed")).toEqual([]);
    const l = lengths(plan);
    expect(l.min).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(l.max).toBeLessThanOrEqual(12);
  });

  it("the edge walk adds a loop of stitches inside the edge before the top stitching", async () => {
    const std = await run(40, { quality: "standard" }, blob);
    const prm = await run(40, { quality: "premium" }, blob);
    expect(prm.stats.stitchCount).toBeGreaterThan(0);
    expect(std.stats.stitchCount).toBeGreaterThan(0);
    const walkOff = await run(40, { quality: "premium", fill: { edgeWalk: undefined } }, blob);
    expect(walkOff.stats.stitchCount).toBeLessThan(prm.stats.stitchCount);
  });
});
