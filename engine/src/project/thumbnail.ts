import type { Design } from "../model";
import { designToStitchPlan } from "../stitch/generate";
import { planThumbnailPng, type ThumbnailOptions } from "./png";

export { encodePngRgba, planThumbnailPng, type ThumbnailOptions } from "./png";

/** Thumbnail for a design (generates its stitches first). An empty design gives a blank card. */
export function designThumbnailPng(design: Design, options: ThumbnailOptions = {}): Uint8Array {
  return planThumbnailPng(designToStitchPlan(design), options);
}
