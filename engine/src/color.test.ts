import { describe, expect, it } from "vitest";
import { deltaE2000, deltaE76, hexToRgb, rgbToHex, rgbToLab } from "./color";

describe("colour maths", () => {
  it("converts well-known sRGB colours to Lab (D65)", () => {
    const [Lw, aw, bw] = rgbToLab(255, 255, 255);
    expect(Lw).toBeCloseTo(100, 1);
    expect(Math.abs(aw)).toBeLessThan(0.01);
    expect(Math.abs(bw)).toBeLessThan(0.01);
    expect(rgbToLab(0, 0, 0)[0]).toBeCloseTo(0, 5);
    const [L, a, b] = rgbToLab(255, 0, 0);
    expect(L).toBeCloseTo(53.24, 1);
    expect(a).toBeCloseTo(80.09, 1);
    expect(b).toBeCloseTo(67.2, 1);
  });

  it("matches the Sharma/Wu/Dalal CIEDE2000 reference pairs", () => {
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
    expect(deltaE2000([50, 3.1571, -77.2803], [50, 0, -82.7485])).toBeCloseTo(2.8615, 3);
    expect(deltaE2000([50, 2.5, 0], [50, 0, -2.5])).toBeCloseTo(4.3065, 3);
    expect(deltaE2000([60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387])).toBeCloseTo(1.2644, 3);
  });

  it("is zero for identical colours and symmetric", () => {
    const a = rgbToLab(10, 120, 200);
    const b = rgbToLab(200, 30, 90);
    expect(deltaE2000(a, a)).toBe(0);
    expect(deltaE2000(a, b)).toBeCloseTo(deltaE2000(b, a), 9);
    expect(deltaE76(a, a)).toBe(0);
  });

  it("round-trips hex", () => {
    expect(hexToRgb("#0a55a3")).toEqual([10, 85, 163]);
    expect(hexToRgb("fff")).toEqual([255, 255, 255]);
    expect(rgbToHex(10, 85, 163)).toBe("#0a55a3");
    expect(() => hexToRgb("zzz")).toThrow();
  });
});
