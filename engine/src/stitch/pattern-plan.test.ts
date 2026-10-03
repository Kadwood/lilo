import { describe, expect, it } from "vitest";
import { DEFAULT_FILL_PARAMS, DEFAULT_HOOP, emptyDesign, getCatalogue, makeFill, rectNodes, toDesignThread, type Design, type DesignObject, type FillObject } from "../index";
import { designToStitchPlan, registerObjectGenerator, validatePlan } from "./index";
import { polylineRun } from "./runs";

const thread = toDesignThread(getCatalogue().threads.find((t) => t.name === "Blue")!);

const fill = (params: Partial<FillObject["params"]> = {}, extra: Partial<FillObject> = {}): FillObject => ({
  ...makeFill("f", "Fill", thread.id, rectNodes(-20, -15, 20, 15)),
  ...extra,
  params: { ...DEFAULT_FILL_PARAMS, ...params },
});

function plan(o: DesignObject) {
  const d: Design = { ...emptyDesign(DEFAULT_HOOP), threads: [thread], objects: [o] };
  return validatePlan(designToStitchPlan(d), d.hoop);
}

const needle = (p: ReturnType<typeof plan>) => p.plan.stitches.filter((s) => s.type === "stitch");

describe("pattern fills in the plan", () => {
  it("a pattern fill produces stitches inside the shape with its underlay and edge outline", () => {
    const { plan: p, warnings } = plan(fill({ pattern: "hearts-m" }));
    const s = p.stitches.filter((x) => x.type === "stitch");
    expect(s.length).toBeGreaterThan(500);
    expect(s.every((x) => Math.abs(x.x) <= 20.5 && Math.abs(x.y) <= 15.5)).toBe(true);
    expect(warnings.find((w) => w.code === "object-failed")).toBeUndefined();
  });

  it("different patterns give different stitching", () => {
    const a = needle(plan(fill({ pattern: "waves" }))).length;
    const b = needle(plan(fill({ pattern: "diamonds-s" }))).length;
    expect(a).not.toBe(b);
  });

  it("more underlays means more stitches; none means fewer", () => {
    const one = needle(plan(fill({ underlay: true }))).length;
    const none = needle(plan(fill({ underlay: false }))).length;
    const two = needle(
      plan(
        fill({
          underlays: [
            { angleDeg: 135, spacingMm: 2.5, stitchLengthMm: 3.5, insetMm: 0.5 },
            { angleDeg: 0, spacingMm: 3, stitchLengthMm: 3.5, insetMm: 0.8 },
          ],
        }),
      ),
    ).length;
    expect(none).toBeLessThan(one);
    expect(two).toBeGreaterThan(one);
  });

  it("open patterns skip the automatic underlay (it would show through the gaps) but keep hand-made passes", () => {
    const withAuto = needle(plan(fill({ pattern: "hearts-m", underlay: true }))).length;
    const without = needle(plan(fill({ pattern: "hearts-m", underlay: false }))).length;
    expect(withAuto).toBe(without);
    const custom = needle(plan(fill({ pattern: "hearts-m", underlays: [{ angleDeg: 0, spacingMm: 3, stitchLengthMm: 3.5, insetMm: 0.5 }] }))).length;
    expect(custom).toBeGreaterThan(without);
    // dense patterns still get it
    expect(needle(plan(fill({ pattern: "waves", underlay: true }))).length).toBeGreaterThan(needle(plan(fill({ pattern: "waves", underlay: false }))).length);
  });

  it("hand stitch and gradient route through our own fill engine and stay deterministic", () => {
    const a = plan(fill({ handStitch: 3 }));
    const b = plan(fill({ handStitch: 3 }));
    expect(JSON.stringify(a.plan.stitches)).toBe(JSON.stringify(b.plan.stitches));
    const plain = needle(plan(fill({}))).length;
    const ramp = needle(plan(fill({ gradient: { kind: "ramp", from: 1, to: 4 } }))).length;
    expect(ramp).toBeLessThan(plain);
  });

  it("start point decides where sewing begins", () => {
    const a = needle(plan(fill({ pattern: "contour", underlay: false, edgeRun: false }, { startPoint: [-20, -15] })))[0];
    const b = needle(plan(fill({ pattern: "contour", underlay: false, edgeRun: false }, { startPoint: [20, 15] })))[0];
    expect(Math.hypot(a.x - -20, a.y - -15)).toBeLessThan(Math.hypot(b.x - -20, b.y - -15));
  });

  it("every pattern sews through the full pipeline without stitches over 12 mm", () => {
    for (const id of ["tatami", "original", "zigzag", "stars", "spiral", "tornado", "streamlines", "stipple", "sunburst"]) {
      const { plan: p } = plan(fill({ pattern: id, rowSpacingMm: 0.6 }));
      let prev = p.stitches[0];
      for (const s of p.stitches.slice(1)) {
        if (s.type === "stitch" && prev.type === "stitch") expect(Math.hypot(s.x - prev.x, s.y - prev.y)).toBeLessThanOrEqual(12.0001);
        prev = s;
      }
      expect(p.stitches.filter((s) => s.type === "stitch").length).toBeGreaterThan(100);
    }
  });
});

describe("object generator registry (the lettering extension point)", () => {
  it("lets another module sew a new object kind", () => {
    registerObjectGenerator("test-kind", {
      runs: () => [polylineRun([[[0, 0], [5, 0], [5, 5]]])],
      centre: () => [2, 2],
    });
    const o = { id: "x", name: "X", kind: "test-kind", threadId: thread.id } as unknown as DesignObject;
    const d: Design = { ...emptyDesign(DEFAULT_HOOP), threads: [thread], objects: [o] };
    const raw = designToStitchPlan(d).stitches.filter((s) => s.type === "stitch");
    expect(raw.map((s) => [s.x, s.y])).toEqual([[0, 0], [5, 0], [5, 5]]);
  });
});
