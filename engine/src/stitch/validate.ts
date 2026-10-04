import type { Design, Hoop } from "../model";
import { DEFAULTS } from "../presets/defaults";
import { isWearable, SAFE_RANGES, thinSatinMinMm, thinSatins } from "../presets/safety";
import { planStats, type PlanStitch, type PlanWarning, type StitchPlan } from "./plan";

/** Longest needle-to-needle distance we allow; longer ones are split. Machines snag above ~12 mm. */
export const MAX_STITCH_MM = DEFAULTS.limits.maxStitchMm;
/** Jumps longer than this get a thread trim, so no long floats are left on the fabric. */
export const TRIM_JUMP_MM = DEFAULTS.limits.trimJumpMm;
/** PEC/PES moves carry 12-bit deltas (+-204.7 mm); split anything beyond this. */
const MAX_JUMP_MM = DEFAULTS.limits.maxJumpMm;
/** Needle penetrations per 1 mm^2 cell above which fabric tends to pucker or thread breaks. */
export const DENSITY_WARN_PER_MM2 = DEFAULTS.limits.densityWarnPerMm2;
/** Touching 1 mm cells over the limit that make a patch worth a warning (one cell is just a crossing). */
export const DENSE_PATCH_CELLS = 2;
/** Needle drops closer than this to the previous one are merged away (thread piles up and can snap). */
export const MIN_STITCH_MM = DEFAULTS.limits.minStitchMm;
/** Premium quality merges needle drops closer than this. */
export const MIN_STITCH_PREMIUM_MM = DEFAULTS.limits.minStitchPremiumMm;
/** The shortest stitch kept for a sewing quality (Standard 0.5 mm, Premium 0.6 mm). */
export const minStitchFor = (quality: "standard" | "premium" | undefined): number => (quality === "premium" ? MIN_STITCH_PREMIUM_MM : MIN_STITCH_MM);
/** Default length of lock (tie) stitches in mm. */
export const LOCK_STITCH_MM = DEFAULTS.limits.lockStitchMm;

export interface ValidationOptions {
  maxStitchMm?: number;
  trimJumpMm?: number;
  densityWarnPerMm2?: number;
  /** Length (mm) of the tie-in/tie-off stitches; 0 turns them off. Default 0.4. */
  lockStitchMm?: number;
  /** Merge consecutive needle drops closer than this (mm) within one run. 0 turns it off. Default: by `quality`. */
  minStitchMm?: number;
  /** The design's sewing quality: picks the default `minStitchMm` (Standard 0.5, Premium 0.6). */
  quality?: "standard" | "premium";
  /**
   * The design the plan came from. When given, two honesty checks run: `thin-satin` (a satin column under
   * the safe width for the thread) and `long-stitch-snag` (a stitch over 7 mm on cloth that is worn).
   * Both are amber notes. Nothing is changed or blocked.
   */
  design?: Pick<Design, "objects" | "sewing">;
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

  const minStitch = options.minStitchMm ?? minStitchFor(options.quality);
  const merged = mergeShortStitches(out, minStitch);
  const lockMm = options.lockStitchMm ?? LOCK_STITCH_MM;
  const sewn = lockMm > 0 ? addLockStitches(merged, lockMm, minStitch) : merged;
  const result: StitchPlan = { threads: plan.threads, stitches: sewn, warnings: [] };
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
  for (const s of sewn) {
    if (s.type !== "stitch" || s.lock) continue; // tie stitches are deliberately stacked
    const key = `${Math.floor(s.x)},${Math.floor(s.y)}`;
    const n = (cells.get(key) ?? 0) + 1;
    cells.set(key, n);
    if (n > worst) {
      worst = n;
      worstCell = key;
    }
  }
  // A single 1 mm cell over the limit is where two lines or columns cross, which every design has. A patch
  // (two or more touching cells), or one cell at twice the limit, is thread piled up: warn on those.
  const dense = new Set<string>();
  for (const [key, n] of cells) if (n > densityMax) dense.add(key);
  const seen = new Set<string>();
  for (const start of dense) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    let size = 0;
    let peak = 0;
    while (stack.length) {
      const k = stack.pop()!;
      size++;
      peak = Math.max(peak, cells.get(k)!);
      const [x, y] = k.split(",").map(Number);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const q = `${x + dx},${y + dy}`;
          if (dense.has(q) && !seen.has(q)) {
            seen.add(q);
            stack.push(q);
          }
        }
    }
    if (size >= DENSE_PATCH_CELLS || peak > 2 * densityMax) overCount++;
  }
  if (overCount > 0) {
    const [cx, cy] = worstCell.split(",");
    warnings.push({
      code: "density",
      message: `${overCount} area${overCount === 1 ? "" : "s"} of thread piled up: more than ${densityMax} needle drops in a square millimetre (worst ${worst} near ${cx}, ${cy} mm). Thread may break or the fabric pucker.`,
    });
  }

  if (options.design) {
    const thin = thinSatins(options.design);
    if (thin.length > 0) {
      const min = thinSatinMinMm(options.design.sewing?.threadWeight);
      const narrowest = thin.reduce((a, b) => (b.widthMm < a.widthMm ? b : a));
      warnings.push({
        code: "thin-satin",
        objectId: narrowest.id,
        message: `${thin.length} satin column${thin.length === 1 ? " is" : "s are"} thinner than ${min} mm (narrowest ${narrowest.widthMm.toFixed(1)} mm). ${SAFE_RANGES.satinWidth.reasonLow}`,
      });
    }
    if (isWearable(options.design.sewing?.fabric)) {
      const snagAt = SAFE_RANGES.longStitch.max!;
      let longCount = 0;
      let longest = 0;
      let lx = 0;
      let ly = 0;
      let have = false;
      for (const s of sewn) {
        if (s.type === "colorChange") continue;
        if (s.type === "stitch" && have) {
          const d = Math.hypot(s.x - lx, s.y - ly);
          if (d > snagAt + 1e-6) {
            longCount++;
            longest = Math.max(longest, d);
          }
        }
        lx = s.x;
        ly = s.y;
        have = true;
      }
      if (longCount > 0) {
        warnings.push({
          code: "long-stitch-snag",
          message: `${longCount} stitch${longCount === 1 ? " is" : "es are"} longer than ${snagAt} mm (longest ${longest.toFixed(1)} mm). ${SAFE_RANGES.longStitch.reasonHigh}`,
        });
      }
    }
  }

  result.warnings = warnings;
  return { plan: result, warnings };
}

/**
 * Drop needle drops that land within `minMm` of the previous drop of the same object, so no run has
 * tiny stitches (they pile thread up and break needles). Only touches runs of consecutive `stitch`
 * entries: jumps, trims and colour changes break a run, so nothing merges across them. The first
 * stitch of a run always stays; the last one replaces the stitch before it when they are too close
 * (unless that one is the first). Run before lock stitches are added.
 */
export function mergeShortStitches(list: PlanStitch[], minMm: number): PlanStitch[] {
  if (minMm <= 0) return list;
  const out: PlanStitch[] = [];
  let runStart = -1; // index in `out` of the first stitch of the current run
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.type !== "stitch") {
      out.push(s);
      runStart = -1;
      continue;
    }
    const prev = out[out.length - 1];
    if (!prev || prev.type !== "stitch" || prev.objectIndex !== s.objectIndex || runStart < 0) {
      runStart = out.length;
      out.push(s);
      continue;
    }
    if (Math.hypot(s.x - prev.x, s.y - prev.y) >= minMm) {
      out.push(s);
      continue;
    }
    const next = list[i + 1];
    const isLast = !next || next.type !== "stitch" || next.objectIndex !== s.objectIndex;
    if (isLast && out.length - 1 !== runStart) {
      out[out.length - 1] = s;
      // moving the end point can bring it too close to the stitch before: fold those away too
      while (out.length - 2 > runStart && Math.hypot(s.x - out[out.length - 2].x, s.y - out[out.length - 2].y) < minMm) {
        out.splice(out.length - 2, 1);
      }
      if (out.length - 2 === runStart && Math.hypot(s.x - out[runStart].x, s.y - out[runStart].y) < minMm) out.pop();
    }
    // otherwise the close stitch is simply dropped
  }
  return out;
}

/**
 * Lock the thread so cut ends can't pull out:
 * - tie-in: right after the first stitch of the design and of every colour block / trim, sew
 *   forward-back-forward along the direction of the next stitch (3 stitches of `len` mm);
 * - tie-off: before every trim, colour change and the end, sew back-forward-back along the last
 *   stitch's direction, ending where it started.
 * Plain jumps (under the trim threshold) don't cut the thread, so they get neither.
 */
export function addLockStitches(list: PlanStitch[], len: number, minStitchMm: number = MIN_STITCH_MM): PlanStitch[] {
  const out: PlanStitch[] = [];
  let cut = true; // thread is cut/new: the next stitch needs a tie-in
  let last: PlanStitch | null = null; // last real stitch since the last cut
  let before: PlanStitch | null = null; // the one before it
  const tieOff = () => {
    if (!last) return;
    const ref = before ?? last;
    let dx = last.x - ref.x;
    let dy = last.y - ref.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return;
    dx /= d;
    dy /= d;
    const l = Math.min(len, d / 2);
    const mk = (k: number): PlanStitch => ({ ...last!, x: last!.x - dx * l * k, y: last!.y - dy * l * k, type: "stitch", lock: true });
    out.push(mk(1), mk(0), mk(1));
    last = null;
    before = null;
  };
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.type === "trim" || s.type === "colorChange") {
      tieOff();
      // a colour change parks the needle wherever the last tie-off left it
      const at = out[out.length - 1];
      out.push(s.type === "colorChange" && at ? { ...s, x: at.x, y: at.y } : s);
      cut = true;
      continue;
    }
    if (s.type !== "stitch") {
      out.push(s);
      continue;
    }
    out.push(s);
    if (cut) {
      cut = false;
      // direction to the next real stitch
      const next = list.slice(i + 1).find((n) => n.type === "stitch");
      if (next) {
        const dx = next.x - s.x;
        const dy = next.y - s.y;
        const d = Math.hypot(dx, dy);
        if (d >= 2 * minStitchMm) {
          const l = Math.min(len, d / 2);
          const mk = (k: number): PlanStitch => ({ ...s, x: s.x + (dx / d) * l * k, y: s.y + (dy / d) * l * k, lock: true });
          out.push(mk(1), mk(0), mk(1));
        }
      }
      before = null;
    } else {
      before = last;
    }
    last = s;
  }
  tieOff();
  return out;
}
