import { describe, expect, it } from "vitest";
import { downscale, prep } from "./prep";
import type { ImageDataLike } from "./types";

function solid(w: number, h: number, c: [number, number, number, number]): ImageDataLike {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(c, i * 4);
  return { width: w, height: h, data };
}
const setPx = (img: ImageDataLike, x: number, y: number, c: [number, number, number, number]) => img.data.set(c, (y * img.width + x) * 4);

describe("downscale", () => {
  it("leaves small images alone and shrinks big ones to the max side", () => {
    const small = solid(100, 50, [1, 2, 3, 255]);
    expect(downscale(small, 1200)).toBe(small);
    const big = solid(2400, 1200, [10, 20, 30, 255]);
    const out = downscale(big, 1200);
    expect([out.width, out.height]).toEqual([1200, 600]);
    expect(Array.from(out.data.subarray(0, 4))).toEqual([10, 20, 30, 255]);
  });

  it("averages colours when shrinking", () => {
    const img = solid(4, 2, [0, 0, 0, 255]);
    for (let y = 0; y < 2; y++) for (let x = 2; x < 4; x++) setPx(img, x, y, [200, 100, 0, 255]);
    const out = downscale(img, 2);
    expect(Array.from(out.data.subarray(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(out.data.subarray(4, 8))).toEqual([200, 100, 0, 255]);
  });
});

describe("prep", () => {
  it("keys out a solid corner colour, including enclosed counters", () => {
    const img = solid(40, 40, [250, 250, 250, 255]);
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) setPx(img, x, y, [20, 20, 120, 255]);
    for (let y = 18; y < 22; y++) for (let x = 18; x < 22; x++) setPx(img, x, y, [250, 250, 250, 255]); // counter
    const p = prep(img, true);
    expect(p.background).toEqual([250, 250, 250]);
    expect(p.fg[0]).toBe(0);
    expect(p.fg[20 * 40 + 20]).toBe(0); // the counter is fabric too
    expect(p.fg[12 * 40 + 12]).toBe(1);
  });

  it("treats transparent pixels as background", () => {
    const img = solid(20, 20, [0, 0, 0, 0]);
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) setPx(img, x, y, [200, 0, 0, 255]);
    const p = prep(img, true);
    expect(p.hadTransparency).toBe(true);
    expect(p.background).toBeNull();
    expect(p.fg[0]).toBe(0);
    expect(p.fg[10 * 20 + 10]).toBe(1);
  });

  it("keeps everything when removal is off, and does not key a busy border", () => {
    const img = solid(20, 20, [250, 250, 250, 255]);
    expect(prep(img, false).fg.every((v) => v === 1)).toBe(true);
    // A photo-like border: four different corner colours -> no background.
    const busy = solid(20, 20, [100, 100, 100, 255]);
    setPx(busy, 0, 0, [255, 0, 0, 255]);
    setPx(busy, 19, 0, [0, 255, 0, 255]);
    setPx(busy, 0, 19, [0, 0, 255, 255]);
    setPx(busy, 19, 19, [255, 255, 0, 255]);
    expect(prep(busy, true).background).toBeNull();
  });

  it("rejects an all-background image", () => {
    expect(() => prep(solid(10, 10, [255, 255, 255, 255]), true)).toThrow(/No artwork/);
  });
});
