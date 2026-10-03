import type { FillParams } from "../model";

/**
 * Sewing presets: fabric x thread weight x quality, the single source for every number that depends
 * on what is being sewn on and with what. The auto-digitizer reads `resolveSewingSetup(...).engine`;
 * the UI renders the labels, descriptions and the "Before you sew" checklist from the same tables.
 *
 * Where the numbers come from (researched 2026-10-03; all are practitioner guidance, not a vendor
 * spec, so every figure is a STARTING POINT to confirm with a test sew-out. UNVERIFIED = recalled
 * from general digitizing practice, no source found):
 *
 *  [IS-SATIN]  Ink/Stitch satin column docs, https://inkstitch.org/docs/stitches/satin-column/
 *              (centre-walk "may be all you need for thin columns", contour underlay for small and
 *              medium widths, zig-zag + contour = "German underlay", wide/challenging: all three;
 *              pull compensation grows outward from the column centre by a fixed length per side).
 *  [IS-SRC]    Ink/Stitch source defaults, lib/elements/satin_column/satin_column.py and
 *              lib/elements/fill_stitch.py (GPL-3, ported here as ideas): short stitch distance
 *              0.25 mm and inset 15 %, contour underlay inset 0.4 mm, zig-zag underlay 3 mm
 *              peak-to-peak, fill underlay row spacing 3x the top spacing, underlay at 90 deg.
 *  [IS-FILL]   https://inkstitch.org/docs/stitches/fill-stitch/ (underlay = perpendicular fill with
 *              much wider spacing; "the goal is to flatten the fabric and give the top stitches rails").
 *  [EH-WILCOM] embroideryhooping.com, "Wilcom satin stitch settings that actually stitch clean":
 *              0.38-0.40 mm satin spacing for cotton/twill, centre run under 2 mm, edge run + double
 *              zig-zag from 7 mm, stitch length 1.5-12 mm, 60 wt with 65/9-70/10 needles for micro text,
 *              pull comp 0.17 mm default and 0.30 mm for bold/thin columns.
 *  [EH-THEORY] embroideryhooping.com, "Embroidery digitizing theory that improves your sew-out": underlay
 *              by width (<3 centre run, 3-5 zig-zag or edge run, >5 double zig-zag/tatami), pull comp
 *              0.20-0.40 mm (knits towards 0.40), towel: tear-away + water-soluble topping, heavy
 *              zig-zag + edge run, no satin under 2 mm; leather/vinyl: medium tear-away, 75/11 sharp,
 *              spacing about 0.60 mm; knit: 2.5 oz cut-away, taut but not stretched.
 *  [HS-CHEAT]  hoopingstation.com digitizing cheat sheet: satin minimum 1.5 mm, sweet spot 2-9 mm,
 *              "density 0.40 mm" is the gap between stitch lines (lower = denser).
 *  [TD-PULL]   truedigitizing.com pull/push compensation guide: 0.15-0.2 mm for 2-4 mm columns,
 *              0.25-0.3 mm for 5-7 mm, push (fill) 0.3-0.4 mm, extra on stretchy fabric.
 *  [MF-60WT]   maggieframes.com on 60 wt: 65/9 needle (70/10 or 75/11 for tougher cloth), spacing about
 *              0.35-0.40 mm, minimum stitch about 1.0 mm, cut-away gives the cleanest small detail,
 *              5-6 mm block letters shrink to about 3 mm.
 *  [NAA]       naandesigns.com, 40 vs 60 wt: swapping the cone without changing the file loses coverage.
 *
 * IMPORTANT unit note: satin "spacing" here is the commercial one, the distance between neighbouring
 * stitch LINES (Wilcom/Hatch "density 0.40 mm"). stitchjs satins zig-zag in ladder form, two stitch
 * lines per row, so its `densityMm` is twice this. `satinDensityFromPitch` in autodigitize/profile.ts
 * does the conversion; the legacy default 0.4 there is a 0.2 mm line pitch (twice as dense as the norm).
 */

export type Quality = "standard" | "premium";
export type ThreadWeight = 40 | 60;
export type FabricId = "suiting" | "shirting" | "twill" | "knit" | "denim" | "towel" | "leather";
/** Names older callers use: "woven" is suiting, "cap" is twill. */
export type FabricInput = FabricId | "woven" | "cap";

export const FABRIC_ALIASES: Readonly<Record<"woven" | "cap", FabricId>> = { woven: "suiting", cap: "twill" };
export const canonicalFabric = (f: FabricInput): FabricId => (f === "woven" || f === "cap" ? FABRIC_ALIASES[f] : f);

export interface SewingSetupInput {
  fabric?: FabricInput;
  threadWeight?: ThreadWeight;
  quality?: Quality;
}

export interface NeedleAdvice {
  /** Metric/imperial size, e.g. "75/11". */
  size: string;
  /** Point type, e.g. "sharp" or "ballpoint". */
  type: "sharp" | "ballpoint" | "leather/wedge";
  note: string;
}

export interface StabiliserAdvice {
  type: "cut-away" | "tear-away" | "no-show mesh";
  weight: string;
  note: string;
}

/** The numbers the auto-digitizer takes from a fabric. */
export interface FabricEngine {
  /** Multiplies the width-scaled satin pull compensation (1 = woven suiting). */
  pullCompFactor: number;
  /** Multiplies satin and fill line spacing (above 1 = looser, fewer stitches). */
  densityFactor: number;
  /** Scales the width at which heavier underlay starts (below 1 = heavier underlay on narrower columns). */
  underlayBias: number;
  /** Wide columns get a zig-zag underlay on top of the edge walk. Off where it would perforate or bulk. */
  zigzagUnderlay: boolean;
  /** Fill pull compensation per side, mm. */
  fillPullCompMm: number;
  /** Narrowest satin column worth sewing on this cloth, mm (finer ones sink into the pile or the weave). */
  minSatinFloorMm: number;
}

export interface FabricPreset {
  id: FabricId;
  label: string;
  description: string;
  needle: NeedleAdvice;
  stabiliser: StabiliserAdvice;
  topping: "none" | "water-soluble";
  hooping: string[];
  engine: FabricEngine;
  /** Source ids from the list above (or UNVERIFIED). */
  sources: string[];
}

export const FABRICS: Readonly<Record<FabricId, FabricPreset>> = {
  suiting: {
    id: "suiting",
    label: "Suiting (woven wool / blends)",
    description: "Jacket cloth and other firm wovens. It holds its shape, so it is the easy case.",
    needle: { size: "75/11", type: "sharp", note: "A fresh sharp needle pierces the tight weave without pushing threads aside." },
    stabiliser: { type: "cut-away", weight: "medium, about 1.5-2 oz (50-60 g/m2)", note: "Cut-away keeps fine serifs from distorting as the garment is worn; trim close to the stitching." },
    topping: "none",
    hooping: ["Hoop the fabric together with the stabiliser, drum-tight but not stretched.", "Do not clamp on a finished jacket front: float it on sticky stabiliser instead to avoid hoop marks."],
    engine: { pullCompFactor: 1, densityFactor: 1, underlayBias: 1, zigzagUnderlay: true, fillPullCompMm: 0.25, minSatinFloorMm: 0 },
    sources: ["EH-WILCOM", "TD-PULL"],
  },
  shirting: {
    id: "shirting",
    label: "Shirting / lining (light woven)",
    description: "Thin cotton, silk or lining fabric. Puckers and shows needle holes easily, so lighter and looser.",
    needle: { size: "70/10", type: "sharp", note: "Fine point so the holes stay small; 65/9 for the very thinnest silk." },
    stabiliser: { type: "no-show mesh", weight: "light, about 1 oz (30 g/m2)", note: "Soft mesh cut-away that will not show through or scratch; tear-away leaves holes along the stitching." },
    topping: "none",
    hooping: ["Hoop lightly: the fabric should lie flat, not be pulled.", "Keep lining smooth, no ripples in the hoop."],
    engine: { pullCompFactor: 0.9, densityFactor: 1.1, underlayBias: 1.25, zigzagUnderlay: true, fillPullCompMm: 0.2, minSatinFloorMm: 0 },
    sources: ["MF-60WT", "UNVERIFIED (factors)"],
  },
  twill: {
    id: "twill",
    label: "Twill / caps",
    description: "Cotton twill, chinos and structured caps. Stable, but heavier cloth swallows thin lines, so it wants more underlay.",
    needle: { size: "75/11", type: "sharp", note: "80/12 on thick caps or when the thread keeps shredding." },
    stabiliser: { type: "cut-away", weight: "medium, 2 oz (60 g/m2)", note: "For caps use a firm tear-away or cap backing and a cap frame." },
    topping: "none",
    hooping: ["Hoop twill drum-tight.", "Caps: use the cap frame and make sure the seam is centred."],
    engine: { pullCompFactor: 1.15, densityFactor: 1, underlayBias: 0.85, zigzagUnderlay: true, fillPullCompMm: 0.3, minSatinFloorMm: 0 },
    sources: ["EH-WILCOM", "TD-PULL", "UNVERIFIED (cap factors)"],
  },
  knit: {
    id: "knit",
    label: "Knit / polo / jersey",
    description: "Stretchy cloth. It moves under the needle, so it needs a firm backing, more edge compensation and solid underlay.",
    needle: { size: "75/11", type: "ballpoint", note: "A ballpoint slides between the loops instead of cutting them." },
    stabiliser: { type: "cut-away", weight: "medium-heavy, 2.5 oz (75 g/m2)", note: "Always cut-away on knits; tear-away lets the design stretch out of shape in the wash." },
    topping: "none",
    hooping: ["Taut but never stretched: stretched knit springs back and puckers around the design.", "A magnetic hoop holds knits without pulling them."],
    engine: { pullCompFactor: 1.5, densityFactor: 1.1, underlayBias: 0.8, zigzagUnderlay: true, fillPullCompMm: 0.4, minSatinFloorMm: 1 },
    sources: ["EH-THEORY", "TD-PULL"],
  },
  denim: {
    id: "denim",
    label: "Denim",
    description: "Thick, tight cotton. Strong enough to take dense stitching, tough on small needles.",
    needle: { size: "90/14", type: "sharp", note: "A jeans/denim needle (80/12 for lighter denim); a thin needle will deflect or snap." },
    stabiliser: { type: "cut-away", weight: "medium, 2 oz (60 g/m2)", note: "Tear-away is acceptable for heavy denim that does not stretch." },
    topping: "none",
    hooping: ["Hoop drum-tight; thick seams should not sit under the design."],
    engine: { pullCompFactor: 1.1, densityFactor: 1, underlayBias: 0.85, zigzagUnderlay: true, fillPullCompMm: 0.3, minSatinFloorMm: 0 },
    sources: ["UNVERIFIED (denim needle and factors)"],
  },
  towel: {
    id: "towel",
    label: "Towel / terry / fleece",
    description: "Pile fabric. Stitches sink into the loops, so fine lines vanish; use bolder shapes and a see-through topping.",
    needle: { size: "75/11", type: "sharp", note: "80/12 if the pile is deep." },
    stabiliser: { type: "tear-away", weight: "medium", note: "Plus a layer of wash-away topping on top so the thread sits above the pile." },
    topping: "water-soluble",
    hooping: ["Hoop the stabiliser and fabric together without crushing the pile.", "Lay the water-soluble topping over the area before sewing and tear it away after."],
    engine: { pullCompFactor: 1.4, densityFactor: 1.15, underlayBias: 0.75, zigzagUnderlay: true, fillPullCompMm: 0.35, minSatinFloorMm: 2 },
    sources: ["EH-THEORY"],
  },
  leather: {
    id: "leather",
    label: "Leather / faux leather / vinyl",
    description: "Every needle hole is permanent. Looser stitching and light underlay so it does not turn into a perforated line.",
    needle: { size: "75/11", type: "leather/wedge", note: "A sharp or leather needle; not heavy-duty, to avoid big holes." },
    stabiliser: { type: "tear-away", weight: "medium", note: "Tear-away only: cut-away backing makes the piece stiff and the cut edge can show." },
    topping: "none",
    hooping: ["Do not hoop leather, the hoop leaves a permanent ring: float it on sticky stabiliser and hold with clips or tape.", "Test on an offcut: you cannot unpick without leaving holes."],
    engine: { pullCompFactor: 0.8, densityFactor: 1.4, underlayBias: 1.3, zigzagUnderlay: false, fillPullCompMm: 0.15, minSatinFloorMm: 1.5 },
    sources: ["EH-THEORY (spacing about 0.60 mm vs 0.40 mm)", "UNVERIFIED (other factors)"],
  },
};

export interface ThreadPreset {
  weight: ThreadWeight;
  label: string;
  description: string;
  needle: string;
  /** Multiplies satin and fill line spacing: finer thread needs lines closer together for the same cover. */
  densityFactor: number;
  /** Narrowest premium satin column, mm. */
  premiumMinSatinMm: number;
  /** Smallest block letter height that stays legible, mm (informational). */
  minLetterHeightMm: number;
  sources: string[];
}

export const THREAD_WEIGHTS: Readonly<Record<ThreadWeight, ThreadPreset>> = {
  40: {
    weight: 40,
    label: "40 wt (standard)",
    description: "The normal embroidery thread. Good cover on columns and fills; letters from about 6 mm tall.",
    needle: "75/11 for most cloth (70/10 on lining)",
    densityFactor: 1,
    premiumMinSatinMm: 0.8,
    minLetterHeightMm: 6,
    sources: ["EH-WILCOM", "MF-60WT"],
  },
  60: {
    weight: 60,
    label: "60 wt (fine)",
    description: "Thinner thread for small, crisp detail. Stitch lines sit about 12 % closer and finer columns are allowed. Do not swap it into a 40 wt file without redigitizing: coverage drops.",
    needle: "65/9 or 70/10 (75/11 on tougher cloth)",
    densityFactor: 0.88,
    premiumMinSatinMm: 0.7,
    minLetterHeightMm: 3,
    sources: ["MF-60WT", "NAA", "UNVERIFIED (0.88 factor)"],
  },
};

export interface QualityPreset {
  quality: Quality;
  label: string;
  /** Plain-English "what changes". */
  summary: string;
  /**
   * Typical stitch count relative to Standard on logo-style artwork. Measured on a high-contrast serif
   * wordmark and on the DOVE fixture (see engine/src/autodigitize/premium.test.ts); it varies by design.
   */
  stitchCountMultiplier: number;
}

export const QUALITIES: Readonly<Record<Quality, QualityPreset>> = {
  standard: {
    quality: "standard",
    label: "Standard",
    summary: "The original auto-digitize settings: fixed density and underlay, thin strokes sewn as a single running line. Quick and predictable.",
    stitchCountMultiplier: 1,
  },
  premium: {
    quality: "premium",
    label: "Premium",
    summary:
      "Settings a professional digitizer would use: spacing and pull compensation follow each column's width, underlay is chosen by width, fine strokes become narrow satin instead of a faint line, fills get edge-walk and cross underlay, and columns that meet are trimmed so they overlap a hair instead of stacking.",
    stitchCountMultiplier: 0.9,
  },
};

/** What the auto-digitizer takes. `legacy` modes reproduce the original output exactly. */
export interface SewingEngineParams {
  quality: Quality;
  fabric: FabricId;
  threadWeight: ThreadWeight;
  /** Narrowest satin column (mm); thinner strokes become `hairlines`. */
  minSatinWidthMm: number;
  /** Shortest centre-line piece kept (mm). */
  minRunMm: number;
  /** Strokes below `minSatinWidthMm` become narrow satin at that width (else a single/triple run). */
  hairlinesAsSatin: boolean;
  /** Hairlines shorter than this (mm) are a triple run instead of narrow satin. */
  hairlineSatinMinLengthMm: number;
  /** `legacy`: fixed density and the original underlay/pull rules. `width-scaled`: per column width. */
  satinMode: "legacy" | "width-scaled";
  /** Satin line spacing (distance between stitch lines) for columns up to 1 mm wide, mm. */
  satinPitchNarrowMm: number;
  /** Same, for columns 5 mm and wider (linear in between), mm. */
  satinPitchWideMm: number;
  /** Multiplies the satin pull compensation. */
  pullCompFactor: number;
  /** Underlay thresholds scale (see `FabricEngine.underlayBias`). */
  underlayBias: number;
  zigzagUnderlay: boolean;
  /** Split columns wider than this (mm) into staggered halves; null = never. */
  splitMaxWidthMm: number | null;
  /** Shorten stitches on the inside of tight curves. */
  shortStitches: boolean;
  /** Target overlap (mm) where columns meet; null = leave the strips as the skeleton cut them. */
  junctionOverlapMm: number | null;
  /** Overrides for the fill stitch settings of generated fills. */
  fill: Partial<FillParams>;
}

export interface SewingSetup {
  input: Required<SewingSetupInput>;
  fabric: FabricPreset;
  thread: ThreadPreset;
  quality: QualityPreset;
  engine: SewingEngineParams;
  /** Plain-English "Before you sew" card, one line per item. */
  checklist: string[];
  /** One or two sentences describing the setup. */
  summary: string;
}

export const DEFAULT_SEWING_SETUP: Required<SewingSetupInput> = { fabric: "suiting", threadWeight: 40, quality: "standard" };

const round = (v: number, d = 3): number => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Premium base line pitch (mm between stitch lines) for 40 wt: 0.32 on columns up to 1 mm, easing to
 * 0.38 from 5 mm up (0.335-0.365 in the 2-4 mm band that most logo stems fall in). [EH-WILCOM] 0.38-0.40
 * is the plain starting point for cotton/twill; a touch tighter on narrow columns gives cover where a
 * single stitch pair decides the look. [MF-60WT] 0.35-0.40 for 60 wt.
 */
const PREMIUM_PITCH_NARROW_MM = 0.32;
const PREMIUM_PITCH_WIDE_MM = 0.38;
const PITCH_FLOOR_MM = 0.25;
const PITCH_CEIL_MM = 0.7;

/** Resolve a setup (any field optional) into engine parameters, a checklist and a summary. Pure. */
export function resolveSewingSetup(input: SewingSetupInput = {}): SewingSetup {
  const fabricId = canonicalFabric(input.fabric ?? DEFAULT_SEWING_SETUP.fabric);
  const weight: ThreadWeight = input.threadWeight === 60 ? 60 : 40;
  const quality: Quality = input.quality === "premium" ? "premium" : "standard";
  const fabric = FABRICS[fabricId];
  const thread = THREAD_WEIGHTS[weight];
  const q = QUALITIES[quality];
  const fe = fabric.engine;
  const premium = quality === "premium";

  const spacingFactor = fe.densityFactor * thread.densityFactor;
  const clampPitch = (v: number) => round(Math.min(PITCH_CEIL_MM, Math.max(PITCH_FLOOR_MM, v)));
  const fillRow = round(Math.min(0.6, Math.max(0.3, 0.4 * spacingFactor)));

  const fill: Partial<FillParams> = premium
    ? {
        rowSpacingMm: fillRow,
        // [IS-SRC] fill stitch length default 4 mm; [EH-THEORY] 3-4 mm. 3.5 keeps rows from lying loose on curves.
        stitchLengthMm: 3.5,
        pullCompMm: fe.fillPullCompMm,
        underlay: true,
        // [IS-FILL][IS-SRC] perpendicular underlay at about 5x the top spacing, inset so it hides under it.
        underlays: [{ angleDeg: 135, spacingMm: round(Math.max(1.6, fillRow * 5)), stitchLengthMm: 3, insetMm: 0.4 }],
        edgeWalk: { insetMm: 0.4, stitchLengthMm: 2 },
        edgeRun: true,
      }
    : { pullCompMm: round(0.2 * fe.pullCompFactor) };

  const minSatin = Math.max(premium ? thread.premiumMinSatinMm : 1, fe.minSatinFloorMm);
  const engine: SewingEngineParams = {
    quality,
    fabric: fabricId,
    threadWeight: weight,
    minSatinWidthMm: minSatin,
    minRunMm: 1.5,
    hairlinesAsSatin: premium,
    hairlineSatinMinLengthMm: 1.6,
    satinMode: premium ? "width-scaled" : "legacy",
    satinPitchNarrowMm: clampPitch(PREMIUM_PITCH_NARROW_MM * spacingFactor),
    satinPitchWideMm: clampPitch(PREMIUM_PITCH_WIDE_MM * spacingFactor),
    pullCompFactor: fe.pullCompFactor,
    underlayBias: fe.underlayBias,
    zigzagUnderlay: fe.zigzagUnderlay,
    // [HS-CHEAT] sweet spot 2-9 mm; [EH-WILCOM] 7 mm+ wants double zig-zag. Split from 5 mm so stitches stay
    // short enough to lie flat and not snag.
    splitMaxWidthMm: premium ? 5 : null,
    shortStitches: premium,
    junctionOverlapMm: premium ? 0.3 : null,
    fill,
  };

  const checklist = [
    `Fabric: ${fabric.label}. ${fabric.description}`,
    `Needle: ${fabric.needle.size} ${fabric.needle.type}${weight === 60 ? ` (for 60 wt thread: ${thread.needle})` : ""}. ${fabric.needle.note} Start with a fresh one.`,
    `Stabiliser: ${fabric.stabiliser.type}, ${fabric.stabiliser.weight}. ${fabric.stabiliser.note}`,
    fabric.topping === "water-soluble" ? "Topping: lay a sheet of water-soluble topping over the area so the stitches do not sink into the pile." : "Topping: none needed.",
    ...fabric.hooping.map((h) => `Hooping: ${h}`),
    `Thread: ${thread.label} on top${weight === 60 ? "; match the bobbin to it (60 wt bobbin)" : "; a 60 wt bobbin thread is the usual match"}. Check there is a little bobbin thread showing on the back of the satin.`,
    "Test first: sew once on an offcut of the same cloth and stabiliser, then check the hairlines, the crotch of the W and the joins before the real piece.",
    "Slow the machine down for the first run (about 600-700 stitches per minute) and watch the first minute.",
  ];

  const summary = `${q.label} on ${fabric.label.toLowerCase()} with ${thread.label}: ${
    premium
      ? `satin lines ${engine.satinPitchNarrowMm}-${engine.satinPitchWideMm} mm apart, narrowest column ${engine.minSatinWidthMm} mm, underlay chosen by width.`
      : "the original fixed settings" + (fe.pullCompFactor !== 1 ? ` with ${Math.round(fe.pullCompFactor * 100)} % pull compensation.` : ".")
  }`;

  return { input: { fabric: fabricId, threadWeight: weight, quality }, fabric, thread, quality: q, engine, checklist, summary };
}

export const FABRIC_IDS: readonly FabricId[] = Object.keys(FABRICS) as FabricId[];
export const THREAD_WEIGHT_IDS: readonly ThreadWeight[] = [40, 60];
export const QUALITY_IDS: readonly Quality[] = ["standard", "premium"];
