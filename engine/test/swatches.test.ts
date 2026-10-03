import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_FILL_PARAMS, DEFAULT_HOOP, FILL_PATTERNS, emptyDesign, getCatalogue, makeFill, rectNodes, toDesignThread, type Design } from "../src";
import { designToStitchPlan } from "../src/stitch";
import { encodePng } from "./fixtures/png";

/**
 * Generates the pattern-picker swatches: each fill pattern on a 40 x 30 mm rectangle, rendered as
 * anti-aliased thread lines on a transparent background. Run with `pnpm --filter @lilo/engine swatches`
 * (sets LILO_SWATCHES=1); the PNGs land in editor/src/assets/fill-swatches/ and are committed.
 */
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../editor/src/assets/fill-swatches");
const PX_PER_MM = 6;
const W = 40;
const H = 30;
const PAD = 1;
const COLOUR: [number, number, number] = [0x4a, 0x5d, 0xd8];

function render(points: { x: number; y: number; type: string }[]): Uint8Array {
  const w = Math.ceil((W + 2 * PAD) * PX_PER_MM);
  const h = Math.ceil((H + 2 * PAD) * PX_PER_MM);
  const cov = new Float32Array(w * h);
  const plot = (x: number, y: number, a: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h || a <= 0) return;
    const i = y * w + x;
    cov[i] = Math.min(1, cov[i] + a * (1 - cov[i] * 0.5));
  };
  const fpart = (v: number) => v - Math.floor(v);
  // Xiaolin Wu anti-aliased line
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
    if (steep) [x0, y0, x1, y1] = [y0, x0, y1, x1];
    if (x0 > x1) [x0, x1, y0, y1] = [x1, x0, y1, y0];
    const dx = x1 - x0;
    const grad = dx === 0 ? 1 : (y1 - y0) / dx;
    let y = y0;
    for (let x = Math.round(x0); x <= Math.round(x1); x++) {
      const yi = Math.floor(y);
      const f = fpart(y);
      if (steep) {
        plot(yi, x, 1 - f);
        plot(yi + 1, x, f);
      } else {
        plot(x, yi, 1 - f);
        plot(x, yi + 1, f);
      }
      y += grad;
    }
  };
  let prev: { x: number; y: number } | null = null;
  for (const s of points) {
    if (s.type === "stitch" && prev) line((prev.x + W / 2 + PAD) * PX_PER_MM, (prev.y + H / 2 + PAD) * PX_PER_MM, (s.x + W / 2 + PAD) * PX_PER_MM, (s.y + H / 2 + PAD) * PX_PER_MM);
    if (s.type === "stitch" || s.type === "jump") prev = s;
  }
  const img = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    img[i * 4] = COLOUR[0];
    img[i * 4 + 1] = COLOUR[1];
    img[i * 4 + 2] = COLOUR[2];
    img[i * 4 + 3] = Math.round(Math.min(1, cov[i] * 1.15) * 255);
  }
  return encodePng(w, h, img);
}

const enabled = !!process.env.LILO_SWATCHES;

describe.skipIf(!enabled)("fill pattern swatches", () => {
  it("renders one PNG per pattern", () => {
    mkdirSync(OUT, { recursive: true });
    const thread = toDesignThread(getCatalogue().threads.find((t) => t.name === "Blue")!);
    for (const p of FILL_PATTERNS) {
      const d: Design = { ...emptyDesign(DEFAULT_HOOP), threads: [thread] };
      d.objects = [
        {
          ...makeFill("sw", p.label, thread.id, rectNodes(-W / 2, -H / 2, W / 2, H / 2)),
          params: { ...DEFAULT_FILL_PARAMS, pattern: p.id, angleDeg: p.defaultAngleDeg, underlay: false, edgeRun: false, pullCompMm: 0 },
        },
      ];
      const plan = designToStitchPlan(d);
      expect(plan.stitches.length).toBeGreaterThan(50);
      writeFileSync(resolve(OUT, `${p.id}.png`), render(plan.stitches));
    }
  }, 120_000);
});
