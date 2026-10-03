import { DEFAULT_HOOP, emptyDesign, type Design, type Hoop, type RunObject, type RunParams, type Thread } from "../model";
import { MANUAL_STITCH_LENGTH_MM } from "../stitch/generate";
import type { StitchPlan } from "../stitch/plan";
import { readDst, writeDst } from "./dst";
import { readExp, writeExp } from "./exp";
import { FormatError } from "./io";
import { readJef, writeJef, type JefWriteOptions } from "./jef";
import { readPecOrPes, writePec } from "./pec";
import { patternToPlan, planToPattern } from "./plan";
import { readU01, writeU01 } from "./u01";
import { readVp3, writeVp3 } from "./vp3";
import { readXxx, writeXxx } from "./xxx";
import { writePes } from "../pes/write";
import { FORMAT_EXTENSIONS, type ConvertWarning, type FormatExt, type FormatInfo } from "./types";

export * from "./types";
export { FormatError } from "./io";
export { planToPattern, patternToPlan } from "./plan";
export { transcode, type TranscodeSettings } from "./transcode";

export const FORMATS: readonly FormatInfo[] = [
  { ext: "pes", label: "Brother PES", hasColors: true },
  { ext: "pec", label: "Brother PEC", hasColors: true },
  { ext: "dst", label: "Tajima DST", hasColors: false },
  { ext: "exp", label: "Melco EXP", hasColors: false },
  { ext: "jef", label: "Janome JEF", hasColors: true },
  { ext: "vp3", label: "Pfaff/Viking VP3", hasColors: true },
  { ext: "xxx", label: "Singer XXX", hasColors: true },
  { ext: "u01", label: "Barudan U01", hasColors: false },
];

/** "design.DST" or ".dst" to "dst", or null if Lilo doesn't know the format. */
export function formatFromName(nameOrExt: string): FormatExt | null {
  const ext = (nameOrExt.includes(".") ? nameOrExt.slice(nameOrExt.lastIndexOf(".") + 1) : nameOrExt).toLowerCase();
  return (FORMAT_EXTENSIONS as readonly string[]).includes(ext) ? (ext as FormatExt) : null;
}

const info = (ext: FormatExt): FormatInfo => FORMATS.find((f) => f.ext === ext)!;

function need(ext: string): FormatExt {
  const f = formatFromName(ext);
  if (!f) throw new FormatError(`Lilo can't read or write .${ext.replace(/^\./, "")} files.`);
  return f;
}

export interface WriteOptions {
  /** Name stored in the file where the format has a slot for it. */
  label?: string;
  /** JEF only: fixed `YYYYMMDDhhmmss` stamp for reproducible output. */
  jefDate?: string;
}

const hasStitches = (plan: StitchPlan) => plan.stitches.some((s) => s.type === "stitch");

/** Write a plan (mm, origin already applied) in the given format. */
export function writeEmbroidery(plan: StitchPlan, to: string, options: WriteOptions = {}): Uint8Array {
  const ext = need(to);
  if (!hasStitches(plan)) throw new FormatError("Nothing to export: the design has no stitches.");
  if (ext === "pes") return writePes(plan, { label: options.label });
  if (ext === "pec") return writePec(plan, { label: options.label });
  const p = planToPattern(plan, options.label);
  const jef: JefWriteOptions = options.jefDate ? { date: options.jefDate } : {};
  switch (ext) {
    case "dst":
      return writeDst(p);
    case "exp":
      return writeExp(p);
    case "jef":
      return writeJef(p, jef);
    case "vp3":
      return writeVp3(p);
    case "xxx":
      return writeXxx(p);
    case "u01":
      return writeU01(p);
  }
}

export interface ReadResult {
  plan: StitchPlan;
  warnings: ConvertWarning[];
  /** Name stored in the file, if any. */
  name?: string;
  /** True if the file had no thread colours (placeholders were assigned). */
  placeholderColors: boolean;
}

/** Read an embroidery file into a plan (mm). Throws `FormatError` on corrupt or unsupported input. */
export function readEmbroidery(bytes: Uint8Array, from: string): ReadResult {
  const ext = need(from);
  if (bytes.length === 0) throw new FormatError("The file is empty.");
  let pattern;
  try {
    pattern =
      ext === "pes" || ext === "pec"
        ? readPecOrPes(bytes)
        : ext === "dst"
          ? readDst(bytes)
          : ext === "exp"
            ? readExp(bytes)
            : ext === "jef"
              ? readJef(bytes)
              : ext === "vp3"
                ? readVp3(bytes)
                : ext === "xxx"
                  ? readXxx(bytes)
                  : readU01(bytes);
  } catch (e) {
    if (e instanceof FormatError) throw e;
    throw new FormatError(`This ${ext.toUpperCase()} file could not be read (${e instanceof Error ? e.message : "corrupt"}).`);
  }
  const { plan, stopsConverted, filler } = patternToPlan(pattern);
  const warnings: ConvertWarning[] = [];
  if (!hasStitches(plan)) warnings.push({ code: "empty", message: "The file contains no stitches." });
  if (filler) {
    warnings.push({
      code: "no-colors-in-source",
      message: `${ext.toUpperCase()} files don't store thread colours, so placeholder colours were assigned.`,
    });
  }
  if (stopsConverted > 0) {
    warnings.push({ code: "stops-converted", message: `${stopsConverted} machine stop(s) became colour changes.` });
  }
  const longStitches = countLong(plan);
  if (longStitches > 0) {
    warnings.push({ code: "long-stitches", message: `${longStitches} stitch(es) are longer than 12.1 mm; some machines will snag.` });
  }
  return { plan, warnings, ...(pattern.name ? { name: pattern.name } : {}), placeholderColors: filler };
}

function countLong(plan: StitchPlan): number {
  let n = 0;
  let px = 0;
  let py = 0;
  let have = false;
  for (const s of plan.stitches) {
    if (s.type === "colorChange") continue;
    if (s.type === "stitch" && have && Math.hypot(s.x - px, s.y - py) > 12.1) n++;
    px = s.x;
    py = s.y;
    have = true;
  }
  return n;
}

export interface ConvertResult {
  bytes: Uint8Array;
  warnings: ConvertWarning[];
  /** The intermediate plan, handy for previews. */
  plan: StitchPlan;
}

/** Embroidery file A to file B. Warnings say what the target format couldn't keep. */
export function convert(bytes: Uint8Array, fromExt: string, toExt: string, options: WriteOptions = {}): ConvertResult {
  const to = need(toExt);
  const read = readEmbroidery(bytes, fromExt);
  const warnings = [...read.warnings];
  if (!info(to).hasColors && !read.placeholderColors) {
    warnings.push({
      code: "no-colors-in-target",
      message: `${to.toUpperCase()} files don't store thread colours; only the colour changes are kept.`,
    });
  }
  const out = writeEmbroidery(read.plan, to, { label: read.name, ...options });
  return { bytes: out, warnings, plan: read.plan };
}

// ---- opening existing files as editable objects --------------------------------------------

/**
 * Run params for a manual-stitch object. `designToStitchPlan` treats a run with this stitch length
 * as "manual": no resampling, every path point is one needle drop, in order.
 */
export const MANUAL_RUN_PARAMS: RunParams = { stitchLengthMm: MANUAL_STITCH_LENGTH_MM, repeats: 1 };

export interface ManualObjects {
  threads: Thread[];
  objects: RunObject[];
}

/**
 * A plan as manual-stitch objects, so an existing file opens in the editor with every needle
 * penetration preserved. One object per unbroken run of stitches (split at jumps, trims and colour
 * changes); the design generator re-creates the jumps between them. Objects are `run` objects with
 * `MANUAL_RUN_PARAMS` until the editor has a dedicated manual type.
 */
export function stitchPlanToManualObjects(plan: StitchPlan, namePrefix = "Stitches"): ManualObjects {
  const threads = new Map<string, Thread>();
  const objects: RunObject[] = [];
  let path: [number, number][] = [];
  let blockThread: Thread | null = null;
  const flush = () => {
    if (path.length > 0 && blockThread) {
      objects.push({
        id: `manual-${objects.length + 1}`,
        name: `${namePrefix} ${objects.length + 1}`,
        kind: "run",
        threadId: blockThread.id,
        // validateDesign wants 2+ points; a lone needle drop is doubled (generation drops the duplicate)
        geometry: { path: path.length === 1 ? [path[0], path[0]] : path, closed: false },
        params: { ...MANUAL_RUN_PARAMS },
      });
    }
    path = [];
  };
  for (const s of plan.stitches) {
    const t = plan.threads[s.threadIndex];
    if (s.type === "stitch") {
      if (blockThread && t.id !== blockThread.id) flush();
      blockThread = t;
      threads.set(t.id, t);
      path.push([s.x, s.y]);
    } else {
      flush();
    }
  }
  flush();
  return { threads: [...threads.values()], objects };
}

/** A fresh design holding a plan's stitches as manual objects (see `stitchPlanToManualObjects`). */
export function planToManualDesign(plan: StitchPlan, hoop: Hoop = DEFAULT_HOOP): Design {
  const { threads, objects } = stitchPlanToManualObjects(plan);
  const d = emptyDesign(hoop);
  d.threads = threads;
  d.objects = objects;
  return d;
}
