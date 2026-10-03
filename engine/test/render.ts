import { hexToRgb } from "../src/color";
import type { StitchPlan } from "../src/stitch";
import { encodePng } from "./fixtures/png";

/** Debug renderer: draws a plan's stitches as 1 px lines in thread colours on a white page (PNG bytes). */
export function renderPlanPng(plan: StitchPlan, pxPerMm = 8, pad = 4): Uint8Array {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of plan.stitches) {
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x);
    maxY = Math.max(maxY, s.y);
  }
  const w = Math.ceil((maxX - minX + 2 * pad) * pxPerMm);
  const h = Math.ceil((maxY - minY + 2 * pad) * pxPerMm);
  const img = new Uint8Array(w * h * 4).fill(255);
  const put = (x: number, y: number, c: [number, number, number]) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return;
    const i = (iy * w + ix) * 4;
    img[i] = c[0];
    img[i + 1] = c[1];
    img[i + 2] = c[2];
  };
  const P = (x: number, y: number): [number, number] => [(x - minX + pad) * pxPerMm, (y - minY + pad) * pxPerMm];
  let prev: [number, number] | null = null;
  for (const s of plan.stitches) {
    const p = P(s.x, s.y);
    if (s.type === "stitch" && prev) {
      const c = hexToRgb(plan.threads[s.threadIndex].hex);
      const n = Math.ceil(Math.hypot(p[0] - prev[0], p[1] - prev[1]));
      for (let k = 0; k <= n; k++) put(prev[0] + ((p[0] - prev[0]) * k) / (n || 1), prev[1] + ((p[1] - prev[1]) * k) / (n || 1), c);
    }
    if (s.type !== "colorChange") prev = p;
  }
  return encodePng(w, h, img);
}
