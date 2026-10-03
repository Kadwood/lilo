import { describe, expect, it } from "vitest";
import { autoDigitize } from "../src/autodigitize";
import { DEFAULT_REGION_SETTINGS, hitRegion, pointInRing, regionContains, regionToObjects, type TraceRegion } from "../src/clickstitch";
import { makeIdGen, validateDesign, type Design } from "../src/model";
import { initVtracerNode } from "../src/node";
import { designToStitchPlan } from "../src/stitch";
import { badge } from "./fixtures/fixtures";

const thread = { id: "t1", brand: "Brother", code: "1", name: "Red", hex: "#ff0000" };
const region = (over: Partial<TraceRegion> = {}): TraceRegion => ({
  id: "r1",
  hex: "#ff0000",
  thread,
  shell: [[0, 0], [20, 0], [20, 20], [0, 20]],
  holes: [[[5, 5], [15, 5], [15, 15], [5, 15]]],
  areaMm2: 300,
  box: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
  ...over,
});

describe("hit-testing regions", () => {
  it("is inside the shell and outside holes", () => {
    const r = region();
    expect(pointInRing([2, 2], r.shell)).toBe(true);
    expect(regionContains(r, [2, 2])).toBe(true);
    expect(regionContains(r, [10, 10])).toBe(false); // in the hole
    expect(regionContains(r, [30, 10])).toBe(false);
  });

  it("returns the smallest region when several overlap, null on empty space", () => {
    const big = region({ id: "big" });
    const small = region({ id: "small", holes: [], areaMm2: 20, shell: [[8, 8], [12, 8], [12, 12], [8, 12]], box: { minX: 8, minY: 8, maxX: 12, maxY: 12 } });
    expect(hitRegion([big, small], [10, 10])?.id).toBe("small");
    expect(hitRegion([big, small], [2, 2])?.id).toBe("big");
    expect(hitRegion([big, small], [50, 50])).toBeNull();
  });
});

describe("regionToObjects", () => {
  const design = (): Design => ({ version: 1, unitsMm: 1, hoop: { name: "h", widthMm: 160, heightMm: 260 }, threads: [thread], objects: [] });

  it("makes one fill with the holes and the chosen fill settings", () => {
    const d = design();
    const { objects } = regionToObjects(region(), { ...DEFAULT_REGION_SETTINGS, fill: { ...DEFAULT_REGION_SETTINGS.fill, angleDeg: 10, pattern: "waves" } }, makeIdGen(d));
    expect(objects).toHaveLength(1);
    const o = objects[0];
    expect(o.kind).toBe("fill");
    if (o.kind !== "fill") return;
    expect(o.geometry.holes).toHaveLength(1);
    expect(o.params.angleDeg).toBe(10);
    expect(o.params.pattern).toBe("waves");
    d.objects = objects;
    expect(validateDesign(d)).toEqual([]);
    expect(designToStitchPlan(d).stitches.length).toBeGreaterThan(50);
  });

  it("outline makes a closed run per ring, in the override thread", () => {
    const d = design();
    const other = { ...thread, id: "t2", name: "Blue", hex: "#0000ff" };
    const nextId = makeIdGen(d);
    const { objects, thread: used } = regionToObjects(region(), { ...DEFAULT_REGION_SETTINGS, style: "outline", thread: other }, nextId);
    expect(used.id).toBe("t2");
    expect(objects.map((o) => o.kind)).toEqual(["run", "run"]);
    expect(objects.every((o) => o.threadId === "t2" && o.kind === "run" && o.geometry.closed)).toBe(true);
    expect(new Set(objects.map((o) => o.id)).size).toBe(2);
  });
});

describe("autoDigitize keeps the trace for clicking", () => {
  it("returns regions in design mm that line up with the stitched design", async () => {
    await initVtracerNode();
    const r = await autoDigitize(badge(), { widthMm: 60 });
    expect(r.traceRegions.length).toBeGreaterThan(2);
    const ids = new Set(r.traceRegions.map((x) => x.id));
    expect(ids.size).toBe(r.traceRegions.length);
    // every region's thread is one the design uses (same snapping, same trace)
    const used = new Set(r.design.threads.map((t) => t.id));
    const inDesign = r.traceRegions.filter((x) => used.has(x.thread.id));
    expect(inDesign.length / r.traceRegions.length).toBeGreaterThan(0.8);
    // the regions sit inside the 60 mm artwork
    for (const x of r.traceRegions) {
      expect(x.box.minX).toBeGreaterThanOrEqual(-31);
      expect(x.box.maxX).toBeLessThanOrEqual(31);
      expect(x.areaMm2).toBeGreaterThan(0.2);
    }
    // a point just inside a design fill's edge is inside some traced region
    const fill = r.design.objects.find((o) => o.kind === "fill" && o.geometry.shell.length > 8);
    expect(fill).toBeTruthy();
    if (fill?.kind === "fill") {
      const n = fill.geometry.shell.length;
      const c = fill.geometry.shell.reduce<[number, number]>((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n], [0, 0]);
      const probe = fill.geometry.shell[0];
      expect(hitRegion(r.traceRegions, [probe[0] * 0.98 + c[0] * 0.02, probe[1] * 0.98 + c[1] * 0.02])).not.toBeNull();
    }
  }, 60_000);
});
