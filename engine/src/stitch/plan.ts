import type { Thread } from "../model";

/**
 * What one plan entry means to the machine:
 * - `stitch`: needle goes down at (x, y).
 * - `jump`: move the hoop to (x, y) without sewing.
 * - `trim`: cut the thread, then jump to (x, y). Used for jumps longer than the trim threshold.
 * - `colorChange`: stop for a thread swap. (x, y) is where the needle is parked; the next entry
 *   moves on to the first stitch of the new colour.
 */
export type StitchType = "stitch" | "jump" | "trim" | "colorChange";

export interface PlanStitch {
  /** mm, same coordinate frame as the design (+y down). */
  x: number;
  y: number;
  type: StitchType;
  /** Index into `StitchPlan.threads` (the colour block this entry belongs to). */
  threadIndex: number;
  /** Index into `design.objects` of the object that produced it, or -1 (colour changes, splits). */
  objectIndex: number;
  /** True for tie-in/tie-off (lock) stitches added by `validatePlan`. */
  lock?: boolean;
}

export interface PlanWarning {
  code: "stitch-too-long" | "jump-split" | "outside-hoop" | "hoop-turned" | "density" | "object-failed" | "empty";
  message: string;
  /** Design object involved, if known. */
  objectId?: string;
}

export interface StitchPlan {
  /**
   * Colour blocks in sewing order. A block is a run of consecutive objects with the same thread, so
   * the same `Thread` can appear several times (thread A, B, A = 3 blocks, 2 colour changes).
   */
  threads: Thread[];
  stitches: PlanStitch[];
  warnings: PlanWarning[];
}

export interface PlanStats {
  /** Needle penetrations (`stitch` entries). */
  stitchCount: number;
  jumpCount: number;
  trimCount: number;
  colorChanges: number;
  /** Bounding box of needle positions. */
  widthMm: number;
  heightMm: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Rough sewing time at `spm` stitches per minute, plus 15 s per colour change. */
  estimatedSeconds: number;
}

export const DEFAULT_SPM = 850;
const COLOR_CHANGE_SECONDS = 15;

export function planStats(plan: StitchPlan, spm: number = DEFAULT_SPM): PlanStats {
  let stitchCount = 0;
  let jumpCount = 0;
  let trimCount = 0;
  let colorChanges = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of plan.stitches) {
    if (s.type === "stitch") {
      stitchCount++;
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.y > maxY) maxY = s.y;
    } else if (s.type === "jump") jumpCount++;
    else if (s.type === "trim") trimCount++;
    else colorChanges++;
  }
  if (!Number.isFinite(minX)) minX = minY = maxX = maxY = 0;
  return {
    stitchCount,
    jumpCount,
    trimCount,
    colorChanges,
    widthMm: maxX - minX,
    heightMm: maxY - minY,
    minX,
    minY,
    maxX,
    maxY,
    estimatedSeconds: (stitchCount / spm) * 60 + colorChanges * COLOR_CHANGE_SECONDS,
  };
}

/** Per-block colour: `threadIndex` -> block start/end in `plan.stitches` (end exclusive). */
export function colorBlocks(plan: StitchPlan): { threadIndex: number; start: number; end: number }[] {
  const blocks: { threadIndex: number; start: number; end: number }[] = [];
  plan.stitches.forEach((s, i) => {
    const last = blocks[blocks.length - 1];
    if (last && last.threadIndex === s.threadIndex) last.end = i + 1;
    else blocks.push({ threadIndex: s.threadIndex, start: i, end: i + 1 });
  });
  return blocks;
}
