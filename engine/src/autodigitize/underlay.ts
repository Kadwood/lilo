import type { SatinUnderlay } from "../model";
import { DEFAULTS } from "../presets/defaults";

/**
 * Satin underlay type by column width (mm), the one rule Standard, Premium and lettering share.
 * [EH-THEORY][EH-WILCOM][IS-SATIN] and the calibration table: under 2.5 mm centre walk, 2.5 to 4
 * centre + edge walk, 4 to 6 edge walk + zig-zag, over 6 double zig-zag. `bias` scales the thresholds
 * (below 1 = heavier underlay sooner, for knit and pile). `zigzag` false (leather) stops at edge walk.
 * `noneBelow` > 0 drops underlay on hairline satin (Premium: no room for a walk).
 */
export function underlayTypeFor(w: number, bias: number, zigzag: boolean, noneBelow: number): SatinUnderlay {
  const u = DEFAULTS.satin.underlayBands;
  if (w < noneBelow) return "none";
  if (w < u.centreBelowMm * bias) return "center";
  if (w < u.centreEdgeBelowMm * bias) return "center-contour";
  if (!zigzag) return "contour";
  if (w < u.edgeZigzagBelowMm * bias) return "contour-zigzag";
  return "double-zigzag";
}
