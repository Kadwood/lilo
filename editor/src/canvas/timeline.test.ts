import { describe, expect, it } from "vitest";
import { buildTimeline, phaseAt } from "./timeline";

describe("tracing animation timeline", () => {
  it("runs quantise -> trace layers in sequence -> stitches", () => {
    const t = buildTimeline(3, false);
    expect(t.layerStart).toHaveLength(3);
    expect(t.layerStart[0]).toBe(t.quantizeEnd);
    expect(t.layerStart[1]).toBeGreaterThan(t.layerStart[0]);
    expect(t.traceEnd).toBeCloseTo(t.layerStart[2] + t.layerDuration, 9);
    expect(t.stitchStart).toBe(t.traceEnd);
    expect(t.total).toBe(t.stitchEnd);
    expect([0, t.quantizeEnd + 0.01, t.stitchStart + 0.01, t.total + 1].map((s) => phaseAt(t, s))).toEqual(["quantize", "trace", "stitch", "done"]);
  });

  it("stays short for many colours", () => {
    expect(buildTimeline(12, false).total).toBeLessThan(6);
  });

  it("is instant with reduced motion", () => {
    const t = buildTimeline(6, true);
    expect(t.total).toBe(0);
    expect(phaseAt(t, 0)).toBe("done");
  });
});
