import { describe, expect, it } from "vitest";
import { parseColor, parsePathData, parseSvgDocument, parseTransform, applyMatrix } from "./svg";

describe("path data", () => {
  it("parses absolute and relative lines, closing with Z", () => {
    const r = parsePathData("M10 10 L20 10 l0 10 H10 V10 z", 0.1);
    expect(r).toHaveLength(1);
    expect(r[0].closed).toBe(true);
    expect(r[0].pts).toEqual([
      [10, 10],
      [20, 10],
      [20, 20],
      [10, 20],
      [10, 10],
    ]);
  });

  it("splits sub-paths on every M and treats extra pairs after M as lines", () => {
    const r = parsePathData("M0 0 10 0 10 10 Z M20 20 30 20 30 30 Z", 0.1);
    expect(r).toHaveLength(2);
    expect(r[0].pts).toHaveLength(3);
  });

  it("flattens cubic curves within tolerance", () => {
    const r = parsePathData("M0 0 C0 10 10 10 10 0", 0.01);
    const pts = r[0].pts;
    expect(pts.length).toBeGreaterThan(8);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([10, 0]);
    // The curve peaks at y = 7.5.
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(7.5, 1);
  });

  it("flattens arcs: a half circle of radius 5 reaches 5 above the chord", () => {
    const r = parsePathData("M0 0 A5 5 0 0 1 10 0", 0.01);
    const ys = r[0].pts.map((p) => p[1]);
    expect(Math.max(...ys.map(Math.abs))).toBeCloseTo(5, 1);
    expect(r[0].pts[r[0].pts.length - 1][0]).toBeCloseTo(10, 6);
  });

  it("handles quadratic, smooth and glued arc flags", () => {
    expect(parsePathData("M0 0 Q5 10 10 0 T20 0", 0.1)[0].pts.length).toBeGreaterThan(4);
    expect(parsePathData("M0 0 C0 5 5 5 5 0 S10 -5 10 0", 0.1)[0].pts.length).toBeGreaterThan(4);
    const arc = parsePathData("M0 0a5 5 0 1010 0", 0.1); // flags "1" "0" glued to the x value 10
    expect(arc[0].pts[arc[0].pts.length - 1][0]).toBeCloseTo(10, 5);
  });
});

describe("transforms and colours", () => {
  it("composes translate/scale/rotate", () => {
    const m = parseTransform("translate(10 20) scale(2)");
    expect(applyMatrix(m, [1, 1])).toEqual([12, 22]);
    const r = applyMatrix(parseTransform("rotate(90)"), [1, 0]);
    expect(r[0]).toBeCloseTo(0, 9);
    expect(r[1]).toBeCloseTo(1, 9);
    expect(parseTransform(undefined)).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("normalises colours", () => {
    expect(parseColor("#f00")).toBe("#ff0000");
    expect(parseColor("RGB(0, 128, 255)")).toBe("#0080ff");
    expect(parseColor("navy")).toBe("#000080");
    expect(parseColor("none")).toBeNull();
    expect(parseColor("currentColor", "#123456")).toBe("#123456");
  });
});

describe("parseSvgDocument", () => {
  const svg = `<?xml version="1.0"?>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="200" height="100">
    <defs><linearGradient id="g"><stop offset="0" style="stop-color:#00ff00"/></linearGradient></defs>
    <!-- a comment -->
    <rect x="0" y="0" width="100" height="50" fill="#fff"/>
    <g transform="translate(10 5)" fill="red">
      <circle cx="10" cy="10" r="5"/>
      <path d="M0 0 L5 0 L5 5 Z" style="fill:blue;stroke:black;stroke-width:2"/>
      <rect x="30" y="0" width="4" height="4" fill="url(#g)" display="none"/>
    </g>
    <ellipse cx="80" cy="25" rx="10" ry="5" fill="url(#g)"/>
    <text>hi</text>
  </svg>`;
  const doc = parseSvgDocument(svg);

  it("reads the viewBox and shapes with inherited paint and transforms", () => {
    expect([doc.minX, doc.minY, doc.width, doc.height]).toEqual([0, 0, 100, 50]);
    const fills = doc.shapes.map((s) => s.fill);
    expect(fills).toEqual(["#ffffff", "#ff0000", "#0000ff", "#00ff00"]);
    const circle = doc.shapes[1];
    const xs = circle.rings[0].pts.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(15, 1); // translated by 10 -> 10 + 10 - 5
    expect(Math.max(...xs)).toBeCloseTo(25, 1);
  });

  it("keeps stroke info and reports unsupported elements", () => {
    const tri = doc.shapes[2];
    expect(tri.stroke).toBe("#000000");
    expect(tri.strokeWidth).toBe(2);
    expect(doc.unsupported).toContain("<text>");
  });

  it("rejects non-SVG input", () => {
    expect(() => parseSvgDocument("<html></html>")).toThrow(/Not an SVG/);
  });
});
