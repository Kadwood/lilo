import { describe, expect, it } from "vitest";
import { clearStitchCache, designToStitchPlan } from "./generate";
import { sampleDesign } from "./sample-design";
import type { Design } from "../model";

/** The per-object cache must be invisible: same plan with a cold or warm cache, whatever was edited. */
describe("designToStitchPlan object cache", () => {
  it("a warm plan equals a cold plan", () => {
    clearStitchCache();
    const cold = designToStitchPlan(sampleDesign());
    const warm = designToStitchPlan(sampleDesign());
    expect(warm).toEqual(cold);
    expect(cold.stitches.length).toBeGreaterThan(500);
  });

  it("after an edit, the plan equals one made from scratch (neighbours re-aim, nothing stale)", () => {
    const d = sampleDesign();
    designToStitchPlan(d); // warm the cache with the original
    const edited: Design = { ...d, objects: d.objects.map((o, i) => (i === 0 && o.kind === "fill" ? { ...o, params: { ...o.params, angleDeg: o.params.angleDeg + 30 } } : o)) };
    const viaCache = designToStitchPlan(edited);
    clearStitchCache();
    expect(designToStitchPlan(edited)).toEqual(viaCache);
    expect(viaCache).not.toEqual(designToStitchPlan(d));
  });

  it("hiding an object re-plans what follows, the same as from scratch", () => {
    const d = sampleDesign();
    const a = designToStitchPlan(d);
    const hidden: Design = { ...d, objects: d.objects.map((o, i) => (i === 1 ? { ...o, visible: false } : o)) };
    const b = designToStitchPlan(hidden);
    expect(b.stitches.length).toBeLessThan(a.stitches.length);
    clearStitchCache();
    expect(designToStitchPlan(hidden)).toEqual(b);
    expect(designToStitchPlan(d)).toEqual(a);
  });
});
