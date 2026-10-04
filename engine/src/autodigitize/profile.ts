import { DEFAULT_SATIN_PARAMS, type SatinParams } from "../model";
import type { SewingEngineParams } from "../presets";
import { DEFAULTS } from "../presets/defaults";
import { underlayTypeFor } from "./underlay";

/**
 * Per-column satin parameters. `legacy` (Standard) is a fixed 0.40 mm density with the shared underlay
 * rule; `width-scaled` (Premium) follows what commercial digitizers do (sources in `presets/sewing.ts`
 * and `presets/defaults.ts`):
 *
 * - density (mm between needle penetrations on the same side, 40 wt): 0.45 on columns up to 1.5 mm
 *   (small text), easing to 0.38 from 2.5 to 5 mm, opening to 0.42 by 8 mm; never tighter than 0.35;
 *   60 wt and the fabric scale it;
 * - pull compensation 0.20 mm per side on woven, scaled by the fabric (knit 1.8x);
 * - underlay by width: centre walk under 2.5 mm, centre + edge to 4, edge + zig-zag to 6, double zig-zag
 *   above; no underlay on hairline satin; thresholds shift with the fabric;
 * - short stitches on the inside of curves [IS-SRC: distance 0.25 mm, inset 15 %], and columns wider
 *   than 8 mm split so stitches stay flat and snag-free.
 */

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Satin density (mm, same-side spacing) for a column of width `w`. */
export function satinDensityMm(w: number, p: Pick<SewingEngineParams, "satinDensityNarrowMm" | "satinDensityMediumMm" | "satinDensityWideMm">): number {
  const b = DEFAULTS.satin.densityBands;
  const lerp = (a: number, c: number, t: number) => a + (c - a) * clamp01(t);
  if (w <= b.narrowUpToMm) return round3(p.satinDensityNarrowMm);
  if (w < b.mediumFromMm) return round3(lerp(p.satinDensityNarrowMm, p.satinDensityMediumMm, (w - b.narrowUpToMm) / (b.mediumFromMm - b.narrowUpToMm)));
  if (w <= b.mediumToMm) return round3(p.satinDensityMediumMm);
  return round3(lerp(p.satinDensityMediumMm, p.satinDensityWideMm, (w - b.mediumToMm) / (b.wideFromMm - b.mediumToMm)));
}

/** Pull compensation per side (mm) for a column. Premium is flat 0.20 on woven; the fabric scales it. */
export function satinPullCompMm(_w: number, p: Pick<SewingEngineParams, "pullCompFactor">): number {
  return round3(DEFAULTS.satin.premiumPullCompMm * p.pullCompFactor);
}

/** Edge-walk / zig-zag inset (mm): never so deep it crosses the middle of a narrow column. */
const underlayInset = (w: number): number => round3(Math.min(DEFAULTS.satin.premiumUnderlayInsetMm, 0.2 * w));

/** Underlay plan for a column of width `w`: type, plus the stitchjs knobs. */
export function satinUnderlayFor(
  w: number,
  p: Pick<SewingEngineParams, "underlayBias" | "zigzagUnderlay">,
  noneBelowMm: number = DEFAULTS.satin.premiumNoUnderlayBelowMm,
): Pick<SatinParams, "underlay" | "underlayStitchMm" | "underlayInsetMm" | "underlayZigzagMm"> {
  const underlay = underlayTypeFor(w, p.underlayBias, p.zigzagUnderlay, noneBelowMm);
  if (underlay === "none") return { underlay };
  const stitch = { underlayStitchMm: DEFAULTS.satin.underlayStitchMm };
  if (underlay === "center") return { underlay, ...stitch };
  const inset = { underlayInsetMm: underlayInset(w) };
  if (underlay === "contour-zigzag" || underlay === "double-zigzag") return { underlay, ...stitch, ...inset, underlayZigzagMm: underlay === "double-zigzag" ? DEFAULTS.satin.doubleZigzagSpacingMm : DEFAULTS.satin.zigzagSpacingMm };
  return { underlay, ...stitch, ...inset };
}

/** The `SatinParams` an auto-digitized column of width `w` gets. */
export function satinParamsFor(w: number, p: SewingEngineParams): SatinParams {
  const width = Math.round(w * 10) / 10;
  if (p.satinMode === "legacy") {
    // Standard: fixed density, flat pull (scaled by fabric), the shared underlay rule with no hairline exemption.
    const u = satinUnderlayFor(w, p, 0);
    if (u.underlayInsetMm !== undefined) u.underlayInsetMm = round3(Math.min(DEFAULTS.satin.underlayInsetMm, 0.2 * w));
    const split = p.splitMaxWidthMm ? { splitMaxWidthMm: p.splitMaxWidthMm } : {};
    return { ...DEFAULT_SATIN_PARAMS, densityMm: p.satinDensityStandardMm, widthMm: width, pullCompMm: round3(DEFAULTS.satin.pullCompMm * p.pullCompFactor), ...u, ...split };
  }
  const split = p.splitMaxWidthMm ? { splitMaxWidthMm: p.splitMaxWidthMm, staggerCycles: 3 } : {};
  return {
    ...DEFAULT_SATIN_PARAMS,
    densityMm: satinDensityMm(w, p),
    widthMm: width,
    pullCompMm: satinPullCompMm(w, p),
    ...satinUnderlayFor(w, p),
    ...split,
    shortStitches: p.shortStitches,
  };
}
