import { describe, expect, it } from "vitest";
import { cutHole, knifeFill, knifeObject, knifeRun, knifeSatin, runShapeOp } from "./shapeops";
import { makeFill, makeRun, makeSatin, objectBox, rectNodes, type FillObject, type Pt } from "./model";

const area = (o: FillObject) => {
  const r = o.geometry.shell;
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i];
    const [x1, y1] = r[(i + 1) % r.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a / 2) - o.geometry.holes.reduce((s, h) => s + Math.abs(h.reduce((q, p, i) => q + p[0] * h[(i + 1) % h.length][1] - h[(i + 1) % h.length][0] * p[1], 0) / 2), 0);
};

/** Fresh ids o2, o3... (the test objects are o1). */
const ids = () => {
  let n = 1;
  return () => `o${++n}`;
};

describe("knife", () => {
  it("splits a fill into two pieces that together keep (almost) all the area", () => {
    const o = makeFill("o1", "Box", "t", rectNodes(0, 0, 20, 10));
    const out = knifeFill(o, [10, -2], [10, 12], ids());
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("o1");
    expect(out[1].id).not.toBe("o1");
    expect(out[0].params).toEqual(o.params);
    expect(area(out[0]) + area(out[1])).toBeGreaterThan(199);
    expect(area(out[0]) + area(out[1])).toBeLessThan(200.01);
    const boxes = out.map((p) => objectBox(p)!);
    expect(Math.max(boxes[0].maxX, boxes[1].maxX)).toBeCloseTo(20);
    expect(Math.min(boxes[0].minX, boxes[1].minX)).toBeCloseTo(0);
  });

  it("leaves a fill alone when the line misses it or stops short", () => {
    const o = makeFill("o1", "Box", "t", rectNodes(0, 0, 20, 10));
    expect(knifeFill(o, [30, 0], [30, 10], ids())).toEqual([o]);
    expect(knifeFill(o, [10, 3], [10, 8], ids())).toEqual([o]); // never leaves the shape
  });

  it("splits a run at each crossing", () => {
    const o = makeRun("o1", "L", "t", [{ p: [0, 0] }, { p: [20, 0] }], false);
    const out = knifeRun(o, [10, -1], [10, 1], ids());
    expect(out).toHaveLength(2);
    expect(out[0].geometry.path.at(-1)).toEqual([10, 0]);
    expect(out[1].geometry.path[0]).toEqual([10, 0]);
  });

  it("splits a closed run into arcs", () => {
    const o = makeRun("o1", "Ring", "t", rectNodes(0, 0, 20, 10), true);
    const out = knifeRun(o, [10, -2], [10, 12], ids());
    expect(out).toHaveLength(2);
    expect(out.every((p) => !p.geometry.closed && p.geometry.path.length >= 3)).toBe(true);
  });

  it("splits a satin column across its length", () => {
    const strip: Pt[] = [[0, 0], [0, 2], [10, 0], [10, 2], [20, 0], [20, 2]];
    const s = makeSatin("s", "S", "t", strip);
    const out = knifeSatin(s, [5, -1], [5, 3], ids());
    expect(out).toHaveLength(2);
    expect(out[0].geometry.strip.at(-2)![0]).toBeCloseTo(5);
    expect(out[1].geometry.strip[0][0]).toBeCloseTo(5);
    expect(knifeObject(s, [50, -1], [50, 3], ids())).toEqual([s]);
  });
});

describe("cut hole", () => {
  it("turns a closed shape drawn inside a fill into a hole", () => {
    const o = makeFill("o1", "Box", "t", rectNodes(0, 0, 20, 20));
    const [out, ...rest] = cutHole(o, [[5, 5], [10, 5], [10, 10], [5, 10]], ids());
    expect(rest).toHaveLength(0);
    expect(out.geometry.holes).toHaveLength(1);
    expect(area(out)).toBeCloseTo(375, 0);
  });

  it("a hole that overlaps the edge bites a notch instead", () => {
    const o = makeFill("o1", "Box", "t", rectNodes(0, 0, 20, 20));
    const [out] = cutHole(o, [[15, 15], [25, 15], [25, 25], [15, 25]], ids());
    expect(out.geometry.holes).toHaveLength(0);
    expect(area(out)).toBeCloseTo(375, 0);
  });

  it("a hole straight across splits the fill in two", () => {
    const o = makeFill("o1", "Box", "t", rectNodes(0, 0, 20, 20));
    const out = cutHole(o, [[8, -1], [12, -1], [12, 21], [8, 21]], ids());
    expect(out).toHaveLength(2);
  });

  it("runShapeOp mints ids past the one it was given", () => {
    const o = makeFill("o1", "Box", "t", rectNodes(0, 0, 20, 10));
    const out = runShapeOp({ op: "knife", object: o, a: [10, -2], b: [10, 12], firstId: 7 });
    expect(out.map((p) => p.id)).toEqual(["o1", "o7"]);
  });
});
