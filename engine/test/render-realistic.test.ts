import { describe, expect, it } from "vitest";
import type { StitchPlan } from "../src/stitch";
import { planBounds, renderRealistic, renderRealisticPng } from "./render-realistic";

const plan: StitchPlan = {
  threads: [{ id: "t", brand: "T", code: "1", name: "Red", hex: "#c0152a" }],
  stitches: [
    { x: 0, y: 0, type: "jump", threadIndex: 0, objectIndex: 0 },
    { x: 0, y: 0, type: "stitch", threadIndex: 0, objectIndex: 0 },
    { x: 4, y: 0, type: "stitch", threadIndex: 0, objectIndex: 0 },
    { x: 4, y: 2, type: "stitch", threadIndex: 0, objectIndex: 0 },
  ],
  warnings: [],
};

const px = (im: ReturnType<typeof renderRealistic>, xMm: number, yMm: number): [number, number, number] => {
  const x = Math.round((xMm - im.originMm[0]) * im.pxPerMm);
  const y = Math.round((yMm - im.originMm[1]) * im.pxPerMm);
  const i = (y * im.width + x) * 4;
  return [im.rgba[i], im.rgba[i + 1], im.rgba[i + 2]];
};

describe("realistic render", () => {
  it("sizes the image from the design bounds plus padding", () => {
    expect(planBounds(plan)).toEqual({ x0: 0, y0: 0, x1: 4, y1: 2 });
    const im = renderRealistic(plan, { pxPerMm: 10, pad: 1 });
    expect(im.width).toBe(60);
    expect(im.height).toBe(40);
    expect(im.rgba).toHaveLength(60 * 40 * 4);
  });

  it("draws thread of the stitch colour, about the stated width, over a lighter fabric", () => {
    const im = renderRealistic(plan, { pxPerMm: 40, pad: 1, threadWidthMm: 0.4 });
    const onThread = px(im, 2, 0);
    const offThread = px(im, 2, 1);
    expect(onThread[0]).toBeGreaterThan(onThread[1] * 2); // reddish
    expect(offThread[0]).toBeGreaterThan(150); // fabric
    // thread edge: 0.15 mm off the centre is still thread, 0.4 mm off is fabric
    expect(px(im, 2, 0.15)[1]).toBeLessThan(120);
    expect(px(im, 2, 0.45)[1]).toBeGreaterThan(120);
  });

  it("shades across the thread (cylinder) so a single stitch is not flat", () => {
    const im = renderRealistic(plan, { pxPerMm: 60, pad: 1 });
    const centre = px(im, 2, 0)[0];
    const edge = px(im, 2, 0.17)[0];
    expect(centre).not.toBe(edge);
  });

  it("renders a crop at a higher scale and encodes a PNG", () => {
    const im = renderRealistic(plan, { pxPerMm: 80, viewport: { x0: 3, y0: -1, x1: 5, y1: 1 } });
    expect([im.width, im.height]).toEqual([160, 160]);
    const png = renderRealisticPng(plan, { pxPerMm: 10 });
    expect(Array.from(png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
