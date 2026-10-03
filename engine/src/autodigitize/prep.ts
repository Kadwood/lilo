import type { ImageDataLike } from "./types";

export interface Prepped {
  width: number;
  height: number;
  /** RGB, 3 bytes per pixel, alpha flattened onto the background (or white). */
  rgb: Uint8Array;
  /** 1 = foreground (to be stitched), 0 = background. */
  fg: Uint8Array;
  /** The detected background colour, or null (transparent or none found). */
  background: [number, number, number] | null;
  hadTransparency: boolean;
}

/** Box-filter downscale (area average, alpha-weighted). Returns the input when it already fits. */
export function downscale(img: ImageDataLike, maxSide: number): ImageDataLike {
  const { width: w, height: h, data } = img;
  const longest = Math.max(w, h);
  if (longest <= maxSide) return img;
  const f = maxSide / longest;
  const nw = Math.max(1, Math.round(w * f));
  const nh = Math.max(1, Math.round(h * f));
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor((y * h) / nh);
    const y1 = Math.max(y0 + 1, Math.ceil(((y + 1) * h) / nh));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor((x * w) / nw);
      const x1 = Math.max(x0 + 1, Math.ceil(((x + 1) * w) / nw));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * w + xx) * 4;
          const al = data[i + 3];
          r += data[i] * al;
          g += data[i + 1] * al;
          b += data[i + 2] * al;
          a += al;
          n++;
        }
      }
      const o = (y * nw + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width: nw, height: nh, data: out };
}

const dist2 = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) =>
  (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;

/** Max RGB distance for "same as the background". */
const BG_TOLERANCE = 36;

/**
 * Find the background colour from the four corners: the colour most corners agree on, accepted only
 * if most of the image border matches it (so a photo with one dark corner is not "keyed").
 */
function detectBackground(img: ImageDataLike): [number, number, number] | null {
  const { width: w, height: h, data } = img;
  const patch = Math.max(1, Math.min(3, Math.floor(Math.min(w, h) / 20)));
  const corners: [number, number, number][] = [];
  for (const [cx, cy] of [
    [0, 0],
    [w - patch, 0],
    [0, h - patch],
    [w - patch, h - patch],
  ]) {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = cy; y < cy + patch; y++) {
      for (let x = cx; x < cx + patch; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 3] < 128) continue;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
      }
    }
    if (n > 0) corners.push([Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
  }
  let best: [number, number, number] | null = null;
  let bestVotes = 1;
  for (const c of corners) {
    const votes = corners.filter((o) => dist2(c[0], c[1], c[2], o[0], o[1], o[2]) <= BG_TOLERANCE ** 2).length;
    if (votes > bestVotes) {
      bestVotes = votes;
      best = c;
    }
  }
  if (!best) return null;
  // Verify against the whole border.
  let match = 0;
  let total = 0;
  const probe = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    total++;
    if (data[i + 3] >= 128 && dist2(best![0], best![1], best![2], data[i], data[i + 1], data[i + 2]) <= BG_TOLERANCE ** 2) match++;
  };
  for (let x = 0; x < w; x++) {
    probe(x, 0);
    probe(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    probe(0, y);
    probe(w - 1, y);
  }
  return match / total >= 0.6 ? best : null;
}

/**
 * Flatten alpha and (optionally) separate background from foreground.
 *
 * - If >= 0.5% of pixels are transparent (alpha < 128), every transparent pixel is background.
 * - Otherwise the dominant corner colour is the background: every pixel near it is background,
 *   enclosed counters and eyes included (they would show the fabric, so there is nothing to stitch).
 */
export function prep(img: ImageDataLike, removeBackground: boolean): Prepped {
  const { width: w, height: h, data } = img;
  const n = w * h;
  let transparent = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 128) transparent++;
  const hadTransparency = transparent / n >= 0.005;

  const background = hadTransparency ? null : removeBackground ? detectBackground(img) : null;
  const fg = new Uint8Array(n).fill(1);

  if (removeBackground && hadTransparency) {
    for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 128) fg[i] = 0;
  } else if (removeBackground && background) {
    // Every pixel near the background colour is fabric showing through (including enclosed
    // counters and eyes): nothing to stitch there.
    const [br, bg, bb] = background;
    for (let i = 0; i < n; i++) {
      if (dist2(br, bg, bb, data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) <= BG_TOLERANCE ** 2) fg[i] = 0;
    }
  }

  // Flatten alpha onto the background colour (or white).
  const [fr, fgc, fb] = background ?? [255, 255, 255];
  const rgb = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    rgb[i * 3] = Math.round(data[i * 4] * a + fr * (1 - a));
    rgb[i * 3 + 1] = Math.round(data[i * 4 + 1] * a + fgc * (1 - a));
    rgb[i * 3 + 2] = Math.round(data[i * 4 + 2] * a + fb * (1 - a));
  }
  let any = false;
  for (let i = 0; i < n && !any; i++) if (fg[i]) any = true;
  if (!any) throw new Error("No artwork found: the image is all background.");
  return { width: w, height: h, rgb, fg, background, hadTransparency };
}
