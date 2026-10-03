import {
  autoDigitize,
  autoDigitizeSvg,
  designToPes,
  designToStitchPlan,
  planStats,
  validatePlan,
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
  const { plan, warnings } = validatePlan(designToStitchPlan(design), design.hoop);
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
