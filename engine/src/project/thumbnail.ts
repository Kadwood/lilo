import { zlibSync } from "fflate";
import { hexToRgb } from "../color";
import type { Design } from "../model";
import { designToStitchPlan } from "../stitch/generate";
import type { StitchPlan } from "../stitch/plan";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** RGBA pixels to PNG bytes. */
export function encodePngRgba(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibSync(raw, { level: 6 })),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export interface ThumbnailOptions {
  /** Square size in pixels. Default 256. */
  size?: number;
  /** Background "#rrggbb". Default a warm off-white. */
  background?: string;
}

/**
 * A square preview of a stitch plan: thread-coloured lines scaled to fit, on a plain background.
 * Pure TypeScript (no canvas), so it works in a Worker and in tests.
 */
export function planThumbnailPng(plan: StitchPlan, options: ThumbnailOptions = {}): Uint8Array {
  const size = options.size ?? 256;
  const bg = hexToRgb(options.background ?? "#faf7f2");
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) px.set([bg[0], bg[1], bg[2], 255], i * 4);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of plan.stitches) {
    if (s.type !== "stitch") continue;
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x);
    maxY = Math.max(maxY, s.y);
  }
  if (Number.isFinite(minX)) {
    const margin = size * 0.08;
    const scale = Math.min((size - 2 * margin) / Math.max(maxX - minX, 1e-6), (size - 2 * margin) / Math.max(maxY - minY, 1e-6));
    const ox = size / 2 - ((minX + maxX) / 2) * scale;
    const oy = size / 2 - ((minY + maxY) / 2) * scale;
    const put = (x: number, y: number, c: readonly [number, number, number]) => {
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (ix < 0 || iy < 0 || ix >= size || iy >= size) return;
      px.set([c[0], c[1], c[2], 255], (iy * size + ix) * 4);
    };
    let prev: [number, number] | null = null;
    for (const s of plan.stitches) {
      if (s.type === "colorChange") continue;
      const p: [number, number] = [s.x * scale + ox, s.y * scale + oy];
      if (s.type === "stitch" && prev) {
        const c = hexToRgb(plan.threads[s.threadIndex].hex);
        const n = Math.max(1, Math.ceil(Math.hypot(p[0] - prev[0], p[1] - prev[1])));
        for (let k = 0; k <= n; k++) put(prev[0] + ((p[0] - prev[0]) * k) / n, prev[1] + ((p[1] - prev[1]) * k) / n, c);
      }
      prev = p;
    }
  }
  return encodePngRgba(size, size, px);
}

/** Thumbnail for a design (generates its stitches first). An empty design gives a blank card. */
export function designThumbnailPng(design: Design, options: ThumbnailOptions = {}): Uint8Array {
  return planThumbnailPng(designToStitchPlan(design), options);
}
