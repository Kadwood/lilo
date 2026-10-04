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
  code: "stitch-too-long" | "jump-split" | "outside-hoop" | "hoop-turned" | "density" | "object-failed" | "empty" | "thin-satin" | "long-stitch-snag" | "hidden-layer";
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
  /**
   * Sewing time with nothing going wrong: stitches at `spm`, 7 s per thread trim, 45 s per colour change.
   * No allowance for real-world stops.
   */
  machineSeconds: number;
  /** `machineSeconds` plus a quarter for real-world stops (thread breaks, checking, re-hooping). What the screens show. */
  estimatedSeconds: number;
}

export const DEFAULT_SPM = 850;
/** Seconds the machine takes to cut the thread. Time model: sewingtrip.com (researched). */
export const TRIM_SECONDS = 7;
/** Seconds to stop, swap the thread and restart. Time model: sewingtrip.com (researched). */
export const COLOR_CHANGE_SECONDS = 45;
/** Real-world stops on top of the machine time. Time model: sewingtrip.com (researched). */
export const REAL_WORLD_FACTOR = 1.25;

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
  const machineSeconds = (stitchCount / spm) * 60 + trimCount * TRIM_SECONDS + colorChanges * COLOR_CHANGE_SECONDS;
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
    machineSeconds,
    estimatedSeconds: machineSeconds * REAL_WORLD_FACTOR,
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
