import { describe, expect, it } from "vitest";
import { railsToStrip, stripWidths } from "./satin";

describe("railsToStrip", () => {
  it("pairs two straight rails by arc length", () => {
    const strip = railsToStrip([[0, 0, 10, 0], [0, 2, 10, 2]], [], 1);
    expect(strip.length).toBeGreaterThanOrEqual(2 * 11);
    expect(strip[0]).toEqual([0, 0]);
    expect(strip[1]).toEqual([0, 2]);
    expect(strip[strip.length - 2]).toEqual([10, 0]);
    for (const w of stripWidths(strip)) expect(w).toBeCloseTo(2, 6);
  });

  it("honours a rung: the stitch direction at the rung follows the rung", () => {
    // Rung leans: bottom end at x=7, top end at x=3.
    const strip = railsToStrip([[0, 0, 10, 0], [0, 2, 10, 2]], [[7, 0, 3, 2]], 5);
    const hit = strip.findIndex((p, i) => i % 2 === 0 && Math.abs(p[0] - 7) < 1e-6 && Math.abs(p[1]) < 1e-6);
    expect(hit).toBeGreaterThanOrEqual(0);
    expect(strip[hit + 1][0]).toBeCloseTo(3, 6);
    expect(strip[hit + 1][1]).toBeCloseTo(2, 6);
  });

  it("sorts rungs given out of order and keeps the strip moving forward", () => {
    const strip = railsToStrip([[0, 0, 10, 0], [0, 2, 10, 2]], [[6, 0, 6, 2], [2, 0, 2, 2]], 5);
    const lefts = strip.filter((_, i) => i % 2 === 0).map((p) => p[0]);
    for (let i = 1; i < lefts.length; i++) expect(lefts[i]).toBeGreaterThanOrEqual(lefts[i - 1] - 1e-9);
    expect(lefts).toContain(2);
    expect(lefts).toContain(6);
  });

  it("returns nothing for degenerate rails", () => {
    expect(railsToStrip([[0, 0], [1, 1]], [])).toEqual([]);
  });
});
