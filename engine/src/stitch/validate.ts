import type { Hoop } from "../model";
import { planStats, type PlanStitch, type PlanWarning, type StitchPlan } from "./plan";

/** Longest needle-to-needle distance we allow; longer ones are split. Machines snag above ~12 mm. */
export const MAX_STITCH_MM = 12;
/** Jumps longer than this get a thread trim, so no long floats are left on the fabric. */
export const TRIM_JUMP_MM = 3;
/** PEC/PES moves carry 12-bit deltas (+-204.7 mm); split anything beyond this. */
const MAX_JUMP_MM = 200;
/** Needle penetrations per 1 mm^2 cell above which fabric tends to pucker or thread breaks. */
export const DENSITY_WARN_PER_MM2 = 10;

export interface ValidationOptions {
  maxStitchMm?: number;
  trimJumpMm?: number;
  densityWarnPerMm2?: number;
}

export interface ValidationResult {
  /** The corrected plan (long stitches split, long jumps trimmed). The input is not mutated. */
  plan: StitchPlan;
  /** Generation warnings carried over plus everything found here. */
  warnings: PlanWarning[];
}

/**
 * Make a plan safe to sew and report anything the user should know:
 * - stitches longer than 12 mm are split into equal pieces (warning `stitch-too-long`),
 * - jumps longer than 3 mm become trims; jumps near the PES delta limit are split,
 * - the stitched area is checked against the hoop (warning `outside-hoop`),
 * - penetrations per 1 mm cell above the threshold raise a `density` warning.
 */
export function validatePlan(plan: StitchPlan, hoop: Hoop, options: ValidationOptions = {}): ValidationResult {
  const maxStitch = options.maxStitchMm ?? MAX_STITCH_MM;
  const trimAt = options.trimJumpMm ?? TRIM_JUMP_MM;
  const densityMax = options.densityWarnPerMm2 ?? DENSITY_WARN_PER_MM2;
  const warnings: PlanWarning[] = [...plan.warnings];
  const out: PlanStitch[] = [];

  let split = 0;
  let longest = 0;
  let px = 0;
  let py = 0;
  let havePos = false;
  for (const s of plan.stitches) {
    if (s.type === "colorChange") {
      out.push(s);
      continue;
    }
    const d = havePos ? Math.hypot(s.x - px, s.y - py) : 0;
    if (s.type === "stitch" && d > maxStitch) {
      longest = Math.max(longest, d);
      const n = Math.ceil(d / maxStitch);
      for (let i = 1; i < n; i++) {
        out.push({ ...s, x: px + ((s.x - px) * i) / n, y: py + ((s.y - py) * i) / n, objectIndex: s.objectIndex });
      }
      split++;
      out.push(s);
    } else if (s.type !== "stitch" && d > MAX_JUMP_MM) {
      const n = Math.ceil(d / MAX_JUMP_MM);
      for (let i = 1; i < n; i++) {
        out.push({ ...s, x: px + ((s.x - px) * i) / n, y: py + ((s.y - py) * i) / n, type: "jump" });
      }
      out.push(s.type === "jump" && d > trimAt ? { ...s, type: "trim" } : s);
    } else if (s.type === "jump" && d > trimAt) {
      out.push({ ...s, type: "trim" });
    } else {
      out.push(s);
    }
    px = s.x;
    py = s.y;
    havePos = true;
  }
  if (split > 0) {
    warnings.push({
      code: "stitch-too-long",
      message: `${split} stitch${split === 1 ? "" : "es"} longer than ${maxStitch} mm were split (longest ${longest.toFixed(1)} mm).`,
    });
  }

  const result: StitchPlan = { threads: plan.threads, stitches: out, warnings: [] };
  const stats = planStats(result);
  if (stats.stitchCount === 0) {
    warnings.push({ code: "empty", message: "The design has no stitches." });
  } else if (stats.widthMm > hoop.widthMm || stats.heightMm > hoop.heightMm) {
    warnings.push({
      code: "outside-hoop",
      message: `Design is ${stats.widthMm.toFixed(1)} x ${stats.heightMm.toFixed(1)} mm; the ${hoop.name} hoop is ${hoop.widthMm} x ${hoop.heightMm} mm.`,
    });
  }

  // Density: count needle penetrations per 1 mm grid cell.
  const cells = new Map<string, number>();
  let worst = 0;
  let overCount = 0;
  let worstCell = "";
  for (const s of out) {
    if (s.type !== "stitch") continue;
    const key = `${Math.floor(s.x)},${Math.floor(s.y)}`;
    const n = (cells.get(key) ?? 0) + 1;
    cells.set(key, n);
    if (n > worst) {
      worst = n;
      worstCell = key;
    }
  }
  for (const n of cells.values()) if (n > densityMax) overCount++;
  if (overCount > 0) {
    const [cx, cy] = worstCell.split(",");
    warnings.push({
      code: "density",
      message: `${overCount} area${overCount === 1 ? "" : "s"} of 1 mm² have more than ${densityMax} needle drops (worst ${worst} near ${cx}, ${cy} mm). Thread may break or the fabric pucker.`,
    });
  }

  result.warnings = warnings;
  return { plan: result, warnings };
}
