import { describe, expect, it } from "vitest";
import { addLockStitches, mergeShortStitches } from "./validate";
import type { PlanStitch } from "./plan";

const st = (x: number, y = 0, extra: Partial<PlanStitch> = {}): PlanStitch => ({ x, y, type: "stitch", threadIndex: 0, objectIndex: 0, ...extra });
const jump = (x: number): PlanStitch => ({ x, y: 0, type: "jump", threadIndex: 0, objectIndex: 0 });

describe("mergeShortStitches", () => {
  it("drops drops closer than the minimum and keeps the first and last point of a run", () => {
    const out = mergeShortStitches([st(0), st(0.1), st(0.2), st(1), st(1.1)], 0.3);
    expect(out.map((s) => s.x)).toEqual([0, 1.1]);
  });
  it("keeps a lone first stitch even when the last is very close", () => {
    expect(mergeShortStitches([st(0), st(0.1)], 0.3).map((s) => s.x)).toEqual([0]);
  });
  it("never merges across a jump, trim or colour change", () => {
    const out = mergeShortStitches([st(0), jump(5), st(5), st(5.1), { ...jump(9), type: "trim" }, st(9)], 0.3);
    expect(out.map((s) => `${s.type}${s.x}`)).toEqual(["stitch0", "jump5", "stitch5", "trim9", "stitch9"]);
  });
  it("does not merge across objects", () => {
    expect(mergeShortStitches([st(0), st(0.1, 0, { objectIndex: 1 })], 0.3)).toHaveLength(2);
  });
  it("is off at 0, and lock stitches added afterwards are untouched", () => {
    expect(mergeShortStitches([st(0), st(0.1)], 0)).toHaveLength(2);
    const locked = addLockStitches(mergeShortStitches([st(0), st(3), st(6)], 0.3), 0.4);
    expect(locked.filter((s) => s.lock).length).toBeGreaterThan(0);
  });
});
