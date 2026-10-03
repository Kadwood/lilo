import { buildPaletteSync, utils } from "image-q";
import { hexToRgb, rgbToHex, rgbToLab, type Lab } from "../color";
import { nearestThread, type ThreadEntry } from "../threads";
import type { Prepped } from "./prep";
import type { ImageDataLike, PaletteChip } from "./types";

export const NO_LABEL = 255;

export interface Quantized {
  width: number;
  height: number;
  /** Per pixel: index into `palette`, or NO_LABEL for background. */
  labels: Uint8Array;
  /** The final colours (one per distinct thread), most-used first. */
  palette: PaletteChip[];
  /** RGBA preview in thread colours, background transparent. */
  image: ImageDataLike;
}

/** Pixels whose colour differs from a 4-neighbour by more than this (RGB distance) are "edge" pixels. */
const EDGE_THRESHOLD = 28;
const MAX_SAMPLES = 150_000;

/**
 * Pixels on a colour boundary are blends (anti-aliasing) that would otherwise claim palette slots
 * and turn into hair-thin regions of a third thread. We build the palette from flat pixels only,
 * then assign everything, edge pixels included, to the nearest real colour.
 */
function flatMask(p: Prepped): Uint8Array {
  const { width: w, height: h, rgb } = p;
  const flat = new Uint8Array(w * h).fill(1);
  const d = (a: number, b: number) =>
    Math.hypot(rgb[a * 3] - rgb[b * 3], rgb[a * 3 + 1] - rgb[b * 3 + 1], rgb[a * 3 + 2] - rgb[b * 3 + 2]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if ((x < w - 1 && d(i, i + 1) > EDGE_THRESHOLD) || (y < h - 1 && d(i, i + w) > EDGE_THRESHOLD)) {
        flat[i] = 0;
        if (x < w - 1 && d(i, i + 1) > EDGE_THRESHOLD) flat[i + 1] = 0;
        if (y < h - 1 && d(i, i + w) > EDGE_THRESHOLD) flat[i + w] = 0;
      }
    }
  }
  return flat;
}

function usedColours(candidates: [number, number, number][], sample: [number, number, number][]): [number, number, number][] {
  const labs = candidates.map((c) => rgbToLab(...c));
  const counts = new Array<number>(candidates.length).fill(0);
  const cache = new Map<number, number>();
  for (const s of sample) {
    const key = (s[0] << 16) | (s[1] << 8) | s[2];
    let k = cache.get(key);
    if (k === undefined) {
      const lab = rgbToLab(...s);
      let bd = Infinity;
      k = 0;
      labs.forEach((l, j) => {
        const d = (lab[0] - l[0]) ** 2 + (lab[1] - l[1]) ** 2 + (lab[2] - l[2]) ** 2;
        if (d < bd) {
          bd = d;
          k = j;
        }
      });
      cache.set(key, k);
    }
    counts[k]++;
  }
  const keep = candidates.filter((_, i) => counts[i] >= Math.max(1, sample.length * 0.003));
  return keep.length ? keep : candidates;
}

/**
 * Quantise the foreground to at most `colors` colours with image-q (Wu), snap each to its nearest
 * thread (CIEDE2000), merge colours that snap to the same thread, assign every pixel, then smooth
 * single-pixel noise with a 3x3 plurality filter.
 */
export function quantize(p: Prepped, colors: number, threads: readonly ThreadEntry[]): Quantized {
  const { width: w, height: h, rgb, fg } = p;
  const n = w * h;

  // 1. Samples for palette building: flat foreground pixels (fall back to all foreground).
  const flat = flatMask(p);
  const pick = (needFlat: boolean) => {
    const idx: number[] = [];
    for (let i = 0; i < n; i++) if (fg[i] && (!needFlat || flat[i])) idx.push(i);
    return idx;
  };
  let samples = pick(true);
  const fgCount = pick(false).length;
  if (samples.length < Math.max(50, fgCount * 0.05)) samples = pick(false);
  const stride = Math.max(1, Math.ceil(samples.length / MAX_SAMPLES));
  const sub = samples.filter((_, k) => k % stride === 0);
  const buf = new Uint8Array(sub.length * 4);
  sub.forEach((px, k) => {
    buf[k * 4] = rgb[px * 3];
    buf[k * 4 + 1] = rgb[px * 3 + 1];
    buf[k * 4 + 2] = rgb[px * 3 + 2];
    buf[k * 4 + 3] = 255;
  });
  const pc = utils.PointContainer.fromUint8Array(buf, sub.length, 1);
  const iqPalette = buildPaletteSync([pc], {
    colors: Math.max(2, Math.min(colors, 64)),
    paletteQuantization: "wuquant",
    colorDistanceFormula: "euclidean",
  });
  const candidates: [number, number, number][] = iqPalette
    .getPointContainer()
    .getPointArray()
    .map((pt) => [pt.r, pt.g, pt.b] as [number, number, number]);
  // Wu pads the palette up to `colors` even when the artwork has fewer real colours (it invents
  // entries nobody uses). Keep only colours that at least 0.3% of the sampled pixels are nearest to.
  const found = usedColours(candidates, sub.map((px) => [rgb[px * 3], rgb[px * 3 + 1], rgb[px * 3 + 2]] as [number, number, number]));

  // 2. Snap to threads; merge duplicates.
  const threadIndex = new Map<string, number>();
  const finalThreads: ThreadEntry[] = [];
  const sourceHex: string[] = [];
  const foundToFinal: number[] = found.map((c) => {
    const t = nearestThread(c, threads).thread;
    let k = threadIndex.get(t.hex);
    if (k === undefined) {
      k = finalThreads.length;
      threadIndex.set(t.hex, k);
      finalThreads.push(t);
      sourceHex.push(rgbToHex(...c));
    }
    return k;
  });

  // 3. Assign every foreground pixel to the nearest quantised colour (Lab, CIE76: it's a cheap
  //    nearest-of-<=12 over up to ~1.4M pixels; ranking is what matters here).
  const foundLab: Lab[] = found.map((c) => rgbToLab(...c));
  const cache = new Map<number, number>();
  const labels = new Uint8Array(n).fill(NO_LABEL);
  for (let i = 0; i < n; i++) {
    if (!fg[i]) continue;
    const key = (rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2];
    let k = cache.get(key);
    if (k === undefined) {
      const lab = rgbToLab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
      let bd = Infinity;
      k = 0;
      foundLab.forEach((fl, j) => {
        const d = (lab[0] - fl[0]) ** 2 + (lab[1] - fl[1]) ** 2 + (lab[2] - fl[2]) ** 2;
        if (d < bd) {
          bd = d;
          k = j;
        }
      });
      k = foundToFinal[k];
      cache.set(key, k);
    }
    labels[i] = k;
  }

  // 4. 3x3 plurality filter over foreground pixels (kills isolated pixels and 1 px lines).
  const smoothed = labels.slice();
  const counts = new Int32Array(finalThreads.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (labels[i] === NO_LABEL) continue;
      counts.fill(0);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const l = labels[yy * w + xx];
          if (l !== NO_LABEL) counts[l]++;
        }
      }
      let best = labels[i];
      for (let l = 0; l < counts.length; l++) if (counts[l] > counts[best]) best = l;
      smoothed[i] = best;
    }
  }

  // 5. Order by usage, remap, build the preview.
  const usage = new Int32Array(finalThreads.length);
  for (let i = 0; i < n; i++) if (smoothed[i] !== NO_LABEL) usage[smoothed[i]]++;
  const order = [...finalThreads.keys()].filter((k) => usage[k] > 0).sort((a, b) => usage[b] - usage[a] || a - b);
  const remap = new Uint8Array(finalThreads.length).fill(NO_LABEL);
  order.forEach((old, nw) => (remap[old] = nw));
  const total = usage.reduce((s, v) => s + v, 0) || 1;
  const palette: PaletteChip[] = order.map((old) => ({
    thread: finalThreads[old],
    sourceHex: sourceHex[old],
    share: usage[old] / total,
  }));
  const out = new Uint8Array(n);
  const preview = new Uint8ClampedArray(n * 4);
  const rgbs = palette.map((c) => hexToRgb(c.thread.hex));
  for (let i = 0; i < n; i++) {
    const l = smoothed[i] === NO_LABEL ? NO_LABEL : remap[smoothed[i]];
    out[i] = l;
    if (l !== NO_LABEL) {
      preview[i * 4] = rgbs[l][0];
      preview[i * 4 + 1] = rgbs[l][1];
      preview[i * 4 + 2] = rgbs[l][2];
      preview[i * 4 + 3] = 255;
    }
  }
  return { width: w, height: h, labels: out, palette, image: { width: w, height: h, data: preview } };
}
