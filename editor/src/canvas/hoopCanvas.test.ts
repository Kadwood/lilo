import { describe, expect, it } from "vitest";
import { ASSUMED_PX_PER_MM, CARD_WIDTH_MM, cardWidthPx, pxPerInch, resolveScale, scaleFromCardWidth, shouldAskCalibration } from "./actualSize";
import { dashClosed, ellipsePoints, roundRectPoints, sewingOutline } from "./hoopArt";
import { formatTick, labelStepMm, rulerTicks, subdivisions } from "./rulerTicks";

describe("ruler ticks", () => {
  it("labels the origin 0 and steps in round numbers that stay 56 px apart", () => {
    const ticks = rulerTicks(300, 6, 600, "mm"); // 6 px per mm, design 0 at x=300
    const labelled = ticks.filter((t) => t.label !== undefined);
    expect(labelled.find((t) => t.mm === 0)?.px).toBe(300);
    expect(labelled.find((t) => t.mm === 0)?.label).toBe("0");
    const step = labelStepMm(6, "mm");
    expect(step).toBe(10); // 10 mm = 60 px >= 56
    for (let i = 1; i < labelled.length; i++) expect(labelled[i].px - labelled[i - 1].px).toBeGreaterThanOrEqual(56);
    expect(labelled.every((t) => t.px >= -1 && t.px <= 601)).toBe(true);
  });

  it("follows the zoom: zoomed in shows millimetres, zoomed out shows tens", () => {
    expect(labelStepMm(40, "mm")).toBe(2);
    expect(labelStepMm(0.5, "mm")).toBe(200);
    expect(subdivisions(10, 6, "mm")).toBe(10); // 10 mm at 6 px: minor 1 mm = 6 px
    expect(subdivisions(100, 6, "mm")).toBe(10);
    expect(subdivisions(5, 14, "mm")).toBe(5);
  });

  it("goes in inches with fractional steps", () => {
    expect(labelStepMm(40, "in") / 25.4).toBe(1 / 16);
    const t = rulerTicks(100, 40, 400, "in").filter((x) => x.label);
    expect(t.map((x) => x.label)).toContain("0");
    expect(formatTick(25.4, "in")).toBe("1");
    expect(formatTick(12.7, "in")).toBe("0.5");
    expect(formatTick(-0, "mm")).toBe("0");
  });

  it("gives nothing for a ruler with no length or zoom", () => {
    expect(rulerTicks(0, 0, 100, "mm")).toEqual([]);
    expect(rulerTicks(0, 5, 0, "mm")).toEqual([]);
  });

  it("marks major ticks at multiples of the label step, negative side included", () => {
    const ticks = rulerTicks(300, 6, 600, "mm");
    for (const t of ticks.filter((x) => x.major)) expect(Math.abs(t.mm % 10)).toBeLessThan(1e-9);
    expect(ticks.some((t) => t.mm < 0 && t.major)).toBe(true);
  });
});

describe("actual size", () => {
  it("prefers a calibration, then the display, then 96 dpi", () => {
    expect(resolveScale(5, { pxPerMm: 4 })).toEqual({ pxPerMm: 5, source: "calibrated" });
    expect(resolveScale(null, { pxPerMm: 5.01 })).toEqual({ pxPerMm: 5.01, source: "display" });
    expect(resolveScale(null, { pxPerMm: null }).source).toBe("assumed");
    expect(resolveScale(null, null).pxPerMm).toBe(ASSUMED_PX_PER_MM);
    // nonsense is ignored rather than trusted
    expect(resolveScale(0.2, { pxPerMm: 900 }).source).toBe("assumed");
    expect(ASSUMED_PX_PER_MM).toBeCloseTo(3.7795, 3);
  });

  it("turns a card matched on screen into a scale and back", () => {
    const px = cardWidthPx(5);
    expect(px).toBeCloseTo(CARD_WIDTH_MM * 5, 9);
    expect(scaleFromCardWidth(px)).toBeCloseTo(5, 9);
    expect(pxPerInch(5)).toBe(127);
  });

  it("asks for calibration once, and only when the scale is a guess", () => {
    expect(shouldAskCalibration({ pxPerMm: 3.78, source: "assumed" }, false)).toBe(true);
    expect(shouldAskCalibration({ pxPerMm: 3.78, source: "assumed" }, true)).toBe(false);
    expect(shouldAskCalibration({ pxPerMm: 5, source: "display" }, false)).toBe(false);
    expect(shouldAskCalibration({ pxPerMm: 5, source: "calibrated" }, false)).toBe(false);
  });
});

describe("hoop drawing geometry", () => {
  it("outlines a rounded rectangle inside its half sizes and a sharp one with four corners", () => {
    expect(roundRectPoints(10, 5, 0)).toHaveLength(4);
    const pts = roundRectPoints(65, 90, 6);
    expect(Math.max(...pts.map((p) => Math.abs(p[0])))).toBeCloseTo(65, 9);
    expect(Math.max(...pts.map((p) => Math.abs(p[1])))).toBeCloseTo(90, 9);
    // the corner is cut: no point at (65, 90)
    expect(pts.some((p) => p[0] > 64.9 && p[1] > 89.9)).toBe(false);
  });

  it("insets the safe margin from every side, ellipses included", () => {
    const rect = sewingOutline({ name: "a", widthMm: 130, heightMm: 180, shape: "rect", cornerRadiusMm: 6 }, 5);
    expect(Math.max(...rect.map((p) => p[0]))).toBeCloseTo(60, 9);
    expect(Math.max(...rect.map((p) => p[1]))).toBeCloseTo(85, 9);
    const oval = sewingOutline({ name: "o", widthMm: 100, heightMm: 60, shape: "oval" }, 5);
    expect(Math.max(...oval.map((p) => p[0]))).toBeCloseTo(45, 6);
    expect(ellipsePoints(10, 5, 8)).toHaveLength(8);
  });

  it("dashes a closed outline: alternating line and move, total drawn about half", () => {
    const calls: string[] = [];
    let drawn = 0;
    let last: [number, number] = [0, 0];
    const g = {
      moveTo(x: number, y: number) {
        calls.push("m");
        last = [x, y];
        return g;
      },
      lineTo(x: number, y: number) {
        calls.push("l");
        drawn += Math.hypot(x - last[0], y - last[1]);
        last = [x, y];
        return g;
      },
    };
    const sq: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
    dashClosed(g as never, sq, 5, 5);
    expect(calls.filter((c) => c === "l").length).toBeGreaterThan(30);
    expect(drawn).toBeGreaterThan(190);
    expect(drawn).toBeLessThan(210); // 400 around, half on
  });
});
