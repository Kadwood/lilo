import { beforeAll, describe, expect, it } from "vitest";
import { init } from "@stitchables/stitchjs";
import { intersectionArea } from "../geom";
import type { Pt } from "../model";
import { cutHooks, resampleStrip, trimJunctions } from "./junction";
import { stripPolygon } from "./spine";
import { hairlineStrip } from "./strokes";

beforeAll(async () => {
  await init();
});

/** A straight column from (x0, y0) to (x1, y1), `w` wide, with a rung every `step` mm. */
function column(x0: number, y0: number, x1: number, y1: number, w: number, step = 1): Pt[] {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.round(len / step));
  const tx = (x1 - x0) / len;
  const ty = (y1 - y0) / len;
  const strip: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const cx = x0 + ((x1 - x0) * i) / n;
    const cy = y0 + ((y1 - y0) * i) / n;
    strip.push([cx - ty * (w / 2), cy + tx * (w / 2)], [cx + ty * (w / 2), cy - tx * (w / 2)]);
  }
  return strip;
}

const lastCentre = (s: readonly Pt[]): Pt => [(s[s.length - 2][0] + s[s.length - 1][0]) / 2, (s[s.length - 2][1] + s[s.length - 1][1]) / 2];

describe("trimJunctions", () => {
  it("a T: the bar yields to the stem and ends 0.2-0.5 mm inside it, not 3 mm", () => {
    const bar = column(0, 0, 8.5, 0, 1.6); // ends at the stem centre line, 1.5 mm inside it
    const stem = column(8.5, -6, 8.5, 6, 3); // x 7..10
    const out = trimJunctions([bar, stem], 0.4);
    expect(out).toHaveLength(2);
    const trimmedBar = out.find((o) => o.index === 0)!.strip;
    const depth = lastCentre(trimmedBar)[0] - 7; // stem edge at x = 7
    expect(depth).toBeGreaterThan(0.2);
    expect(depth).toBeLessThan(0.5);
    // the stem is not touched
    expect(out.find((o) => o.index === 1)!.strip).toHaveLength(stem.length);
  });

  it("overlap area drops to roughly overlap x width", () => {
    const bar = column(0, 0, 8.5, 0, 1.6);
    const stem = column(8.5, -6, 8.5, 6, 3);
    const before = intersectionArea(stripPolygon(bar)!, stripPolygon(stem)!);
    const out = trimJunctions([bar, stem], 0.4);
    const after = intersectionArea(stripPolygon(out[0].strip)!, stripPolygon(out[1].strip)!);
    expect(before).toBeCloseTo(1.5 * 1.6, 0);
    expect(after).toBeGreaterThan(0.2 * 1.6);
    expect(after).toBeLessThan(0.5 * 1.6);
  });

  it("a K (diagonal arm ending on the stem) overlaps by about the target, not the whole wedge", () => {
    const stem = column(5, 0, 5, 14, 1.6);
    const arm = column(0, 0, 5, 7, 1.6); // ends on the stem centre line
    const before = intersectionArea(stripPolygon(arm)!, stripPolygon(stem)!);
    const out = trimJunctions([arm, stem], 0.4);
    const after = intersectionArea(stripPolygon(out.find((o) => o.index === 0)!.strip)!, stripPolygon(out.find((o) => o.index === 1)!.strip)!);
    expect(before).toBeGreaterThan(0.8);
    expect(after).toBeLessThan(0.6 * before);
    expect(after).toBeGreaterThan(0);
  });

  it("columns that merely touch or are apart are left alone", () => {
    const a = column(0, 0, 5, 0, 1.6);
    const b = column(8, 0, 12, 0, 1.6);
    const out = trimJunctions([a, b], 0.4);
    expect(out.map((o) => o.strip.length)).toEqual([a.length, b.length]);
  });

  it("a stub lying wholly inside a bigger column is removed", () => {
    const big = column(0, 0, 10, 0, 4);
    const stub = column(3, 0, 4, 0, 0.8);
    const out = trimJunctions([big, stub], 0.4);
    expect(out.map((o) => o.index)).toEqual([0]);
  });

  it("one strip alone passes through", () => {
    const a = column(0, 0, 5, 0, 1.6);
    expect(trimJunctions([a], 0.4)).toEqual([{ index: 0, strip: expect.any(Array) }]);
  });
});

describe("resampleStrip and cutHooks", () => {
  it("resample keeps the shape and bounds the rung spacing", () => {
    const s = column(0, 0, 10, 0, 1, 2.5);
    const r = resampleStrip(s, 0.15);
    expect(r.length).toBeGreaterThan(s.length * 5);
    expect(r[0]).toEqual(s[0]);
    expect(r[r.length - 1]).toEqual(s[s.length - 1]);
  });

  it("cuts a sideways hook at the end of a column", () => {
    // centre line: a 0.25 mm sideways kink, then straight for 8 mm; rungs follow the local segment
    const centres: Pt[] = [[0, 0.25], [0, 0]];
    for (let x = 0.5; x <= 8; x += 0.5) centres.push([x, 0]);
    const strip: Pt[] = [];
    centres.forEach((c, i) => {
      const a = centres[Math.max(0, i - 1)];
      const b = centres[Math.min(centres.length - 1, i + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const tx = (b[0] - a[0]) / l;
      const ty = (b[1] - a[1]) / l;
      strip.push([c[0] - ty * 0.4, c[1] + tx * 0.4], [c[0] + ty * 0.4, c[1] - tx * 0.4]);
    });
    const cut = cutHooks(strip);
    expect(cut.length).toBeLessThan(resampleStrip(strip, 0.15).length);
    // the first rung now stands (roughly) perpendicular to the column's axis
    const dx = cut[0][0] - cut[1][0];
    expect(Math.abs(dx)).toBeLessThan(0.45); // was 0.8 (fully sideways) before the cut
  });

  it("leaves a clean column alone", () => {
    const s = column(0, 0, 8, 0, 1);
    expect(cutHooks(s)).toEqual([...s]);
  });
});

describe("hairlineStrip", () => {
  it("makes a constant-width column along a path, rungs perpendicular to the baseline direction", () => {
    const path: Pt[] = [];
    for (let x = 0; x <= 6; x += 0.5) path.push([x, 0]);
    const s = hairlineStrip(path, 0.8, false);
    expect(s.length).toBeGreaterThan(20);
    for (let i = 0; i + 1 < s.length; i += 2) {
      expect(Math.hypot(s[i][0] - s[i + 1][0], s[i][1] - s[i + 1][1])).toBeCloseTo(0.8, 6);
      expect(Math.abs(s[i][0] - s[i + 1][0])).toBeLessThan(1e-9); // vertical rungs on a horizontal path
    }
  });

  it("is not thrown by a tiny sideways hook at the start", () => {
    const path: Pt[] = [[0, 0.1], [0, 0], [0.3, 0], [0.6, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
    const s = hairlineStrip(path, 0.8, false);
    // the first rung: mostly vertical (perpendicular to the horizontal run), not horizontal
    expect(Math.abs(s[0][1] - s[1][1])).toBeGreaterThan(0.5);
  });

  it("closes a loop", () => {
    const loop: Pt[] = [];
    for (let i = 0; i < 24; i++) loop.push([3 * Math.cos((i / 24) * 2 * Math.PI), 3 * Math.sin((i / 24) * 2 * Math.PI)]);
    const s = hairlineStrip(loop, 0.8, true);
    expect(s[0][0]).toBeCloseTo(s[s.length - 2][0], 6);
    expect(s[0][1]).toBeCloseTo(s[s.length - 2][1], 6);
  });
});
