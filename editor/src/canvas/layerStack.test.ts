import { describe, expect, it } from "vitest";
import type { Design, Layer, PlanStitch, StitchPlan } from "@lilo/engine/light";
import { stackLayout } from "./layerStack";

const L = (id: string, kind: Layer["kind"]): Layer => ({ id, name: id, kind, visible: true, locked: false });
const stitch = (objectIndex: number): PlanStitch => ({ x: 0, y: 0, type: "stitch", threadIndex: 0, objectIndex });
const design = (layers: Layer[], objectLayers: string[]): Design =>
  ({ version: 2, unitsMm: 1, hoop: { name: "h", widthMm: 1, heightMm: 1 }, threads: [], layers, objects: objectLayers.map((layerId, i) => ({ id: `o${i}`, layerId })) }) as unknown as Design;
const plan = (objectIndexes: number[]): StitchPlan => ({ threads: [], warnings: [], stitches: objectIndexes.map(stitch) });

describe("stackLayout", () => {
  it("is one band with no splits when pictures are only at the bottom", () => {
    const d = design([L("p", "picture"), L("a", "stitch"), L("b", "stitch")], ["a", "b"]);
    expect(stackLayout(d, plan([0, 0, 1, 1]))).toEqual({ splits: [], pictureBand: { p: 0 } });
  });

  it("splits the stitches where a picture layer sits between two stitch layers", () => {
    const d = design([L("a", "stitch"), L("p", "picture"), L("b", "stitch")], ["a", "a", "b"]);
    expect(stackLayout(d, plan([0, 0, 1, 1, 2, 2]))).toEqual({ splits: [4], pictureBand: { p: 1 } });
  });

  it("puts a picture above everything in the last group", () => {
    const d = design([L("a", "stitch"), L("p", "picture")], ["a"]);
    expect(stackLayout(d, plan([0, 0]))).toEqual({ splits: [], pictureBand: { p: 1 } });
  });

  it("copes with a hidden layer that sews nothing and with no layers at all", () => {
    const d = design([L("a", "stitch"), L("p", "picture"), L("b", "stitch")], ["a", "b"]);
    expect(stackLayout(d, plan([0, 0])).splits).toEqual([2]); // the band above has no stitches
    expect(stackLayout({ ...d, layers: undefined }, plan([0]))).toEqual({ splits: [], pictureBand: {} });
    expect(stackLayout(null, null)).toEqual({ splits: [], pictureBand: {} });
  });
});
