/**
 * Safe ranges: the one table behind the "Stitch safety" card, the green bands on the sliders, the amber
 * reasons, and the `thin-satin` / `long-stitch-snag` plan warnings.
 *
 * Outside a range is never an error. Lilo still sews it and still exports it. It only says why you might
 * not want to.
 *
 * SOURCE. `researched` means the numbers come from the sourced calibration table in `defaults.ts`
 * ([CAL], Hatch, Amefird, Ink/Stitch) or from manufacturer/hobbyist guidance. `lilo-default` means Lilo's
 * own choice with no source behind it. The app calls those "Lilo default", never "safe".
 *
 * Pure data and small functions: no stitchjs, so the editor can load it on the main thread.
 */
import type { Design, DesignObject } from "../model";
import { DEFAULTS } from "./defaults";
import type { FabricId, ThreadWeight } from "./sewing";

/** Every parameter that has a safe range. `minStitch` and `longStitch` are limits, not sliders. */
export type SafeParam = "satinWidth" | "satinDensity" | "fillRowSpacing" | "fillStitchLength" | "runStitchLength" | "pullComp" | "minStitch" | "longStitch";

export interface SafeRange {
  /** Short name for the card. */
  label: string;
  /** Safe minimum, or null when there is no lower limit. */
  min: number | null;
  /** Safe maximum, or null when there is no upper limit. */
  max: number | null;
  unit: "mm";
  /** One plain sentence, shown when the value is under `min`. Empty when `min` is null. */
  reasonLow: string;
  /** One plain sentence, shown when the value is over `max`. Empty when `max` is null. */
  reasonHigh: string;
  source: "researched" | "lilo-default";
  /** Where the numbers come from, for the manual and the tooltip. */
  sourceNote: string;
}

export const SAFE_RANGES: Readonly<Record<SafeParam, SafeRange>> = {
  satinWidth: {
    label: "Satin width",
    min: 1.5,
    max: 10,
    unit: "mm",
    reasonLow: "Too thin to look shiny. Stitches pile up and can break the thread. Use a running stitch instead.",
    reasonHigh: "Long loose stitches can snag on things.",
    source: "lilo-default",
    sourceNote: "The 1.5 mm floor (1.0 mm for 60 wt thread) matches the calibration table. The 10 mm top is a Lilo default. Lilo splits columns wider than 6.8 mm into halves, so no stitch passes 7 mm.",
  },
  satinDensity: {
    label: "Satin spacing",
    min: 0.35,
    max: 0.6,
    unit: "mm",
    reasonLow: "Too tight. The fabric puckers and the thread can break.",
    reasonHigh: "Gaps: fabric shows through.",
    source: "researched",
    sourceNote: "Hatch and Amefird put satin spacing near 0.40 mm. The calibration table allows 0.35 to 0.60 mm (0.30 mm for 60 wt, up to 0.70 mm on towel).",
  },
  fillRowSpacing: {
    label: "Fill row spacing",
    min: 0.35,
    max: 0.6,
    unit: "mm",
    reasonLow: "Too tight. The fabric puckers and the thread can break.",
    reasonHigh: "Gaps: fabric shows through.",
    source: "researched",
    sourceNote: "The calibration table and Wilcom guidance put fill rows near 0.40 mm, with 0.35 to 0.60 mm as the working range.",
  },
  fillStitchLength: {
    label: "Fill stitch length",
    min: 3,
    max: 4.5,
    unit: "mm",
    reasonLow: "Short stitches make the fill stiff and slow.",
    reasonHigh: "Long stitches can snag.",
    source: "researched",
    sourceNote: "The calibration table and Ink/Stitch use 4 mm, with 3 to 4.5 mm as the range.",
  },
  runStitchLength: {
    label: "Running stitch length",
    min: 1.5,
    max: 4,
    unit: "mm",
    reasonLow: "Needle hits nearly the same spot. Thread piles up and breaks.",
    reasonHigh: "Loops can catch on buttons and fingers.",
    source: "lilo-default",
    sourceNote: "Lilo's own limits. The default running stitch is 2.5 mm. Things that are not worn can go up to 5 mm.",
  },
  pullComp: {
    label: "Pull compensation",
    min: 0.1,
    max: 0.4,
    unit: "mm",
    reasonLow: "Edges may leave gaps.",
    reasonHigh: "Shapes come out fat.",
    source: "lilo-default",
    sourceNote: "The calibration table uses 0.15 to 0.20 mm on woven cloth. The 0.1 and 0.4 mm limits are Lilo's own.",
  },
  minStitch: {
    label: "Shortest stitch",
    min: 0.5,
    max: null,
    unit: "mm",
    reasonLow: "Stitches this short pile thread up. Lilo merges them away.",
    reasonHigh: "",
    source: "researched",
    sourceNote: "The calibration table's 0.5 mm floor (0.6 mm on Premium). It is already applied to every file.",
  },
  longStitch: {
    label: "Longest stitch",
    min: null,
    max: 7,
    unit: "mm",
    reasonLow: "",
    reasonHigh: "Stitches longer than 7 mm can snag on wearables.",
    source: "researched",
    sourceNote: "The calibration table warns above 7 mm on wearables. Lilo splits anything over 12.1 mm for you.",
  },
};

/** What can change a range: the thread weight and the fabric. */
export interface SafeContext {
  threadWeight?: ThreadWeight;
  fabric?: FabricId;
}

/** The parameters that are sliders (the rest are limits). */
export type SafeSliderParam = Exclude<SafeParam, "minStitch" | "longStitch">;

/** Parameters shown as sliders, in the order the card lists them. */
export const SAFE_SLIDER_PARAMS: readonly SafeSliderParam[] = ["satinWidth", "satinDensity", "fillRowSpacing", "fillStitchLength", "runStitchLength", "pullComp"];

/** Fabrics a person wears. Towel is the one home-textile fabric in the list. Lilo default. */
export const isWearable = (fabric: FabricId | undefined): boolean => fabric !== "towel";

/** Narrowest safe satin column for a thread: 1.5 mm at 40 wt, 1.0 mm at 60 wt. */
export const thinSatinMinMm = (threadWeight: ThreadWeight | undefined): number => (threadWeight === 60 ? 1 : SAFE_RANGES.satinWidth.min!);

/** The range with the thread and fabric adjustments applied (60 wt allows finer columns and tighter rows; towel allows looser spacing; things not worn allow longer running stitches). */
export function safeRangeFor(param: SafeParam, ctx: SafeContext = {}): SafeRange {
  const base = SAFE_RANGES[param];
  const fine = ctx.threadWeight === 60;
  switch (param) {
    case "satinWidth":
      return fine ? { ...base, min: 1 } : base;
    case "satinDensity":
      return { ...base, min: fine ? 0.3 : base.min, max: ctx.fabric === "towel" ? DEFAULTS.satin.densityCeilMm : base.max };
    case "fillRowSpacing":
      return fine ? { ...base, min: 0.3 } : base;
    case "runStitchLength":
      return ctx.fabric !== undefined && !isWearable(ctx.fabric) ? { ...base, max: 5 } : base;
    default:
      return base;
  }
}

export interface SafeCheck {
  status: "ok" | "low" | "high";
  /** The plain-words reason, empty when `ok`. */
  reason: string;
}

const EPS = 1e-6;

/** Is `value` inside the safe range for `param`? */
export function checkSafe(param: SafeParam, value: number, ctx: SafeContext = {}): SafeCheck {
  const r = safeRangeFor(param, ctx);
  if (r.min !== null && value < r.min - EPS) return { status: "low", reason: r.reasonLow };
  if (r.max !== null && value > r.max + EPS) return { status: "high", reason: r.reasonHigh };
  return { status: "ok", reason: "" };
}

// ---- satin widths in a design ------------------------------------------------------------------------

/** The typical width of a satin strip (`[l0, r0, l1, r1, ...]`): the median (the upper one when there is an even number of rungs, as the digitizer measures), so tapered ends do not count as thin. */
export function stripWidthMm(strip: readonly (readonly [number, number])[]): number {
  const w: number[] = [];
  for (let i = 0; i + 1 < strip.length; i += 2) w.push(Math.hypot(strip[i][0] - strip[i + 1][0], strip[i][1] - strip[i + 1][1]));
  if (w.length === 0) return 0;
  w.sort((a, b) => a - b);
  return w[w.length >> 1];
}

/** The width a satin-style object is sewn at, or null when it is not a satin column. */
export function satinWidthOf(o: DesignObject): number | null {
  if (o.kind === "satin") return stripWidthMm(o.geometry.strip);
  if (o.kind === "run" && o.params.type === "satin") return o.params.widthMm ?? DEFAULTS.satin.widthMm;
  return null;
}

export interface ThinSatin {
  id: string;
  name: string;
  widthMm: number;
}

/** Visible satin objects narrower than the safe minimum for the design's thread weight. */
export function thinSatins(design: Pick<Design, "objects" | "sewing">): ThinSatin[] {
  const min = thinSatinMinMm(design.sewing?.threadWeight);
  const out: ThinSatin[] = [];
  for (const o of design.objects) {
    if (o.visible === false) continue;
    const w = satinWidthOf(o);
    if (w !== null && w > 0 && w < min - EPS) out.push({ id: o.id, name: o.name, widthMm: w });
  }
  return out;
}

// ---- zig-zag underlay and the 7 mm snag limit --------------------------------------------------------

/** A zig-zag underlay leg runs across the whole column. Wider than this (mm, widest rung), the leg plus pull and slant passes 7 mm. */
export const ZIGZAG_UNDERLAY_MAX_WIDTH_MM = 5.5;

/** The widest rung of a satin strip (`[l0, r0, l1, r1, ...]`), mm. */
export function stripMaxWidthMm(strip: readonly (readonly [number, number])[]): number {
  let m = 0;
  for (let i = 0; i + 1 < strip.length; i += 2) m = Math.max(m, Math.hypot(strip[i][0] - strip[i + 1][0], strip[i][1] - strip[i + 1][1]));
  return m;
}

/**
 * The underlay a column can safely have: a column whose widest rung is over `ZIGZAG_UNDERLAY_MAX_WIDTH_MM`
 * swaps its zig-zag for edge and centre walks, so no underlay stitch is longer than 7 mm.
 */
export function safeUnderlayFor<U extends string>(underlay: U, maxWidthMm: number): U | "contour" | "center-contour" {
  if (maxWidthMm <= ZIGZAG_UNDERLAY_MAX_WIDTH_MM) return underlay;
  if (underlay === "zigzag") return "contour";
  if (underlay === "contour-zigzag" || underlay === "double-zigzag") return "center-contour";
  return underlay;
}

/**
 * A strip no thinner than `minMm` (its typical width, see `stripWidthMm`): every rung is scaled about its
 * middle by the same amount, so a taper stays a taper. Returns the strip itself when it is wide enough.
 */
export function widenStripTo<P extends readonly [number, number]>(strip: readonly P[], minMm: number): P[] | readonly P[] {
  const w = stripWidthMm(strip);
  if (w <= 0 || w >= minMm - EPS) return strip;
  const k = minMm / w;
  const out: P[] = [];
  for (let i = 0; i + 1 < strip.length; i += 2) {
    const [lx, ly] = strip[i];
    const [rx, ry] = strip[i + 1];
    const mx = (lx + rx) / 2;
    const my = (ly + ry) / 2;
    out.push([mx + (lx - mx) * k, my + (ly - my) * k] as unknown as P, [mx + (rx - mx) * k, my + (ry - my) * k] as unknown as P);
  }
  return out;
}
