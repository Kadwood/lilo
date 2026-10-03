import type { PathGuide } from "@lilo/engine/lettering";

/** How the text sits: on a straight baseline, or round the top or the bottom of a circle. */
export type CurveMode = "straight" | "up" | "down";

export interface Curve {
  mode: CurveMode;
  /** Radius of the circle the baseline follows, mm. */
  radiusMm: number;
}

export const DEFAULT_CURVE_RADIUS_MM = 30;
export const CURVE_RADIUS_RANGE = { min: 10, max: 150 } as const;
/** The arc is long enough for any sensible word; the text is centred on its middle. */
const SPAN_DEG = 300;

/**
 * The engine's text-on-path guide for a curve, or undefined for straight text. Angles are screen
 * space (y down): -90 is the top of the circle. "Arc up" reads left to right over the top with the
 * letters standing outside the circle; "Arc down" reads left to right along the bottom with the
 * letters standing inside it.
 */
export function curveGuide(c: Curve): PathGuide | undefined {
  if (c.mode === "straight") return undefined;
  const r = Math.max(CURVE_RADIUS_RANGE.min, Math.min(CURVE_RADIUS_RANGE.max, c.radiusMm));
  const half = SPAN_DEG / 2;
  return c.mode === "up" ? { kind: "arc", center: [0, 0], radiusMm: r, startDeg: -90 - half, endDeg: -90 + half } : { kind: "arc", center: [0, 0], radiusMm: r, startDeg: 90 + half, endDeg: 90 - half };
}

/** Read a stored `TextBlock.path` back into the form's values (anything unknown is straight). */
export function curveOf(path: unknown): Curve {
  const p = path as Partial<Extract<PathGuide, { kind: "arc" }>> | undefined;
  if (p && p.kind === "arc" && typeof p.radiusMm === "number" && typeof p.startDeg === "number" && typeof p.endDeg === "number") {
    return { mode: p.startDeg < p.endDeg ? "up" : "down", radiusMm: p.radiusMm };
  }
  return { mode: "straight", radiusMm: DEFAULT_CURVE_RADIUS_MM };
}
