import { DEFAULT_SATIN_PARAMS, type SatinParams } from "../model";
import type { SewingEngineParams } from "../presets";
import { satinTraits } from "./strokes";

/**
 * Per-column satin parameters. `legacy` (Standard) is the original fixed rule set; `width-scaled`
 * (Premium) follows what commercial digitizers do, see the sources in `presets/sewing.ts`:
 *
 * - spacing: the line pitch eases from `satinPitchNarrowMm` (columns up to 1 mm) to `satinPitchWideMm`
 *   (5 mm and wider); stitchjs wants twice that as `densityMm` (ladder rows, two stitch lines each);
 * - pull compensation per side grows with width, 0.15 mm on a hairline column to 0.30 mm at 6 mm
 *   [TD-PULL: 0.15-0.2 mm at 2-4 mm, 0.25-0.3 mm at 5-7 mm], scaled by the fabric (knit 1.5x);
 * - underlay by width [EH-WILCOM, EH-THEORY, IS-SATIN]: no underlay under 1 mm, centre walk to 2 mm, edge walk to 3.5 mm,
 *   edge walk + zig-zag above, thresholds shifted by the fabric (heavier on pile and knit);
 * - short stitches on the inside of curves [IS-SRC: distance 0.25 mm, inset 15 %], and columns wider
 *   than 5 mm split so stitches stay flat and snag-free.
 */

/** Rows in a stitchjs satin are ladder pairs: two stitch lines per `densityMm`. */
export const satinDensityFromPitch = (pitchMm: number): number => 2 * pitchMm;
export const satinPitchFromDensity = (densityMm: number): number => densityMm / 2;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Line pitch (mm between stitch lines) for a column of width `w`. */
export function satinPitchMm(w: number, p: Pick<SewingEngineParams, "satinPitchNarrowMm" | "satinPitchWideMm">): number {
  const t = clamp01((w - 1) / 4);
  return round3(p.satinPitchNarrowMm + (p.satinPitchWideMm - p.satinPitchNarrowMm) * t);
}

/** Pull compensation per side (mm) for a column of width `w`. */
export function satinPullCompMm(w: number, p: Pick<SewingEngineParams, "pullCompFactor">): number {
  return round3(Math.min(0.3, 0.12 + 0.03 * w) * p.pullCompFactor);
}

/** Edge-walk / zig-zag inset (mm): never so deep it crosses the middle of a narrow column. */
const underlayInset = (w: number): number => round3(Math.min(0.4, 0.2 * w));

const HAIRLINE_NO_UNDERLAY_MM = 1;

/** Underlay plan for a column of width `w`: type, plus the stitchjs knobs. */
export function satinUnderlayFor(w: number, p: Pick<SewingEngineParams, "underlayBias" | "zigzagUnderlay">): Pick<SatinParams, "underlay" | "underlayStitchMm" | "underlayInsetMm" | "underlayZigzagMm"> {
  const centreMax = 2 * p.underlayBias;
  const contourMax = 3.5 * p.underlayBias;
  // Hairline satin (about 1 mm and under) has no room for a walk: it would only add a second layer of
  // needle holes in a column the width of one stitch pair, and the knots where hairlines cross.
  if (w < HAIRLINE_NO_UNDERLAY_MM) return { underlay: "none" };
  if (w < centreMax) return { underlay: "center", underlayStitchMm: 2 };
  if (w < contourMax || !p.zigzagUnderlay) return { underlay: "contour", underlayStitchMm: 2, underlayInsetMm: underlayInset(w) };
  return { underlay: "contour-zigzag", underlayStitchMm: 2, underlayInsetMm: underlayInset(w), underlayZigzagMm: w >= 5.5 ? 2 : 2.5 };
}

/** The `SatinParams` an auto-digitized column of width `w` gets. */
export function satinParamsFor(w: number, p: SewingEngineParams): SatinParams {
  const width = Math.round(w * 10) / 10;
  if (p.satinMode === "legacy") {
    const t = satinTraits(w);
    return { ...DEFAULT_SATIN_PARAMS, widthMm: width, pullCompMm: round3(t.pull * p.pullCompFactor), underlay: t.underlay };
  }
  const split = p.splitMaxWidthMm ? { splitMaxWidthMm: p.splitMaxWidthMm, staggerCycles: 3 } : {};
  return {
    ...DEFAULT_SATIN_PARAMS,
    densityMm: satinDensityFromPitch(satinPitchMm(w, p)),
    widthMm: width,
    pullCompMm: satinPullCompMm(w, p),
    ...satinUnderlayFor(w, p),
    ...split,
    shortStitches: p.shortStitches,
  };
}
