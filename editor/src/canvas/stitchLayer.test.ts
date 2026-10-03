// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { PlanStitch, StitchPlan } from "@lilo/engine";
import { NEAR_ZOOM, StitchLayer } from "./stitchLayer";

const THREAD = { id: "t", brand: "B", code: "1", name: "x", hex: "#336699" };
const st = (x: number, y: number, threadIndex = 0, type: PlanStitch["type"] = "stitch"): PlanStitch => ({ x, y, type, threadIndex, objectIndex: 0 });

/** A zig-zag of `n` stitches in one colour: n - 1 drawable segments (the first entry has nothing before it). */
const zigzag = (n: number, dx = 1): StitchPlan => ({ threads: [THREAD], stitches: Array.from({ length: n }, (_, i) => st(i * dx, i % 2 ? 1 : 0)), warnings: [] });

const meshes = (l: StitchLayer) => l.container.children as unknown as { visible: boolean; geometry: { indexCount: number; positions: Float32Array; indices: Uint32Array } }[];
const visible = (l: StitchLayer) => meshes(l).filter((m) => m.visible);
const everywhere = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 };

describe("StitchLayer", () => {
  it("makes quads, not a Graphics path: 2 triangles per stitch (flat view), more with the lit thread", () => {
    const l = new StitchLayer();
    l.setPlan(zigzag(101), { realistic: false, jumps: false });
    const m = meshes(l);
    expect(m).toHaveLength(1);
    expect(m[0].geometry.indices.length).toBe(100 * 12); // pointed ends: 4 triangles a stitch
    l.setPlan(zigzag(101), { realistic: true, jumps: false });
    expect(meshes(l).length).toBe(3); // edge, core, and the flat far-away layer
    l.setViewRect(everywhere, NEAR_ZOOM + 1);
    expect(visible(l)).toHaveLength(2);
    l.setViewRect(everywhere, NEAR_ZOOM - 1);
    expect(visible(l)).toHaveLength(1); // one flat layer when a thread is about a pixel wide
  });

  it("cuts the plan into chunks and culls the ones off screen", () => {
    const l = new StitchLayer();
    l.setPlan(zigzag(6001, 0.5), { realistic: false, jumps: false });
    const all = meshes(l).length;
    expect(all).toBeGreaterThanOrEqual(3);
    l.setViewRect(everywhere, 8);
    expect(visible(l)).toHaveLength(all);
    l.setViewRect({ minX: 0, minY: -5, maxX: 100, maxY: 5 }, 8); // the first 200 stitches
    expect(visible(l).length).toBeLessThan(all);
    expect(visible(l).length).toBeGreaterThanOrEqual(1);
    l.setViewRect({ minX: 5000, minY: 0, maxX: 6000, maxY: 5 }, 8);
    expect(visible(l)).toHaveLength(0);
  });

  it("playback shows the first n stitches by limiting the indices drawn, without rebuilding", () => {
    const l = new StitchLayer();
    l.setPlan(zigzag(11), { realistic: false, jumps: false });
    l.setViewRect(everywhere, 8);
    const [m] = meshes(l);
    const positions = m.geometry.positions;
    l.setProgress(6); // entries 0..5 shown: 5 segments
    expect(m.geometry.indexCount).toBe(5 * 12);
    l.setProgress(11);
    expect(m.geometry.indexCount).toBe(0); // all of them
    l.setProgress(0);
    expect(visible(l)).toHaveLength(0);
    expect(m.geometry.positions).toBe(positions); // same buffer all along
  });

  it("colour changes and jumps break stitches into the right layers; jumps only when asked", () => {
    const plan: StitchPlan = {
      threads: [THREAD, { ...THREAD, id: "u", hex: "#aa3333" }],
      stitches: [st(0, 0), st(1, 0), st(5, 0, 0, "jump"), st(6, 0), st(7, 0), { ...st(7, 0, 1, "colorChange") }, st(8, 0, 1), st(9, 1, 1)],
      warnings: [],
    };
    const on = new StitchLayer();
    on.setPlan(plan, { realistic: false, jumps: true });
    on.setViewRect(everywhere, 8);
    expect(meshes(on).length).toBe(3); // one chunk a colour block: block 0 has a jump-line mesh and a stitch mesh, block 1 a stitch mesh
    const off = new StitchLayer();
    off.setPlan(plan, { realistic: false, jumps: false });
    expect(meshes(off).length).toBeLessThan(meshes(on).length);
  });

  it("thicker thread for triple, rope and satin: the width multiplier widens the quad", () => {
    const l = new StitchLayer();
    const plan = zigzag(3, 10);
    l.setPlan(plan, { realistic: false, jumps: false, widthScale: [3] });
    const wide = meshes(l)[0].geometry.positions;
    const l2 = new StitchLayer();
    l2.setPlan(plan, { realistic: false, jumps: false });
    const thin = meshes(l2)[0].geometry.positions;
    const span = (p: Float32Array) => Math.max(...[...p].filter((_, i) => i % 2 === 1)) - Math.min(...[...p].filter((_, i) => i % 2 === 1));
    expect(span(wide)).toBeGreaterThan(span(thin));
  });

  it("clear removes every mesh", () => {
    const l = new StitchLayer();
    l.setPlan(zigzag(50), { realistic: true, jumps: true });
    expect(l.container.children.length).toBeGreaterThan(0);
    l.setPlan(null, { realistic: true, jumps: true });
    expect(l.container.children).toHaveLength(0);
  });
});
