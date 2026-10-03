import { hexToRgb } from "../src/color";
import type { StitchPlan } from "../src/stitch";
import { encodePng } from "./fixtures/png";

/**
 * "Realistic" stitch renderer for judging how a design will look sewn, not just where the needle goes.
 * Every needle-to-needle move is drawn as a thread of real width (default 0.4 mm, a 40 wt thread
 * lying flat) with cylinder shading across the thread, a sheen that depends on the stitch direction
 * (satin catches the light when the stitches run across it), and a soft shadow onto whatever is
 * underneath. Later stitches paint over earlier ones, so underlay, density and overlaps show up the
 * way they do on cloth. Debug / review tool only: it lives in test utils, the engine does not use it.
 */
export interface RealisticOptions {
  /** Output resolution. Default 20 px per mm (an 80 mm design is 1600 px wide). */
  pxPerMm?: number;
  /** Region to draw, mm. Default: the design bounds plus `pad`. */
  viewport?: { x0: number; y0: number; x1: number; y1: number };
  /** Margin around the design bounds when no viewport is given, mm. Default 3. */
  pad?: number;
  /** Visible width of one thread, mm. Default 0.4. */
  threadWidthMm?: number;
  /** Fabric colour. Default a light stone so dark threads (most logos) read well. */
  fabricHex?: string;
  /** Light direction on the page (unit-ish vector, +y down). Default up-left. */
  light?: readonly [number, number];
}

export interface RealisticImage {
  width: number;
  height: number;
  /** RGBA, row-major. */
  rgba: Uint8Array;
  /** Where the top-left pixel sits (mm) and the scale, so callers can map mm to pixels. */
  originMm: readonly [number, number];
  pxPerMm: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function planBounds(plan: StitchPlan): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of plan.stitches) {
    if (s.type !== "stitch") continue;
    x0 = Math.min(x0, s.x);
    y0 = Math.min(y0, s.y);
    x1 = Math.max(x1, s.x);
    y1 = Math.max(y1, s.y);
  }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  return { x0, y0, x1, y1 };
}

export function renderRealistic(plan: StitchPlan, opts: RealisticOptions = {}): RealisticImage {
  const ppm = opts.pxPerMm ?? 20;
  const pad = opts.pad ?? 3;
  const b = opts.viewport ?? (() => {
    const p = planBounds(plan);
    return { x0: p.x0 - pad, y0: p.y0 - pad, x1: p.x1 + pad, y1: p.y1 + pad };
  })();
  const w = Math.max(1, Math.ceil((b.x1 - b.x0) * ppm));
  const h = Math.max(1, Math.ceil((b.y1 - b.y0) * ppm));
  const img = new Uint8Array(w * h * 4);
  const fab = hexToRgb(opts.fabricHex ?? "#d9d6cf");
  // Fabric: flat colour with a faint woven grid and per-pixel grain.
  const weave = Math.max(2, Math.round(0.35 * ppm));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const grid = (Math.floor(x / weave) + Math.floor(y / weave)) % 2 ? 0.96 : 1.03;
      const g = grid * (0.97 + 0.06 * hash(x, y));
      img[i] = Math.min(255, fab[0] * g);
      img[i + 1] = Math.min(255, fab[1] * g);
      img[i + 2] = Math.min(255, fab[2] * g);
      img[i + 3] = 255;
    }
  }

  const rPx = ((opts.threadWidthMm ?? 0.4) / 2) * ppm;
  const L0 = opts.light ?? [-0.55, -0.83];
  const ll = Math.hypot(L0[0], L0[1]) || 1;
  const Lx = L0[0] / ll;
  const Ly = L0[1] / ll;
  const toPx = (x: number, y: number): [number, number] => [(x - b.x0) * ppm, (y - b.y0) * ppm];

  const shadowOff = 0.1 * ppm;
  let prev: [number, number] | null = null;
  for (const s of plan.stitches) {
    if (s.type === "colorChange") continue;
    const p = toPx(s.x, s.y);
    if (s.type !== "stitch") {
      prev = p;
      continue;
    }
    const a = prev;
    prev = p;
    if (!a) continue;
    const dx = p[0] - a[0];
    const dy = p[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ux = dx / len;
    const uy = dy / len;
    const margin = rPx * 1.6 + shadowOff + 1;
    const minX = Math.max(0, Math.floor(Math.min(a[0], p[0]) - margin));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(a[0], p[0]) + margin));
    const minY = Math.max(0, Math.floor(Math.min(a[1], p[1]) - margin));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(a[1], p[1]) + margin));
    if (minX > maxX || minY > maxY) continue;
    const base = hexToRgb(plan.threads[s.threadIndex]?.hex ?? "#ffffff");
    // Sheen: brightest when the stitch runs across the light, dimmer along it.
    const across = Math.abs(ux * Ly - uy * Lx);
    const sheen = 0.82 + 0.34 * across;
    // Signed lateral offset uses the normal that faces the light.
    let nx = -uy;
    let ny = ux;
    if (nx * Lx + ny * Ly < 0) {
      nx = -nx;
      ny = -ny;
    }
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        // distance to the segment
        const t = clamp01(((px - a[0]) * ux + (py - a[1]) * uy) / len);
        const cx = a[0] + dx * t;
        const cy = a[1] + dy * t;
        const d = Math.hypot(px - cx, py - cy);
        const i = (y * w + x) * 4;
        // soft drop shadow, offset away from the light
        const sx = px - (cx - Lx * shadowOff);
        const sy = py - (cy - Ly * shadowOff);
        const sd = Math.hypot(sx, sy);
        if (sd < rPx * 1.5 && d > rPx - 0.5) {
          const k = 0.28 * (1 - sd / (rPx * 1.5));
          img[i] = img[i] * (1 - k);
          img[i + 1] = img[i + 1] * (1 - k);
          img[i + 2] = img[i + 2] * (1 - k);
        }
        const cover = clamp01(rPx - d + 0.5);
        if (cover <= 0) continue;
        const tt = Math.min(1, d / rPx);
        const height = Math.sqrt(1 - tt * tt);
        const lateral = ((px - cx) * nx + (py - cy) * ny) / rPx; // +1 on the lit side
        const diffuse = 0.55 + 0.45 * (0.65 * height + 0.35 * clamp01(0.5 + 0.5 * lateral));
        const spec = Math.pow(clamp01(height * (0.55 + 0.45 * lateral)), 6) * across * 0.35;
        const lit = diffuse * sheen;
        // Dark threads (black logos) would shade to nothing; a small additive sheen keeps their form visible.
        const lift = 30 * height * (0.4 + 0.6 * across) * clamp01(0.3 + 0.7 * lateral);
        const r = Math.min(255, base[0] * lit + 255 * spec + lift);
        const g = Math.min(255, base[1] * lit + 255 * spec + lift);
        const bl = Math.min(255, base[2] * lit + 255 * spec + lift);
        img[i] = img[i] * (1 - cover) + r * cover;
        img[i + 1] = img[i + 1] * (1 - cover) + g * cover;
        img[i + 2] = img[i + 2] * (1 - cover) + bl * cover;
      }
    }
  }
  return { width: w, height: h, rgba: img, originMm: [b.x0, b.y0], pxPerMm: ppm };
}

export function renderRealisticPng(plan: StitchPlan, opts: RealisticOptions = {}): Uint8Array {
  const im = renderRealistic(plan, opts);
  return encodePng(im.width, im.height, im.rgba);
}
