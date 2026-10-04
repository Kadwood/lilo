import {
  applyOrigin,
  autoDigitize,
  autoDigitizeSvg,
  CENTER_ORIGIN,
  convert as convertFormat,
  designThumbnailPng,
  designToEmbroidery,
  designToPes,
  planThumbnailPng,
  pixelArtToStitchPlan,
  planToManualDesign,
  readEmbroidery as readEmbroideryFile,
  stitchPlanToManualObjects,
  writeEmbroidery,
  type ConvertWarning,
  type FormatExt,
  type Hoop,
  type PixelArt,
  type PixelStitchOptions,
  type Origin,
  type Thread,
  designToStitchPlan,
  planStats,
  validatePlan,
  validateForMachine,
  type AutoDigitizeOptions,
  type AutoDigitizeResult,
  type Design,
  type ExportOptions,
  type ExportResult,
  type ImageDataLike,
  type PlanStats,
  type PlanWarning,
  type DesignObject,
  type ShapeOpRequest,
  runShapeOp,
  type StageEvent,
  type StitchPlan,
} from "@lilo/engine";

/**
 * The engine operations the editor needs, as plain functions. The Web Worker and the in-thread
 * fallback (tests, no-Worker environments) both just call these.
 */

export type DigitizeSource =
  | { kind: "raster"; image: ImageDataLike }
  | { kind: "svg"; text: string };

/** A plan that is safe to sew and shows its numbers. */
export interface PlanResult {
  plan: StitchPlan;
  stats: PlanStats;
  warnings: PlanWarning[];
}

export interface DigitizeResponse extends AutoDigitizeResult, PlanResult {}

export interface ExportResponse {
  pes: Uint8Array;
  stats: PlanStats;
  warnings: PlanWarning[];
}

export function buildPlan(design: Design): PlanResult {
  const { plan, warnings } = validatePlan(designToStitchPlan(design), design.hoop, { quality: design.sewing?.quality });
  return { plan, stats: planStats(plan), warnings };
}

export async function runDigitize(
  source: DigitizeSource,
  options: Partial<AutoDigitizeOptions>,
  onProgress?: (e: StageEvent) => void,
): Promise<DigitizeResponse> {
  const result =
    source.kind === "svg"
      ? await autoDigitizeSvg(source.text, options, onProgress)
      : await autoDigitize(source.image, options, onProgress);
  return { ...result, ...buildPlan(result.design) };
}

export function runExport(design: Design, options: ExportOptions): ExportResponse {
  const r: ExportResult = designToPes(design, options);
  return { pes: r.pes, stats: r.stats, warnings: r.warnings };
}

/** Boolean shape ops (knife, cut hole) need jsts, so they run where the engine runs. */
export function runShape(req: ShapeOpRequest): DesignObject[] {
  return runShapeOp(req);
}

// ---- the rest of the screens' work: formats, converter, pixel art, thumbnails ---------------------
// One table so the Web Worker and the in-thread engine share it (see `EngineClient.call`).

export interface FormatExportResponse {
  bytes: Uint8Array;
  plan: StitchPlan;
  stats: PlanStats;
  warnings: PlanWarning[];
}

export interface ConvertResponse {
  bytes: Uint8Array;
  warnings: ConvertWarning[];
  stats: PlanStats;
}

export interface ReadFileResponse {
  design: Design;
  warnings: ConvertWarning[];
  stats: PlanStats;
  name: string | null;
}

export interface PixelObjectsResponse {
  threads: Thread[];
  objects: DesignObject[];
  warnings: PlanWarning[];
}

export const extraOps = {
  /** The design in any format Lilo writes. */
  exportFormat(design: Design, ext: FormatExt, options: ExportOptions): FormatExportResponse {
    const r = designToEmbroidery(design, ext, options);
    return { bytes: r.bytes, plan: r.plan, stats: r.stats, warnings: r.warnings };
  },
  /** The design as a PNG picture of its stitches (square, `size` px, transparent corners not needed). */
  exportImage(design: Design, size: number): Uint8Array {
    return designThumbnailPng(design, { size, thickness: Math.max(1, Math.round(size / 700)) });
  },
  /** Embroidery file A to file B, with what the target format couldn't keep. */
  convertEmbroidery(bytes: Uint8Array, from: string, to: FormatExt, label?: string): ConvertResponse {
    const r = convertFormat(bytes, from, to, label ? { label } : {});
    return { bytes: r.bytes, warnings: r.warnings, stats: planStats(r.plan) };
  },
  /** An embroidery file as a design of manual-stitch objects (every needle drop kept). */
  readEmbroidery(bytes: Uint8Array, ext: string): ReadFileResponse {
    const r = readEmbroideryFile(bytes, ext);
    return { design: planToManualDesign(r.plan), warnings: r.warnings, stats: planStats(r.plan), name: r.name ?? null };
  },
  designThumbnail(design: Design, size: number): Uint8Array {
    return designThumbnailPng(design, { size });
  },
  /** The stitches of a pixel grid, checked against the hoop, for the live preview. */
  pixelPlan(art: PixelArt, hoop: Hoop, options: PixelStitchOptions): PlanResult {
    const { plan, warnings } = validatePlan(pixelArtToStitchPlan(art, options), hoop);
    return { plan, stats: planStats(plan), warnings };
  },
  /** A pixel grid in any format. */
  pixelExport(art: PixelArt, ext: FormatExt, hoop: Hoop, options: PixelStitchOptions & { origin?: Origin; label?: string }): FormatExportResponse {
    const { origin, label, ...stitch } = options;
    const { plan, warnings } = validateForMachine(pixelArtToStitchPlan(art, stitch), hoop);
    const placed = applyOrigin(plan, origin ?? CENTER_ORIGIN);
    return { bytes: writeEmbroidery(placed, ext, { label: label ?? "Pixels" }), plan: placed, stats: planStats(placed), warnings };
  },
  /** A pixel grid as a PNG picture of its stitches. */
  pixelImage(art: PixelArt, hoop: Hoop, options: PixelStitchOptions, size: number): FormatExportResponse {
    const { plan, warnings } = validatePlan(pixelArtToStitchPlan(art, options), hoop);
    return { bytes: planThumbnailPng(plan, { size, thickness: Math.max(1, Math.round(size / 700)) }), plan, stats: planStats(plan), warnings };
  },
  /** A pixel grid as manual-stitch objects, to drop into the main design. */
  pixelObjects(art: PixelArt, hoop: Hoop, options: PixelStitchOptions): PixelObjectsResponse {
    const { plan, warnings } = validatePlan(pixelArtToStitchPlan(art, options), hoop);
    const r = stitchPlanToManualObjects(plan, "Pixel art");
    return { threads: r.threads, objects: r.objects, warnings };
  },
};

export type ExtraOps = typeof extraOps;
