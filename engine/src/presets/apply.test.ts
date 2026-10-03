import { describe, expect, it } from "vitest";
import { DEFAULT_RUN_PARAMS, DEFAULT_SATIN_PARAMS, emptyDesign, makeFill, rectNodes, validateDesign, type Design, type DesignObject, type SatinObject } from "../model";
import { applySewingSetupTo, autoObjectCount, markAutoParams, normaliseSewing, presetParamsFor, recommendedSpeed, resolveSewingSetup, sewingOf } from "./index";
import { satinParamsFor } from "../autodigitize/profile";

const thread = { id: "t1", brand: "Brother", line: "Embroidery", code: "406", name: "Blue", hex: "#1a3a8a" };

function satin(id: string, widthMm: number): SatinObject {
  return {
    id,
    name: id,
    kind: "satin",
    threadId: "t1",
    geometry: { strip: [[0, 0], [0, widthMm], [10, 0], [10, widthMm], [20, 0], [20, widthMm]] },
    params: { ...DEFAULT_SATIN_PARAMS, widthMm },
  };
}

/** A fill, two satin columns of different width and a run, as the auto-digitizer would leave them. */
function sample(): Design {
  const d: Design = { ...emptyDesign(), threads: [thread] };
  d.objects = [
    makeFill("f", "Fill", "t1", rectNodes(0, 0, 30, 20)),
    satin("s-narrow", 1.6),
    satin("s-wide", 6),
    { id: "r", name: "Run", kind: "run", threadId: "t1", geometry: { path: [[0, 0], [10, 0]], closed: false }, params: { ...DEFAULT_RUN_PARAMS } },
  ];
  return d;
}
/** What the generator hands over: the shapes carry the setup's values, then are marked. */
function generated(setup: Parameters<typeof markAutoParams>[1]): Design {
  const d = sample();
  const sew = resolveSewingSetup(setup).engine;
  for (const o of d.objects) {
    const t = presetParamsFor(o, sew);
    if (t) Object.assign(o.params, JSON.parse(JSON.stringify(t)));
  }
  return markAutoParams(d, setup);
}
const get = (d: Design, id: string): DesignObject => d.objects.find((o) => o.id === id)!;

describe("marking auto-generated objects", () => {
  it("stores the setup on the design and a snapshot on fills and satin, not on runs", () => {
    const d = markAutoParams(sample(), { fabric: "knit", threadWeight: 60, quality: "premium" });
    expect(d.sewing).toEqual({ fabric: "knit", threadWeight: 60, quality: "premium" });
    expect(get(d, "f").autoParams).toBeDefined();
    expect(get(d, "s-narrow").autoParams).toBeDefined();
    expect(get(d, "r").autoParams).toBeUndefined();
    expect(autoObjectCount(d)).toBe(3);
    // the snapshot is what the engine would give that column
    const sew = resolveSewingSetup(d.sewing).engine;
    expect(get(d, "s-wide").autoParams).toMatchObject({ densityMm: satinParamsFor(6, sew).densityMm, pullCompMm: satinParamsFor(6, sew).pullCompMm });
    expect(get(d, "s-wide").autoParams).not.toHaveProperty("widthMm");
  });

  it("a marked design is still a valid design (the project file keeps it as plain JSON)", () => {
    const d = markAutoParams(sample(), { quality: "premium" });
    expect(validateDesign(d)).toEqual([]);
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });

  it("reads the setup of a design that has none as the defaults", () => {
    expect(sewingOf(sample())).toEqual({ fabric: "suiting", threadWeight: 40, quality: "standard" });
    expect(sewingOf(null).quality).toBe("standard");
    expect(normaliseSewing({ fabric: "woven" as never }).fabric).toBe("suiting");
    expect(normaliseSewing({ fabric: "cap" as never }).fabric).toBe("twill");
    expect(normaliseSewing({ fabric: "nonsense" as never }).fabric).toBe("suiting");
    expect(normaliseSewing({ threadWeight: 50 as never }).threadWeight).toBe(40);
  });
});

describe("changing the setup of a design", () => {
  it("re-applies the new preset to everything auto-generated", () => {
    const d = generated({ fabric: "suiting", threadWeight: 40, quality: "standard" });
    const before = JSON.parse(JSON.stringify(d)) as Design;
    const r = applySewingSetupTo(d, { fabric: "knit", threadWeight: 60, quality: "premium" });
    expect(d.sewing).toEqual({ fabric: "knit", threadWeight: 60, quality: "premium" });
    expect(r.updated).toBe(3);
    expect(r.kept).toBe(0);
    const sew = resolveSewingSetup(d.sewing).engine;
    for (const id of ["s-narrow", "s-wide"]) {
      const o = get(d, id) as SatinObject;
      const want = satinParamsFor(o.params.widthMm, sew);
      expect(o.params.densityMm).toBe(want.densityMm);
      expect(o.params.pullCompMm).toBe(want.pullCompMm);
      expect(o.params.densityMm).not.toBe((get(before, id) as SatinObject).params.densityMm);
    }
    const fill = get(d, "f");
    expect(fill.kind === "fill" && fill.params.underlays?.length).toBeGreaterThan(0); // premium fills get cross underlay
    // the run and its params are not the setup's business
    expect(get(d, "r")).toEqual(get(before, "r"));
  });

  it("never overwrites a value the user edited by hand, and keeps it theirs afterwards", () => {
    const d = generated({ quality: "standard" });
    (get(d, "s-wide") as SatinObject).params.densityMm = 0.55; // typed in the settings panel
    const r = applySewingSetupTo(d, { quality: "premium", fabric: "knit", threadWeight: 40 });
    expect((get(d, "s-wide") as SatinObject).params.densityMm).toBe(0.55);
    expect(r.kept).toBe(1);
    // its other values did follow the setup
    const sew = resolveSewingSetup(d.sewing).engine;
    expect((get(d, "s-wide") as SatinObject).params.pullCompMm).toBe(satinParamsFor(6, sew).pullCompMm);
    // and the edited key is no longer tracked, so the next change leaves it alone without counting it again
    expect(get(d, "s-wide").autoParams).not.toHaveProperty("densityMm");
    const again = applySewingSetupTo(d, { quality: "standard", fabric: "suiting", threadWeight: 40 });
    expect((get(d, "s-wide") as SatinObject).params.densityMm).toBe(0.55);
    expect(again.kept).toBe(0);
  });

  it("goes back to exactly the original values when nothing was edited", () => {
    const d = generated({ quality: "standard", fabric: "suiting", threadWeight: 40 });
    const original = JSON.parse(JSON.stringify(d.objects)) as DesignObject[];
    applySewingSetupTo(d, { quality: "premium", fabric: "denim", threadWeight: 60 });
    expect(d.objects).not.toEqual(original);
    applySewingSetupTo(d, { quality: "standard", fabric: "suiting", threadWeight: 40 });
    expect(d.objects).toEqual(original);
  });

  it("never touches objects drawn by hand", () => {
    const d = sample(); // no marks at all
    const copy = JSON.parse(JSON.stringify(d)) as Design;
    const r = applySewingSetupTo(d, { quality: "premium", fabric: "knit", threadWeight: 60 });
    expect(r).toEqual({ updated: 0, kept: 0 });
    expect(d.objects).toEqual(copy.objects);
    expect(d.sewing).toEqual({ quality: "premium", fabric: "knit", threadWeight: 60 }); // the setting itself is still stored
  });

  it("tells a hand-edit from an array or object value too (underlays)", () => {
    const d = generated({ quality: "premium" });
    const f = get(d, "f");
    if (f.kind !== "fill") throw new Error("fill expected");
    f.params.underlays = [{ angleDeg: 10, spacingMm: 2, stitchLengthMm: 3, insetMm: 0.5 }];
    const r = applySewingSetupTo(d, { quality: "standard" });
    expect(r.kept).toBeGreaterThanOrEqual(1);
    expect(f.params.underlays).toEqual([{ angleDeg: 10, spacingMm: 2, stitchLengthMm: 3, insetMm: 0.5 }]);
  });

  it("reports nothing to do for a setup that does not change the numbers", () => {
    const d = generated({ quality: "premium", fabric: "suiting", threadWeight: 40 });
    expect(applySewingSetupTo(d, { quality: "premium", fabric: "suiting", threadWeight: 40 }).updated).toBe(0);
  });

  it("presetParamsFor gives nothing for runs and text", () => {
    const sew = resolveSewingSetup({}).engine;
    expect(presetParamsFor(get(sample(), "r"), sew)).toBeNull();
    expect(presetParamsFor(get(sample(), "f"), sew)).toMatchObject({ pullCompMm: expect.any(Number) });
  });
});

describe("recommended speed", () => {
  it("is slower on fragile and leather cloth and slower again with 60 wt thread", () => {
    const suiting = recommendedSpeed("suiting", 40);
    expect(suiting.minSpm).toBeLessThan(suiting.maxSpm);
    expect(recommendedSpeed("leather", 40).maxSpm).toBeLessThan(suiting.maxSpm);
    expect(recommendedSpeed("suiting", 60).maxSpm).toBeLessThan(suiting.maxSpm);
    expect(recommendedSpeed("woven", 40)).toEqual(suiting);
    for (const f of ["suiting", "shirting", "twill", "knit", "denim", "towel", "leather"] as const) {
      const s = recommendedSpeed(f, 40);
      expect(s.estimateSpm).toBeGreaterThanOrEqual(s.minSpm);
      expect(s.estimateSpm).toBeLessThanOrEqual(s.maxSpm);
      expect(s.estimateSpm % 50).toBe(0);
    }
  });
});
