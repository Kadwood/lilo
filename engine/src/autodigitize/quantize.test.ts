import { describe, expect, it } from "vitest";
import { getCatalogue } from "../threads";
import { prep } from "./prep";
import { NO_LABEL, quantize } from "./quantize";
import type { ImageDataLike } from "./types";

/** Left half red, right half blue, with a 1 px anti-aliased seam, on white. */
function twoColour(): ImageDataLike {
  const w = 60;
  const h = 30;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c: [number, number, number] = [255, 255, 255];
      if (x >= 10 && x < 30) c = [237, 23, 31];
      else if (x === 30) c = [120, 40, 100]; // blend pixel
      else if (x > 30 && x < 50) c = [10, 85, 163];
      if (y < 5 || y >= 25) c = [255, 255, 255];
      data.set([...c, 255], (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data };
}

describe("quantize", () => {
  const q = quantize(prep(twoColour(), true), 6, getCatalogue().threads);

  it("finds exactly the two real colours despite asking for six", () => {
    expect(q.palette.map((c) => c.thread.name).sort()).toEqual(["Blue", "Red"]);
    expect(q.palette.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 6);
  });

  it("labels the background as NO_LABEL and the seam as one of the two colours", () => {
    expect(q.labels[0]).toBe(NO_LABEL);
    expect(q.labels[10 * 60 + 30]).not.toBe(NO_LABEL);
    expect(q.image.data[(10 * 60 + 15) * 4 + 3]).toBe(255);
    expect(q.image.data[3]).toBe(0);
  });

  it("orders the palette by usage", () => {
    expect(q.palette[0].share).toBeGreaterThanOrEqual(q.palette[1].share);
  });

  it("is deterministic", () => {
    const q2 = quantize(prep(twoColour(), true), 6, getCatalogue().threads);
    expect(Array.from(q2.labels)).toEqual(Array.from(q.labels));
  });
});
