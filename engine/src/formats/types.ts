/**
 * The neutral embroidery pattern every format reader produces and every writer consumes. It mirrors
 * pyembroidery's `EmbPattern` (MIT, https://github.com/EmbroidePy/pyembroidery) closely so the
 * ported readers/writers behave the same: coordinates are in 0.1 mm units (the native unit of
 * nearly every machine format), +y is DOWN, positions are absolute, and each command carries the
 * position the needle is at when it happens.
 *
 * `StitchPlan` (mm) is what the rest of Lilo uses; `planToPattern`/`patternToPlan` convert.
 */

export type EmbCmd = "stitch" | "jump" | "trim" | "colorChange" | "stop" | "needleSet" | "end";

export interface EmbStitch {
  /** 0.1 mm, absolute. */
  x: number;
  y: number;
  cmd: EmbCmd;
  /** 1-based needle for `needleSet`. */
  needle?: number;
}

export interface EmbThread {
  /** "#rrggbb". */
  hex: string;
  name?: string;
  /** Spool/catalogue number. */
  code?: string;
  brand?: string;
}

export interface EmbPattern {
  stitches: EmbStitch[];
  /** One entry per colour block, in sewing order (may repeat). May be shorter than the block count for colourless formats. */
  threads: EmbThread[];
  name?: string;
}

/** Extensions Lilo can read and write (lower case, no dot). */
export const FORMAT_EXTENSIONS = ["pes", "dst", "exp", "jef", "vp3", "xxx", "u01", "pec"] as const;
export type FormatExt = (typeof FORMAT_EXTENSIONS)[number];

export interface FormatInfo {
  ext: FormatExt;
  label: string;
  /** Whether the file stores thread colours (DST, EXP and U01 do not). */
  hasColors: boolean;
}

/** Why a conversion lost or changed something. */
export interface ConvertWarning {
  code:
    | "no-colors-in-source"
    | "no-colors-in-target"
    | "stops-converted"
    | "long-stitches"
    | "sequins-ignored"
    | "empty";
  message: string;
}

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
