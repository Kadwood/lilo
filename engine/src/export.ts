import type { Design, Hoop } from "./model";
import { applyOrigin, CENTER_ORIGIN, writePes, type Origin } from "./pes";
import { writeEmbroidery, type FormatExt } from "./formats";
import { designToStitchPlan, planStats, validatePlan, type PlanStats, type PlanWarning, type StitchPlan } from "./stitch";

export interface ExportOptions {
  /** Which point of the stitched area sits on the machine origin. Default centre. */
  origin?: Origin;
  /** Name embedded in the file (first 8 characters are used). */
  label?: string;
  hoop?: Hoop;
  /** Tie stitch length in mm (0 = none). Default 0.4. */
  lockStitchMm?: number;
}

export interface ExportResult {
  /** The validated plan with the origin applied (what the machine will sew). */
  plan: StitchPlan;
  warnings: PlanWarning[];
  stats: PlanStats;
  pes: Uint8Array;
}

/** Design -> stitch plan -> validate/fix -> origin -> PES bytes. The one call Export and Send use. */
export function designToPes(design: Design, options: ExportOptions = {}): ExportResult {
  const { plan, warnings } = validatePlan(designToStitchPlan(design), options.hoop ?? design.hoop, { lockStitchMm: options.lockStitchMm });
  const placed = applyOrigin(plan, options.origin ?? CENTER_ORIGIN);
  return { plan: placed, warnings, stats: planStats(placed), pes: writePes(placed, { label: options.label }) };
}

/** Same as `designToPes` for any format Lilo writes (PES, DST, JEF, VP3, EXP, XXX, U01, PEC, HUS, VIP, TBF, G-code). */
export function designToEmbroidery(
  design: Design,
  ext: FormatExt,
  options: ExportOptions = {},
): { bytes: Uint8Array; plan: StitchPlan; warnings: PlanWarning[]; stats: PlanStats } {
  const { plan, warnings } = validatePlan(designToStitchPlan(design), options.hoop ?? design.hoop, { lockStitchMm: options.lockStitchMm });
  const placed = applyOrigin(plan, options.origin ?? CENTER_ORIGIN);
  return { plan: placed, warnings, stats: planStats(placed), bytes: writeEmbroidery(placed, ext, { label: options.label }) };
}
