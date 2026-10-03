import { describe, expect, it } from "vitest";
import { autoDigitizeSvg } from "../src/autodigitize";
import { validateDesign } from "../src/model";
import { designToStitchPlan, validatePlan } from "../src/stitch";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="45" fill="#0b3d91"/>
  <circle cx="50" cy="50" r="30" fill="#ed171f"/>
  <circle cx="50" cy="50" r="10" fill="#ffffff"/>
  <path d="M10 95 H90" stroke="#e8a900" stroke-width="3" fill="none"/>
</svg>`;

describe("autoDigitizeSvg", () => {
  it("skips tracing: fills become cut-out regions, strokes become satin/fill, colours snap to threads", async () => {
    const stages: string[] = [];
    const r = await autoDigitizeSvg(SVG, { widthMm: 50 }, (e) => stages.push(e.stage));
    expect(stages).toEqual(["cleanup", "done"]);
    expect(validateDesign(r.design)).toEqual([]);
    expect(r.design.threads.map((t) => t.name).sort()).toEqual(["Deep Gold", "Red", "Ultramarine", "White"]);
    // Painter's order is respected with no overlap: the navy region has a hole where the red sits.
    const navy = r.design.objects.find((o) => o.kind === "fill" && o.threadId === r.design.threads.find((t) => t.hex === "#0b3d91")!.id);
    expect(navy?.kind === "fill" && navy.geometry.holes.length).toBeGreaterThan(0);
    const { plan, warnings } = validatePlan(designToStitchPlan(r.design), r.design.hoop);
    expect(plan.stitches.length).toBeGreaterThan(500);
    expect(warnings.filter((w) => w.code === "object-failed")).toEqual([]);
  }, 60_000);

  it("rejects an SVG with nothing to stitch", async () => {
    await expect(autoDigitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5" fill="none"/></svg>`)).rejects.toThrow(/no filled or stroked/);
  });
});
