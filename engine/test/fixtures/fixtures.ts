import type { ImageDataLike } from "../../src/autodigitize/types";

/** Procedural test artwork. Anti-aliased (4x4 supersampling) so the pipeline sees realistic edges. */

type RGB = [number, number, number];
interface Layer {
  color: RGB;
  /** True where this layer covers the point. */
  inside: (x: number, y: number) => boolean;
  /** Paint transparent instead of a colour (punches a hole through everything below). */
  erase?: boolean;
}

function render(w: number, h: number, bg: RGB | null, layers: Layer[]): ImageDataLike {
  const data = new Uint8ClampedArray(w * h * 4);
  const S = 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = bg ? bg[0] : 0;
      let g = bg ? bg[1] : 0;
      let b = bg ? bg[2] : 0;
      let a = bg ? 1 : 0;
      for (const l of layers) {
        let n = 0;
        for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) if (l.inside(x + (sx + 0.5) / S, y + (sy + 0.5) / S)) n++;
        const cov = n / (S * S);
        if (cov === 0) continue;
        if (l.erase) {
          a *= 1 - cov;
        } else {
          const na = a + cov * (1 - a);
          r = (r * a * (1 - cov) + l.color[0] * cov) / na;
          g = (g * a * (1 - cov) + l.color[1] * cov) / na;
          b = (b * a * (1 - cov) + l.color[2] * cov) / na;
          a = na;
        }
      }
      const i = (y * w + x) * 4;
      data[i] = Math.round(r);
      data[i + 1] = Math.round(g);
      data[i + 2] = Math.round(b);
      data[i + 3] = Math.round(a * 255);
    }
  }
  return { width: w, height: h, data };
}

const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
const stroke = (ax: number, ay: number, bx: number, by: number, width: number) => (x: number, y: number) =>
  segDist(x, y, ax, ay, bx, by) <= width / 2;

const NAVY: RGB = [27, 58, 138];
const RED: RGB = [237, 23, 31];
const GOLD: RGB = [232, 169, 0];
const BLACK: RGB = [12, 12, 12];
const WHITE: RGB = [255, 255, 255];

/** 2 colours on white: a navy "K" built from 4.4 mm strokes plus a red bar. Opaque background. */
export function kLogo(): ImageDataLike {
  const sw = 22;
  return render(300, 300, WHITE, [
    { color: NAVY, inside: stroke(80, 50, 80, 230, sw) },
    { color: NAVY, inside: stroke(80, 150, 205, 52, sw) },
    { color: NAVY, inside: stroke(125, 128, 215, 230, sw) },
    { color: RED, inside: (x, y) => x >= 60 && x <= 250 && y >= 250 && y <= 268 },
  ]);
}

/** 3 colours on a transparent background; the red centre has a see-through hole. */
export function badge(): ImageDataLike {
  const c = 150;
  const disc = (r: number) => (x: number, y: number) => Math.hypot(x - c, y - c) <= r;
  return render(300, 300, null, [
    { color: NAVY, inside: disc(135) },
    { color: GOLD, inside: disc(112) },
    { color: NAVY, inside: disc(95) },
    { color: RED, inside: disc(80) },
    { color: WHITE, erase: true, inside: disc(30) },
  ]);
}

/** One colour on white: a 1.4 mm wavy line, a 0.6 mm circle outline and a 0.4 mm diagonal. */
export function thinLines(): ImageDataLike {
  return render(300, 300, WHITE, [
    {
      color: BLACK,
      inside: (x, y) => {
        if (x < 30 || x > 270) return false;
        const wy = 70 + 30 * Math.sin(((x - 30) / 240) * Math.PI * 4);
        // Distance to the curve approximated vertically, corrected for slope.
        const slope = ((30 * Math.PI * 4) / 240) * Math.cos(((x - 30) / 240) * Math.PI * 4);
        return Math.abs(y - wy) / Math.sqrt(1 + slope * slope) <= 3.5;
      },
    },
    { color: BLACK, inside: (x, y) => Math.abs(Math.hypot(x - 150, y - 190) - 50) <= 1.5 },
    { color: BLACK, inside: stroke(40, 270, 260, 130, 2) },
  ]);
}

export const FIXTURES: { name: string; make: () => ImageDataLike }[] = [
  { name: "k-logo", make: kLogo },
  { name: "badge", make: badge },
  { name: "thin-lines", make: thinLines },
];
