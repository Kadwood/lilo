import { describe, expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM, classifyWheel, fitView, panBy, screenToWorld, visibleRect, wheelZoomFactor, zoomAt } from "./viewport";

describe("viewport", () => {
  it("zooms about the cursor: the world point under it does not move", () => {
    const v = { x: 100, y: 50, zoom: 4 };
    const before = screenToWorld(v, 300, 200);
    const z = zoomAt(v, 300, 200, 2);
    expect(z.zoom).toBe(8);
    const after = screenToWorld(z, 300, 200);
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
  });

  it("clamps zoom", () => {
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, 0, 0, 1e9).zoom).toBe(MAX_ZOOM);
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, 0, 0, 1e-9).zoom).toBe(MIN_ZOOM);
  });

  it("pans", () => {
    expect(panBy({ x: 1, y: 2, zoom: 3 }, 10, -5)).toEqual({ x: 11, y: -3, zoom: 3 });
  });

  it("fits a rectangle centred with margin", () => {
    const v = fitView(1000, 500, { minX: -30, minY: -20, maxX: 30, maxY: 20 }, 0.1);
    // 60 x 40 mm with 10% margin each side: limited by height (500 / 48)
    expect(v.zoom).toBeCloseTo(500 / 48, 6);
    expect(screenToWorld(v, 500, 250)[0]).toBeCloseTo(0, 6);
    expect(screenToWorld(v, 500, 250)[1]).toBeCloseTo(0, 6);
    const r = visibleRect(v, 1000, 500);
    expect(r.minY).toBeLessThan(-20);
    expect(r.maxY).toBeGreaterThan(20);
  });

  it("tells pinch, two-finger scroll and mouse wheel apart", () => {
    expect(classifyWheel({ ctrlKey: true, deltaX: 0, deltaY: 3.5, deltaMode: 0 })).toBe("zoom");
    expect(classifyWheel({ ctrlKey: false, deltaX: 4, deltaY: 10, deltaMode: 0 })).toBe("pan");
    expect(classifyWheel({ ctrlKey: false, deltaX: 0, deltaY: 7.25, deltaMode: 0 })).toBe("pan");
    expect(classifyWheel({ ctrlKey: false, deltaX: 0, deltaY: 100, deltaMode: 0 })).toBe("zoom");
    expect(classifyWheel({ ctrlKey: false, deltaX: 0, deltaY: 3, deltaMode: 1 })).toBe("zoom");
  });

  it("zooms in on negative deltas, out on positive", () => {
    expect(wheelZoomFactor({ ctrlKey: false, deltaY: -100, deltaMode: 0 })).toBeGreaterThan(1);
    expect(wheelZoomFactor({ ctrlKey: false, deltaY: 100, deltaMode: 0 })).toBeLessThan(1);
    expect(wheelZoomFactor({ ctrlKey: true, deltaY: -5, deltaMode: 0 })).toBeGreaterThan(1);
  });
});
