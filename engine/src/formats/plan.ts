import type { Thread } from "../model";
import { colorBlocks, type PlanStitch, type StitchPlan } from "../stitch/plan";
import { fillerThread } from "./pattern";
import type { EmbPattern, EmbStitch, EmbThread } from "./types";

/** `StitchPlan` (mm) to the 0.1 mm pattern the format writers take. Trims become `trim` + `jump`. */
export function planToPattern(plan: StitchPlan, name?: string): EmbPattern {
  const stitches: EmbStitch[] = [];
  let x = 0;
  let y = 0;
  for (const s of plan.stitches) {
    const px = s.x * 10;
    const py = s.y * 10;
    if (s.type === "stitch") stitches.push({ x: px, y: py, cmd: "stitch" });
    else if (s.type === "jump") stitches.push({ x: px, y: py, cmd: "jump" });
    else if (s.type === "trim") {
      stitches.push({ x, y, cmd: "trim" }, { x: px, y: py, cmd: "jump" });
    } else stitches.push({ x: px, y: py, cmd: "colorChange" });
    x = px;
    y = py;
  }
  const threads: EmbThread[] = colorBlocks(plan).map((b) => {
    const t = plan.threads[b.threadIndex];
    return { hex: t.hex, name: t.name, ...(t.code ? { code: t.code } : {}), ...(t.brand ? { brand: t.brand } : {}) };
  });
  return { stitches, threads, ...(name ? { name } : {}) };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A thread read from a file, as a design `Thread`. */
export function embThreadToThread(t: EmbThread): Thread {
  const brand = t.brand || "Imported";
  const code = t.code ?? "";
  return {
    id: slug(`${brand}-${code}-${t.hex}`),
    brand,
    code,
    name: t.name ?? t.hex,
    hex: t.hex,
  };
}

export interface PatternToPlanResult {
  plan: StitchPlan;
  /** Commands that were converted rather than carried over. */
  stopsConverted: number;
  /** True when the file had no colour information, so colours are placeholders. */
  filler: boolean;
}

/**
 * A pattern read from a file as a `StitchPlan` (mm). Colour changes before any stitch are dropped
 * (U01 selects a needle first); a `stop` becomes a colour change that keeps the current thread. A
 * trim followed by a stitch (VP3 folds the move into the stitch) becomes trim + landing at the stitch.
 */
export function patternToPlan(p: EmbPattern): PatternToPlanResult {
  const filler = p.threads.length === 0;
  const threadAt = (i: number): Thread => embThreadToThread(p.threads[i] ?? fillerThread(i));
  const threads: Thread[] = [threadAt(0)];
  const stitches: PlanStitch[] = [];
  let cursor = 0;
  let blockHasStitch = false;
  let pendingTrim = false;
  let stopsConverted = 0;
  const entry = (x: number, y: number, type: PlanStitch["type"]): PlanStitch => ({
    x: x / 10,
    y: y / 10,
    type,
    threadIndex: threads.length - 1,
    objectIndex: -1,
  });
  for (const s of p.stitches) {
    switch (s.cmd) {
      case "stitch":
        if (pendingTrim) {
          stitches.push(entry(s.x, s.y, "trim"));
          pendingTrim = false;
        }
        stitches.push(entry(s.x, s.y, "stitch"));
        blockHasStitch = true;
        break;
      case "jump":
        stitches.push(entry(s.x, s.y, pendingTrim ? "trim" : "jump"));
        pendingTrim = false;
        break;
      case "trim":
        if (blockHasStitch) pendingTrim = true;
        break;
      case "colorChange":
      case "needleSet":
      case "stop": {
        if (!blockHasStitch) break;
        if (s.cmd === "stop") {
          stopsConverted++;
          threads.push(threads[threads.length - 1]);
        } else {
          cursor++;
          threads.push(threadAt(cursor));
        }
        pendingTrim = false;
        stitches.push(entry(s.x, s.y, "colorChange"));
        blockHasStitch = false;
        break;
      }
      case "end":
        break;
    }
  }
  return { plan: { threads, stitches, warnings: [] }, stopsConverted, filler };
}
