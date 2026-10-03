import { init as initStitch } from "@stitchables/stitchjs";
import { DEFAULT_CATALOGUE_ID, getCatalogue } from "../threads";
import { regionsToDesign, regionsTransform } from "./cleanup";
import { buildTraceRegions } from "./traceRegions";
import { prep, downscale } from "./prep";
import { quantize } from "./quantize";
import { svgToRegions, tracedSvgToRegions } from "./regions";
import { parseSvgDocument } from "./svg";
import { traceQuantized, DEFAULT_TRACE_CONFIG } from "./trace";
import {
  DEFAULT_AUTODIGITIZE_OPTIONS,
  type AutoDigitizeOptions,
  type AutoDigitizeResult,
  type ImageDataLike,
  type ProgressCallback,
} from "./types";

export * from "./types";
export { initVtracer, isVtracerInitialised } from "./trace";
export { regionsToDesign, regionsTransform, RUN_MAX_WIDTH_MM, SATIN_MAX_WIDTH_MM, type UnitsToMm } from "./cleanup";
export { parseSvgDocument } from "./svg";

function resolve(options: Partial<AutoDigitizeOptions>) {
  const o: AutoDigitizeOptions = { ...DEFAULT_AUTODIGITIZE_OPTIONS, ...options };
  o.colors = Math.max(2, Math.min(12, Math.round(o.colors)));
  const threads = o.threads ?? getCatalogue(o.catalogueId || DEFAULT_CATALOGUE_ID).threads;
  return { o, threads };
}

/**
 * Auto-digitize a raster image into a `Design`.
 *
 *   prep (downscale, background key) -> quantise (image-q) + snap to threads -> trace (vtracer)
 *   -> cleanup (px->mm, simplify, merge specks, classify run/satin/fill, order) -> Design
 *
 * Each stage is a pure function; this wires them together and reports progress for the UI. The
 * vtracer WASM must be loaded first (`initVtracer(url)` in browsers, `initVtracerNode()` from
 * `@lilo/engine/node` in Node).
 */
export async function autoDigitize(
  image: ImageDataLike,
  options: Partial<AutoDigitizeOptions> = {},
  onProgress?: ProgressCallback,
): Promise<AutoDigitizeResult> {
  const { o, threads } = resolve(options);
  await initStitch(); // loads the straight-skeleton WASM used for satin/run centre lines

  const small = downscale(image, o.maxImageSide);
  const p = prep(small, o.removeBackground);
  {
    const rgba = new Uint8ClampedArray(p.width * p.height * 4);
    for (let i = 0; i < p.width * p.height; i++) {
      rgba[i * 4] = p.rgb[i * 3];
      rgba[i * 4 + 1] = p.rgb[i * 3 + 1];
      rgba[i * 4 + 2] = p.rgb[i * 3 + 2];
      rgba[i * 4 + 3] = p.fg[i] ? 255 : 0;
    }
    onProgress?.({ stage: "prep", image: { width: p.width, height: p.height, data: rgba }, background: p.background });
  }

  const q = quantize(p, o.colors, threads);
  onProgress?.({ stage: "quantize", image: q.image, palette: q.palette });

  // Speckle filter in pixels: ~1/8 of the minimum region, using the size the image will be stitched at.
  const mmPerPx = (o.widthMm ?? o.heightMm ?? 60) / Math.max(p.width, p.height);
  const speckle = Math.max(DEFAULT_TRACE_CONFIG.filterSpeckle, Math.floor(o.minRegionMm2 / (mmPerPx * mmPerPx) / 8));
  const { svg } = traceQuantized(q, { ...DEFAULT_TRACE_CONFIG, filterSpeckle: speckle });
  const regions = tracedSvgToRegions(svg);
  const imageToMm = regionsTransform(regions, o);
  onProgress?.({ stage: "trace", svg, width: p.width, height: p.height, imageToMm });

  const design = regionsToDesign(regions, threads, o);
  onProgress?.({ stage: "cleanup", design });
  onProgress?.({ stage: "done", design });
  const traceRegions = buildTraceRegions(regions, threads, imageToMm);
  return { design, svg, palette: q.palette, imageWidth: p.width, imageHeight: p.height, imageToMm, imageOrigin: [0, 0], traceRegions };
}

/**
 * Digitize an SVG document: no tracing, the fills/strokes become regions directly, then the same
 * cleanup as raster input. Colours are snapped to threads but not reduced to `options.colors`.
 */
export async function autoDigitizeSvg(
  svgText: string,
  options: Partial<AutoDigitizeOptions> = {},
  onProgress?: ProgressCallback,
): Promise<AutoDigitizeResult> {
  const { o, threads } = resolve(options);
  await initStitch();
  const doc = parseSvgDocument(svgText);
  const regions = svgToRegions(doc);
  if (regions.length === 0) throw new Error("The SVG has no filled or stroked shapes to digitize.");
  const design = regionsToDesign(regions, threads, o);
  const palette = design.threads.map((t) => ({
    thread: threads.find((e) => e.code === t.code && e.line === t.line)!,
    sourceHex: t.hex,
    share: 1 / design.threads.length,
  }));
  onProgress?.({ stage: "cleanup", design });
  onProgress?.({ stage: "done", design });
  const imageToMm = regionsTransform(regions, o);
  return { design, svg: svgText, palette, imageWidth: doc.width, imageHeight: doc.height, imageToMm, imageOrigin: [doc.minX, doc.minY], traceRegions: buildTraceRegions(regions, threads, imageToMm) };
}
