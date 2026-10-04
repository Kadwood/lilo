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

describe("PEC short/long form boundary", () => {
  it("round-trips deltas of -64, -63, 62, 63 and 64 (0.1 mm units)", () => {
    const mk = (x: number, y: number) => ({ x, y, type: "stitch" as const, threadIndex: 0, objectIndex: 0 });
    const xs = [0, -6.4, -12.7, -6.5, 0, 6.3, 12.6, 6.2, 12.7, 6.3];
    const plan = { threads: [byName("Blue")], warnings: [], stitches: xs.map((x, i) => mk(x, i % 2 ? 6.3 : -6.4)) };
    const back = readPes(writePes(plan));
    expect(back.stitches).toHaveLength(plan.stitches.length);
    plan.stitches.forEach((s, i) => {
      expect(back.stitches[i].x).toBeCloseTo(s.x, 5);
      expect(back.stitches[i].y).toBeCloseTo(s.y, 5);
    });
  });
});

describe("PEC stitch-block header (20 bytes)", () => {
  const plan = tinyPlan(); // needle bbox x -5..5, y -5..5 mm
  const bytes = writePes(plan, { label: "tiny.pes" });
  const blockStart = 22 + 512;

  /** Independent PEC stream decoder (does not use read.ts). Returns absolute 0.1 mm coords. */
  function decodeAt(from: number) {
    const pts: { x: number; y: number; kind: string }[] = [];
    let i = from;
    let x = 0;
    let y = 0;
    const axis = () => {
      const b = bytes[i];
      if (b & 0x80) {
        const v = ((b << 8) | bytes[i + 1]) & 0xfff;
        i += 2;
        return { d: v & 0x800 ? v - 0x1000 : v, flags: b & 0x30 };
      }
      i += 1;
      return { d: b & 0x40 ? b - 0x80 : b, flags: 0 };
    };
    for (;;) {
      if (bytes[i] === 0xff) break;
      if (bytes[i] === 0xfe && bytes[i + 1] === 0xb0) {
        pts.push({ x, y, kind: "colorChange" });
        i += 3;
        continue;
      }
      const a = axis();
      const b = axis();
      x += a.d;
      y += b.d;
      const f = a.flags | b.flags;
      pts.push({ x, y, kind: f & 0x20 ? "trim" : f & 0x10 ? "jump" : "stitch" });
    }
    return pts;
  }

  it("writes the two big-endian origin-offset words after 0x1b0", () => {
    expect([...bytes.subarray(blockStart + 12, blockStart + 16)]).toEqual([0xe0, 0x01, 0xb0, 0x01]);
    // minX = minY = -5 mm -> 50 -> 0x9000 | 0x32, big-endian
    expect([...bytes.subarray(blockStart + 16, blockStart + 20)]).toEqual([0x90, 0x32, 0x90, 0x32]);
  });

  it("stitch stream starts at +20 and reproduces the plan coordinates and bbox", () => {
    const pts = decodeAt(blockStart + 20);
    expect(pts).toHaveLength(plan.stitches.length);
    plan.stitches.forEach((s, i) => {
      expect(Math.abs(pts[i].x - s.x * 10)).toBeLessThanOrEqual(1);
      expect(Math.abs(pts[i].y - s.y * 10)).toBeLessThanOrEqual(1);
      expect(pts[i].kind).toBe(s.type);
    });
    const st = pts.filter((p) => p.kind === "stitch");
    expect(Math.max(...st.map((p) => p.x)) - Math.min(...st.map((p) => p.x))).toBe(100);
    expect(Math.max(...st.map((p) => p.y)) - Math.min(...st.map((p) => p.y))).toBe(100);
  });

  it("still reads old Lilo v1.0/v1.1 files with a 16-byte header", () => {
    const old = new Uint8Array(bytes.length - 4);
    old.set(bytes.subarray(0, blockStart + 16), 0);
    old.set(bytes.subarray(blockStart + 20), blockStart + 16);
    const len = (old[blockStart + 2] | (old[blockStart + 3] << 8) | (old[blockStart + 4] << 16)) - 4;
    old[blockStart + 2] = len & 0xff;
    old[blockStart + 3] = (len >> 8) & 0xff;
    old[blockStart + 4] = (len >> 16) & 0xff;
    const a = readPes(old);
    const b = readPes(bytes);
    expect(a.stitches).toEqual(b.stitches);
    expect(a.stitches).toHaveLength(plan.stitches.length);
  });
});
