/**
 * Actual size: zoom the canvas so 1 mm on screen is 1 mm of real screen. The canvas zoom is CSS pixels
 * per mm, so all that is needed is how many CSS pixels fit in a physical millimetre. Where that comes
 * from, best first: what the user measured (a credit card held to the screen), what the OS reports for
 * the display, and last an assumed 96 CSS px per inch (which is only right for a few screens).
 */
import type { ScreenInfo } from "../platform/types";

export const MM_PER_IN = 25.4;
/** The classic CSS inch. */
export const ASSUMED_PX_PER_MM = 96 / MM_PER_IN;
/** ISO/IEC 7810 ID-1: a credit card, bank card or driving licence. */
export const CARD_WIDTH_MM = 85.6;
export const CARD_HEIGHT_MM = 53.98;

export type ScaleSource = "calibrated" | "display" | "assumed";

export interface ScreenScale {
  pxPerMm: number;
  source: ScaleSource;
}

const sensible = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 40;

/** CSS px per mm, and where the number came from. */
export function resolveScale(calibrated: number | null, screen: Pick<ScreenInfo, "pxPerMm"> | null): ScreenScale {
  if (sensible(calibrated)) return { pxPerMm: calibrated, source: "calibrated" };
  if (sensible(screen?.pxPerMm)) return { pxPerMm: screen.pxPerMm, source: "display" };
  return { pxPerMm: ASSUMED_PX_PER_MM, source: "assumed" };
}

/** The canvas zoom (px per mm) for Actual size. */
export const actualSizeZoom = (scale: ScreenScale): number => scale.pxPerMm;

/** The measured scale from the width in CSS px of a card-shaped box the user matched to a real card. */
export const scaleFromCardWidth = (widthPx: number): number => widthPx / CARD_WIDTH_MM;

/** The width in CSS px a card-shaped box should have at a given scale. */
export const cardWidthPx = (pxPerMm: number): number => CARD_WIDTH_MM * pxPerMm;

/** Should the first-run calibration prompt show? Only when the scale is a guess and the user has not been asked. */
export const shouldAskCalibration = (scale: ScreenScale, alreadyAsked: boolean): boolean => scale.source === "assumed" && !alreadyAsked;

/** "This screen is about 127 ppi" for the dialog (CSS px per inch of physical screen). */
export const pxPerInch = (pxPerMm: number): number => Math.round(pxPerMm * MM_PER_IN);
