import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAP_OPTIONS,
  applyMapGroup,
  detachMapGroup,
  autoRedwork,
  compose,
  deleteNode,
  duplicateObjects,
  editRings,
  ellipseNodes,
  fillToOutline,
  flattenNodes,
  flipH,
  hitObject,
  insertNodeNear,
  makeFill,
  makeIdGen,
  makeRun,
  makeSatin,
  mapToPath,
  objectBox,
  outlineToFill,
  pathStops,
  rectNodes,
  resizeAbout,
  rotation,
  scaling,
  smoothStroke,
  transformObject,
  translation,
  unionBox,
  withRingNodes,
  type DesignObject,
  type FillObject,
  type PathNode,
  type Pt,
  type RunObject,
} from "./index";
import { emptyDesign } from "./index";

const sq = (): FillObject => makeFill("o1", "Square", "t", rectNodes(0, 0, 10, 10), [[[3, 3], [6, 3], [6, 6], [3, 6]]]);
const line = (): RunObject => makeRun("o2", "Line", "t", [{ p: [0, 0] }, { p: [20, 0] }], false);

describe("nodes", () => {
  it("corner nodes flatten to themselves; curve nodes add points along a smooth curve", () => {
    expect(flattenNodes(rectNodes(0, 0, 4, 4), true)).toEqual([[0, 0], [4, 0], [4, 4], [0, 4]]);
    const circle = flattenNodes(ellipseNodes(0, 0, 10, 10), true);
    expect(circle.length).toBeGreaterThan(40);
    for (const [x, y] of circle) expect(Math.abs(Math.hypot(x, y) - 10)).toBeLessThan(0.25);
  });

  it("an open curve passes through its nodes and keeps its end points", () => {
    const nodes: PathNode[] = [{ p: [0, 0], curve: true }, { p: [10, 5], curve: true }, { p: [20, 0], curve: true }];
    const pts = flattenNodes(nodes, false);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([20, 0]);
    expect(pts.some(([x, y]) => x === 10 && y === 5)).toBe(true);
  });

  it("inserts a node on the nearest segment and refuses to delete below a valid shape", () => {
    const n = rectNodes(0, 0, 10, 10);
    const r = insertNodeNear(n, true, [5, -1]);
    expect(r.nodes).toHaveLength(5);
    expect(r.nodes[r.index].p).toEqual([5, 0]);
    expect(deleteNode(rectNodes(0, 0, 1, 1), true, 0)).toHaveLength(3);
    expect(deleteNode(deleteNode(rectNodes(0, 0, 1, 1), true, 0), true, 0)).toHaveLength(3);
  });

  it("smoothStroke drops jitter from a freehand line", () => {
    const pts: Pt[] = Array.from({ length: 100 }, (_, i) => [i * 0.2, Math.sin(i) * 0.01] as Pt);
    expect(smoothStroke(pts).length).toBeLessThan(5);
  });
});

describe("transform", () => {
  it("moves, scales, rotates and flips every point and the node list", () => {
    const o = sq();
    const moved = transformObject(o, translation(5, 5));
    expect(objectBox(moved)).toEqual({ minX: 5, minY: 5, maxX: 15, maxY: 15 });
    expect(moved.geometry.shellNodes![0].p).toEqual([5, 5]);
    expect(moved.geometry.holes[0][0]).toEqual([8, 8]);
    const big = transformObject(o, scaling(2, 3, 0, 0));
    expect(objectBox(big)).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 30 });
    const rot = transformObject(o, rotation(Math.PI / 2, 5, 5));
    const b = objectBox(rot)!;
    expect(b.minX).toBeCloseTo(0);
    expect(b.maxX).toBeCloseTo(10);
    const flipped = transformObject(line(), flipH(10));
    expect(flipped.geometry.path[0][0]).toBeCloseTo(20);
  });

  it("turns the stitch angle with the shape and mirrors it on a flip", () => {
    const o = { ...sq(), params: { ...sq().params, angleDeg: 30 } };
    expect(transformObject(o, rotation(Math.PI / 6)).params.angleDeg).toBeCloseTo(60);
    expect(transformObject(o, flipH(0)).params.angleDeg).toBeCloseTo(150);
  });

  it("resizeAbout scales a box to w x h about its top-left", () => {
    const box = { minX: 2, minY: 2, maxX: 12, maxY: 7 };
    const m = resizeAbout(box, 20, 20);
    const o = transformObject(makeFill("a", "a", "t", rectNodes(2, 2, 12, 7)), m);
    expect(objectBox(o)).toEqual({ minX: 2, minY: 2, maxX: 22, maxY: 22 });
  });

  it("composes transforms in order", () => {
    const m = compose(translation(1, 0), scaling(2, 2));
    const o = transformObject(line(), m);
    expect(o.geometry.path[0]).toEqual([2, 0]);
  });

  it("hit-tests filled areas (not holes), thin runs within a tolerance, and honours hidden", () => {
    expect(hitObject(sq(), [1, 1], 0.5)).toBe(true);
    expect(hitObject(sq(), [4, 4], 0.5)).toBe(false); // inside the hole
    expect(hitObject(sq(), [20, 20], 0.5)).toBe(false);
    expect(hitObject(line(), [10, 0.4], 0.5)).toBe(true);
    expect(hitObject(line(), [10, 3], 0.5)).toBe(false);
    expect(hitObject({ ...sq(), visible: false }, [1, 1], 0.5)).toBe(false);
  });

  it("unionBox covers all boxes", () => {
    expect(unionBox([objectBox(sq()), objectBox(line()), null])).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 10 });
  });
});

describe("reshape", () => {
  it("edits ring nodes and re-flattens the outline", () => {
    const o = sq();
    const rings = editRings(o);
    expect(rings).toHaveLength(2); // shell + hole
    const nodes = rings[0].nodes.map((n, i) => (i === 2 ? { ...n, p: [14, 14] as Pt } : n));
    const next = withRingNodes(o, 0, nodes) as FillObject;
    expect(next.geometry.shell[2]).toEqual([14, 14]);
    const nodes2 = rings[1].nodes.map((n) => ({ ...n, p: [n.p[0] + 1, n.p[1]] as Pt }));
    expect((withRingNodes(o, 1, nodes2) as FillObject).geometry.holes[0][0]).toEqual([4, 3]);
  });

  it("makes polyline-only shapes (auto-digitized) editable as corner nodes", () => {
    const o: FillObject = { ...sq(), geometry: { shell: [[0, 0], [5, 0], [5, 5]], holes: [] } };
    expect(editRings(o)[0].nodes).toHaveLength(3);
  });

  it("satin strips can move points but not add or remove them", () => {
    const s = makeSatin("s", "S", "t", [[0, 0], [0, 2], [3, 0], [3, 2]]);
    const [ring] = editRings(s);
    expect(ring.structural).toBe(false);
    const moved = withRingNodes(s, 0, ring.nodes.map((n, i) => (i === 0 ? { p: [0, -1] as Pt } : n)));
    expect(moved.kind === "satin" && moved.geometry.strip[0]).toEqual([0, -1]);
  });
});

describe("outline <-> fill, redwork, duplicate", () => {
  it("converts a fill to a closed outline and back", () => {
    const run = fillToOutline(sq());
    expect(run.kind).toBe("run");
    expect(run.geometry.closed).toBe(true);
    const fill = outlineToFill(run)!;
    expect(fill.kind).toBe("fill");
    expect(fill.geometry.shell).toHaveLength(4);
    expect(outlineToFill(line())).toBeNull();
  });

  it("auto redwork outlines every edge, hole included, chaining nearest-first", () => {
    const d = emptyDesign();
    const id = makeIdGen({ ...d, objects: [sq()] });
    const runs = autoRedwork([sq()], "t", id);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.geometry.closed)).toBe(true);
    expect(new Set(runs.map((r) => r.id)).size).toBe(2);
    // the second outline starts at the point nearest where the first ended
    const end = runs[0].geometry.path[0];
    const start = runs[1].geometry.path[0];
    const other = runs[1].geometry.path.map((p) => Math.hypot(p[0] - end[0], p[1] - end[1]));
    expect(Math.hypot(start[0] - end[0], start[1] - end[1])).toBeCloseTo(Math.min(...other));
  });

  it("duplicates with new ids, offset", () => {
    const d = emptyDesign();
    d.objects = [sq()];
    const copies = duplicateObjects(d.objects, makeIdGen(d));
    expect(copies[0].id).not.toBe("o1");
    expect(objectBox(copies[0])!.minX).toBe(3);
  });
});

describe("map to path", () => {
  const path: Pt[] = [[0, 0], [30, 0]];
  it("count mode spreads copies evenly including both ends", () => {
    const stops = pathStops(path, false, { ...DEFAULT_MAP_OPTIONS, count: 4 });
    expect(stops.map((s) => s.p[0])).toEqual([0, 10, 20, 30]);
  });
  it("spacing mode fills the path at the given pitch", () => {
    const stops = pathStops(path, false, { ...DEFAULT_MAP_OPTIONS, mode: "spacing", spacingMm: 7 });
    expect(stops.map((s) => s.p[0])).toEqual([0, 7, 14, 21, 28]);
  });
  it("reverse starts from the far end", () => {
    const stops = pathStops(path, false, { ...DEFAULT_MAP_OPTIONS, count: 2, reverse: true });
    expect(stops.map((s) => s.p[0])).toEqual([30, 0]);
  });
  it("copies the source onto each stop, rotating to follow a bend, as independent objects", () => {
    const d = emptyDesign();
    d.objects = [sq()];
    const bent: Pt[] = [[0, 0], [20, 0], [20, 20]];
    const out = mapToPath(d.objects, bent, false, { ...DEFAULT_MAP_OPTIONS, count: 3 }, makeIdGen(d));
    expect(out).toHaveLength(3);
    expect(new Set(out.map((o) => o.id)).size).toBe(3);
    const centre = (o: DesignObject) => {
      const b = objectBox(o)!;
      return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
    };
    expect(centre(out[0])).toEqual([0, 0]);
    expect(centre(out[2])[0]).toBeCloseTo(20);
    expect(centre(out[2])[1]).toBeCloseTo(20);
    // a square rotated by 90 degrees is still 10 x 10, but its start marker moved: check no-rotate keeps shell identical in shape
    const flat = mapToPath(d.objects, bent, false, { ...DEFAULT_MAP_OPTIONS, count: 3, rotate: false }, makeIdGen(d));
    const w = (o: DesignObject) => objectBox(o)!.maxX - objectBox(o)!.minX;
    expect(w(flat[1])).toBeCloseTo(10);
  });
});

describe("live map groups", () => {
  const setup = () => {
    const d = emptyDesign();
    d.threads = [];
    d.objects = [sq(), line()];
    return d;
  };
  const group = (count: number) => ({ sources: [sq()], path: [[0, 0], [30, 0]] as Pt[], closed: false, options: { ...DEFAULT_MAP_OPTIONS, count } });

  it("replaces the source (and path) with tagged copies, in place, and can be re-run with a new count", () => {
    const d = setup();
    const id = makeIdGen(d);
    const ids = applyMapGroup(d, "g1", group(3), id, ["o1", "o2"]);
    expect(ids).toHaveLength(3);
    expect(d.objects).toHaveLength(3);
    expect(d.objects.every((o) => o.mapGroup === "g1")).toBe(true);
    applyMapGroup(d, "g1", group(5), id);
    expect(d.objects).toHaveLength(5);
    expect(d.mapGroups?.g1.options.count).toBe(5);
  });

  it("detach leaves ordinary objects and forgets the group", () => {
    const d = setup();
    applyMapGroup(d, "g1", group(2), makeIdGen(d), ["o1"]);
    detachMapGroup(d, "g1");
    expect(d.objects.some((o) => o.mapGroup)).toBe(false);
    expect(d.mapGroups).toBeUndefined();
    expect(d.objects).toHaveLength(3); // 2 copies + the untouched line
  });

  it("a duplicate of a mapped copy is not part of the group", () => {
    const d = setup();
    applyMapGroup(d, "g1", group(2), makeIdGen(d), ["o1"]);
    const [copy] = duplicateObjects([d.objects[0]], makeIdGen(d));
    expect(copy.mapGroup).toBeUndefined();
  });
});
