import { beforeAll, describe, expect, it } from "vitest";
import { autoDigitizeSvg } from "../src/autodigitize";
import { designToStitchPlan, validatePlan } from "../src/stitch";
import { ready } from "./lettering-helpers";
import { objectCounts } from "./pipeline";
import { wordmarkSvg } from "./wordmark";

/**
 * Regression for two auto-digitize bugs found with a real high-contrast serif wordmark:
 *  1. the satin-column union threw "does not support GeometryCollection arguments" at some widths;
 *  2. every letter became a running stitch at 60 mm (mean-width classification: hairlines dragged
 *     the thick stems under 1 mm).
 * The wordmark here is synthetic: "DOVE" in Playfair Display (SIL OFL, see fixtures/fonts), a Didone
 * with thick stems, hairline serifs and an O with hairline top/bottom.
 */

beforeAll(async () => {
  await ready();
});

const svg = wordmarkSvg("DOVE");

async function run(widthMm: number) {
  const { design } = await autoDigitizeSvg(svg, { widthMm });
  const { plan, warnings } = validatePlan(designToStitchPlan(design), design.hoop);
  return { design, plan, warnings };
}

function stitchLengths(plan: ReturnType<typeof validatePlan>["plan"]) {
  let prev: { x: number; y: number } | null = null;
  let long = 0;
  let short = 0;
  for (const s of plan.stitches) {
    if (s.type === "stitch" && prev && !s.lock) {
      const len = Math.hypot(s.x - prev.x, s.y - prev.y);
      if (len > 12) long++;
      if (len < 0.3) short++;
    }
    prev = s.type === "stitch" ? s : null; // a jump/trim starts a new run: its first drop is not a stitch
  }
  return { long, short };
}

describe("auto-digitize a high-contrast serif wordmark", () => {
  it.each([60, 100, 140])("%i mm: no exceptions, sane stitches, fits the hoop", async (w) => {
    const { design, plan, warnings } = await run(w);
    expect(design.objects.length).toBeGreaterThan(0);
    expect(stitchLengths(plan)).toEqual({ long: 0, short: 0 });
    expect(warnings.filter((x) => x.code === "outside-hoop" || x.code === "object-failed")).toEqual([]);
    for (const s of plan.stitches) {
      expect(Math.abs(s.x)).toBeLessThanOrEqual(design.hoop.widthMm / 2);
      expect(Math.abs(s.y)).toBeLessThanOrEqual(design.hoop.heightMm / 2);
    }
  });

  it("60 mm: thick stems are satin and hairlines are runs (not everything a run)", async () => {
    const { design } = await run(60);
    const c = objectCounts(design);
    expect(c.satin).toBeGreaterThan(0);
    expect(c.run).toBeGreaterThan(0);
  });

  it("is deterministic", async () => {
    const a = await run(60);
    const b = await run(60);
    expect(JSON.stringify(a.design)).toEqual(JSON.stringify(b.design));
    expect(JSON.stringify(a.plan.stitches)).toEqual(JSON.stringify(b.plan.stitches));
  });

  it("minSatinWidthMm moves the satin/run boundary", async () => {
    const lo = objectCounts((await autoDigitizeSvg(svg, { widthMm: 60, minSatinWidthMm: 0.3 })).design);
    const hi = objectCounts((await autoDigitizeSvg(svg, { widthMm: 60, minSatinWidthMm: 2.5 })).design);
    expect(hi.satin).toBeLessThan(lo.satin + 1);
    expect(hi.run).toBeGreaterThan(lo.run - 1);
    expect(lo.satin).toBeGreaterThan(hi.satin);
  });
});
