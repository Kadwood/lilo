import { describe, expect, it } from "vitest";
import { applyAffine, type Box } from "@lilo/engine/light";
import { boxFromDrag, handlePoint, HANDLE_NAMES, isCorner, moveTransform, oppositeHandle, resizeTransform, rotateHandlePoint, rotateTransform, snapAngle } from "./geometry";

const box: Box = { minX: 0, minY: 0, maxX: 20, maxY: 10 };

describe("selection handles", () => {
  it("sit on the corners and edge midpoints, clockwise from the top-left", () => {
    expect(HANDLE_NAMES.map((h) => handlePoint(box, h))).toEqual([[0, 0], [10, 0], [20, 0], [20, 5], [20, 10], [10, 10], [0, 10], [0, 5]]);
    expect(HANDLE_NAMES.filter(isCorner)).toEqual(["nw", "ne", "se", "sw"]);
    expect(oppositeHandle("nw")).toBe("se");
    expect(oppositeHandle("e")).toBe("w");
    expect(rotateHandlePoint(box, 3)).toEqual([10, -3]);
  });
});

describe("resize", () => {
  const scaled = (h: Parameters<typeof resizeTransform>[1], to: [number, number], lock: boolean) => {
    const m = resizeTransform(box, h, to, lock);
    const a = applyAffine(m, [box.minX, box.minY]);
    const b = applyAffine(m, [box.maxX, box.maxY]);
    return { x0: a[0], y0: a[1], x1: b[0], y1: b[1] };
  };

  it("a corner drag keeps the opposite corner fixed and the handle under the cursor", () => {
    expect(scaled("se", [40, 20], false)).toEqual({ x0: 0, y0: 0, x1: 40, y1: 20 });
    expect(scaled("nw", [-20, -10], false)).toEqual({ x0: -20, y0: -10, x1: 20, y1: 10 });
  });

  it("with the aspect lock a corner drag scales both ways by the larger ratio", () => {
    expect(scaled("se", [40, 12], true)).toEqual({ x0: 0, y0: 0, x1: 40, y1: 20 });
    expect(scaled("se", [22, 30], true)).toEqual({ x0: 0, y0: 0, x1: 60, y1: 30 });
  });

  it("an edge drag moves one side; locked, the other axis follows about the centre line", () => {
    expect(scaled("e", [30, 99], false)).toEqual({ x0: 0, y0: 0, x1: 30, y1: 10 });
    const l = scaled("e", [40, 0], true); // x doubles, y doubles about y = 5
    expect(l.x1).toBe(40);
    expect(l.y1 - l.y0).toBeCloseTo(20);
    expect((l.y0 + l.y1) / 2).toBeCloseTo(5);
    expect(scaled("s", [0, 20], false)).toEqual({ x0: 0, y0: 0, x1: 20, y1: 20 });
  });

  it("never flips or collapses the shape", () => {
    const r = scaled("se", [-30, -30], false);
    expect(r.x1).toBeGreaterThan(r.x0);
    expect(r.y1).toBeGreaterThan(r.y0);
  });
});

describe("rotate, move, snap", () => {
  it("rotates about the centre by the pointer's sweep; snapping rounds to 15 degrees", () => {
    const c: [number, number] = [0, 0];
    const free = rotateTransform(c, [10, 0], [0, 10]);
    expect(free.deg).toBeCloseTo(90);
    const snapped = rotateTransform(c, [10, 0], [10, 3], 15); // 16.7 deg -> 15
    expect(snapped.deg).toBeCloseTo(15);
    const p = applyAffine(snapped.m, [10, 0]);
    expect(Math.atan2(p[1], p[0])).toBeCloseTo((15 * Math.PI) / 180);
  });

  it("move translates, and Ctrl locks to the dominant axis", () => {
    expect(applyAffine(moveTransform([0, 0], [5, 2], false), [1, 1])).toEqual([6, 3]);
    expect(applyAffine(moveTransform([0, 0], [5, 2], true), [1, 1])).toEqual([6, 1]);
    expect(applyAffine(moveTransform([0, 0], [1, -5], true), [1, 1])).toEqual([1, -4]);
  });

  it("snapAngle keeps the length and rounds the direction", () => {
    const p = snapAngle([0, 0], [10, 1], 15);
    expect(p[0]).toBeCloseTo(Math.hypot(10, 1) * Math.cos(0));
    expect(Math.abs(p[1])).toBeLessThan(1e-9);
    const q = snapAngle([0, 0], [10, 10], 15);
    expect(Math.atan2(q[1], q[0])).toBeCloseTo(Math.PI / 4);
  });

  it("boxFromDrag orders the corners and squares up from the first one", () => {
    expect(boxFromDrag([10, 10], [0, 4], false)).toEqual({ minX: 0, minY: 4, maxX: 10, maxY: 10 });
    expect(boxFromDrag([10, 10], [0, 4], true)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });
});
