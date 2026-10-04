/**
 * The machine speed Lilo recommends for one design, in stitches a minute (spm).
 *
 * A file cannot set the speed. The person sets it on the machine, so Lilo only advises.
 *
 * SOURCES. The 850 spm top speed of the NV2700 is from Brother's own specifications. The idea of slowing
 * down for thin lines, metallic thread and dense stitching is from Brother's FAQ and hobbyist guides
 * (researched). The exact caps below (450, 400, 550) are rounded rules of thumb from those: researched,
 * but no maker publishes a table. The starting range per fabric is `recommendedSpeed` (UNVERIFIED).
 */
import type { Design, Thread } from "../model";
import type { PlanWarning } from "../stitch/plan";
import { recommendedSpeed } from "./apply";
import { satinWidthOf } from "./safety";
import { canonicalFabric, type SewingSetupInput } from "./sewing";

/** The fastest the NV2700 sews. */
export const MACHINE_MAX_SPM = 850;

/** Speed caps, spm. */
export const SPEED_CAPS = { thinSatin: 450, smallLetters: 450, metallic: 400, dense: 550 } as const;
/** A satin column under this is "thin" for speed (mm). */
export const THIN_SATIN_SPEED_MM = 2;
/** Letters under this cap height are "small" for speed (mm). */
export const SMALL_LETTERS_SPEED_MM = 5;

export interface MachineSpeed {
  /** Stitches a minute to set on the machine. */
  spm: number;
  /** Short plain-words reasons the speed is lower than the fabric alone would say. When nothing slows it down, one line about the fabric. */
  reasons: string[];
}

const isMetallic = (t: Thread): boolean => /metallic/i.test(`${t.name} ${t.line ?? ""}`);

/**
 * Start from the fabric's range (its middle), then slow down for what is in the design. Never above the
 * machine's top speed (`maxSpm`, default 850).
 */
export function recommendedMachineSpeed(
  design: Pick<Design, "objects" | "threads" | "textBlocks">,
  setup: Pick<SewingSetupInput, "fabric" | "threadWeight">,
  plan: { warnings: readonly Pick<PlanWarning, "code">[] },
  maxSpm: number = MACHINE_MAX_SPM,
): MachineSpeed {
  const fabric = canonicalFabric(setup.fabric ?? "suiting");
  const range = recommendedSpeed(fabric, setup.threadWeight === 60 ? 60 : 40);
  let spm = Math.min(range.estimateSpm, maxSpm);
  const reasons: string[] = [];
  const cap = (limit: number, reason: string) => {
    if (limit < spm) {
      spm = limit;
      reasons.length = 0;
    }
    if (limit <= spm && !reasons.includes(reason)) reasons.push(reason);
  };

  const visible = design.objects.filter((o) => o.visible !== false);
  if (visible.some((o) => {
    const w = satinWidthOf(o);
    return w !== null && w > 0 && w < THIN_SATIN_SPEED_MM;
  })) cap(SPEED_CAPS.thinSatin, "thin lines in this design");
  if ((design.textBlocks ?? []).some((b) => b.heightMm < SMALL_LETTERS_SPEED_MM)) cap(SPEED_CAPS.smallLetters, "small letters");
  const used = new Set(visible.map((o) => o.threadId));
  if (design.threads.some((t) => used.has(t.id) && isMetallic(t))) cap(SPEED_CAPS.metallic, "metallic thread");
  if (plan.warnings.some((w) => w.code === "density")) cap(SPEED_CAPS.dense, "very dense stitching");

  if (reasons.length === 0) reasons.push(`a good speed for ${fabric} cloth`);
  return { spm, reasons };
}
