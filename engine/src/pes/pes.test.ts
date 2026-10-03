import { describe, expect, it } from "vitest";
import { DEFAULT_HOOP } from "../model";
import { designToStitchPlan } from "../stitch/generate";
import { validatePlan } from "../stitch/validate";
import type { PlanStitch, StitchPlan } from "../stitch/plan";
import { getCatalogue, toDesignThread } from "../threads";
import { sampleDesign } from "../stitch/sample-design";
import { applyOrigin, PEC_PALETTE, nearestPecIndex, readPes, writePes } from "./index";

const cat = getCatalogue().threads;
const byName = (n: string) => toDesignThread(cat.find((t) => t.name === n)!);

describe("PEC palette", () => {
  it("has 64 entries and maps exact Brother Embroidery thread colours to a slot", () => {
    expect(PEC_PALETTE).toHaveLength(64);
    expect(PEC_PALETTE[0]).toMatchObject({ index: 1, name: "Prussian Blue" });
    expect(PEC_PALETTE[63]).toMatchObject({ index: 64, name: "Applique" });
    // Brother Embroidery 800 "Red" is PEC slot 5, 900 "Black" slot 20, 001 "White" slot 29.
    expect(nearestPecIndex("#ed171f")).toBe(5);
    expect(nearestPecIndex("#000000")).toBe(20);
    expect(nearestPecIndex("#f0f0f0")).toBe(29);
    expect(nearestPecIndex("#0a55a3")).toBe(2);
  });

  it("every Brother Embroidery thread is within a hair of its PEC slot", () => {
    const exact = getCatalogue("brother-embroidery").threads.filter(
      (t) => PEC_PALETTE[nearestPecIndex(t.hex) - 1].rgb.join() === parseHex(t.hex).join(),
    );
    expect(exact.length).toBeGreaterThanOrEqual(50);
  });
});

const parseHex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function tinyPlan(): StitchPlan {
  const blue = byName("Blue");
  const red = byName("Red");
  const mk = (x: number, y: number, type: PlanStitch["type"], t: number): PlanStitch => ({ x, y, type, threadIndex: t, objectIndex: 0 });
  return {
    threads: [blue, red],
    warnings: [],
    stitches: [
      mk(-5, -5, "jump", 0),
      mk(-5, -5, "stitch", 0),
      mk(-4.9, -5, "stitch", 0),
      mk(5, -4.2, "stitch", 0), // 9.9 mm: needs long form
      mk(5, 5, "stitch", 0),
      mk(5, 5, "colorChange", 1),
      mk(-5, 5, "trim", 1),
      mk(-5, 5, "stitch", 1),
      mk(-3.33, 4.5, "stitch", 1),
    ],
  };
}

describe("PES writer + reader", () => {
  const bytes = writePes(tinyPlan(), { label: "tiny.pes" });
  const back = readPes(bytes);

  it("writes a PES v1 header, label and consistent colour list", () => {
    expect(String.fromCharCode(...bytes.subarray(0, 8))).toBe("#PES0001");
    expect(back.label).toBe("tiny");
    expect(back.pecIndices).toEqual([2, 5]); // Blue -> slot 2, Red -> slot 5
    expect(back.colors.map((c) => c.name)).toEqual(["Blue", "Red"]);
    expect(bytes[22 + 48]).toBe(1); // colour count - 1
  });

  it("has exactly the expected length: header + 512 + stitch block + (colours+1) thumbnails", () => {
    const pec = 22;
    const blockLength = bytes[pec + 512 + 2] | (bytes[pec + 512 + 3] << 8) | (bytes[pec + 512 + 4] << 16);
    expect(bytes.length).toBe(pec + 512 + blockLength + 3 * 228);
    expect(bytes[pec + 512 + blockLength - 1]).toBe(0xff);
  });

  it("round-trips positions, types and colour blocks within 0.1 mm", () => {
    const src = tinyPlan().stitches;
    expect(back.stitches).toHaveLength(src.length);
    src.forEach((s, i) => {
      const r = back.stitches[i];
      expect(r.type).toBe(s.type);
      expect(Math.abs(r.x - s.x)).toBeLessThanOrEqual(0.05 + 1e-9);
      expect(Math.abs(r.y - s.y)).toBeLessThanOrEqual(0.05 + 1e-9);
      expect(r.block).toBe(s.threadIndex);
    });
    expect(back.widthMm).toBeCloseTo(10, 0);
  });

  it("rejects non-PES input and empty designs", () => {
    expect(() => readPes(new Uint8Array(100))).toThrow(/Not a PES/);
    expect(() => writePes({ threads: [], stitches: [], warnings: [] })).toThrow(/Nothing to export/);
  });

  it("is deterministic", () => {
    expect(writePes(tinyPlan(), { label: "tiny.pes" })).toEqual(bytes);
  });
});

describe("full design -> PES -> back", () => {
  const { plan } = validatePlan(designToStitchPlan(sampleDesign()), DEFAULT_HOOP);
  const centred = applyOrigin(plan);
  const bytes = writePes(centred, { label: "sample" });
  const back = readPes(bytes);

  it("keeps stitch count, colour count and positions", () => {
    expect(back.stitches).toHaveLength(centred.stitches.length);
    expect(back.pecIndices).toEqual([2, 5]);
    centred.stitches.forEach((s, i) => {
      expect(Math.abs(back.stitches[i].x - s.x)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(back.stitches[i].y - s.y)).toBeLessThanOrEqual(0.1);
      expect(back.stitches[i].type).toBe(s.type);
    });
  });

  it("origin presets move the anchor to (0,0)", () => {
    const tl = applyOrigin(plan, { h: "left", v: "top" });
    const xs = tl.stitches.filter((s) => s.type === "stitch");
    expect(Math.min(...xs.map((s) => s.x))).toBeCloseTo(0, 6);
    expect(Math.min(...xs.map((s) => s.y))).toBeCloseTo(0, 6);
    const c = applyOrigin(plan);
    const cx = c.stitches.filter((s) => s.type === "stitch").map((s) => s.x);
    expect(Math.min(...cx)).toBeCloseTo(-Math.max(...cx), 6);
  });
});
