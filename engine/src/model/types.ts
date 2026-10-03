/**
 * The Lilo design model. This is THE source of truth: everything the editor shows, the stitch
 * generator reads and the project file stores is a `Design`. Later milestones (editing, lettering,
 * pixel art) extend it; keep it plain JSON (no classes, Maps or typed arrays) so it survives
 * `JSON.stringify`, structured clone to a Web Worker and Immer patches.
 *
 * Conventions
 * - All geometry is in millimetres. +x is right, +y is DOWN (screen/SVG orientation).
 * - Points are `[x, y]` tuples.
 * - The origin is arbitrary; autodigitize centres the design on (0, 0). Export lets the user pick
 *   which 3x3 anchor of the design's bounding box lands on the machine origin.
 * - Objects are stitched in array order. Adjacent objects with the same `threadId` share one colour
 *   block; a colour change is emitted whenever the thread changes between neighbours.
 */

import type { PathNode } from "./path";

/** Bump when the shape changes incompatibly; `parseDesign` migrates or rejects older files. */
export const DESIGN_VERSION = 1;

/** `[x, y]` in mm. */
export type Pt = readonly [number, number];


export interface Hoop {
  name: string;
  widthMm: number;
  heightMm: number;
}

/** A physical thread, resolved from a catalogue (see `threads.ts`). */
export interface Thread {
  /** Stable id, referenced by `DesignObject.threadId`. Unique within a design. */
  id: string;
  /** e.g. "Brother". */
  brand: string;
  /** Product line within the brand, e.g. "Embroidery". */
  line?: string;
  /** Spool code as printed on the thread, e.g. "513". A string: leading zeros matter ("001"). */
  code: string;
  name: string;
  /** "#rrggbb" display colour. */
  hex: string;
}

/**
 * Object kinds. M4 (lettering) adds `"text"` here, plus its object interface below and a generator
 * registered through `registerObjectGenerator` in `stitch/generate.ts`.
 */
export type ObjectKind = "fill" | "satin" | "run";

/** A filled area: outline plus holes. Stitched as tatami (rows) with optional underlay. */
export interface FillGeometry {
  /** Outer boundary (implicitly closed; first point need not be repeated). */
  shell: Pt[];
  /** Zero or more holes, each implicitly closed. */
  holes: Pt[][];
  /**
   * The nodes the shell was drawn with, when it was drawn (or reshaped) in the editor. `shell` is
   * their flattened outline; editing nodes re-flattens it. Absent for imported/auto-digitized shapes.
   */
  shellNodes?: PathNode[];
  /** Same, per hole (`undefined` entries are plain polylines). */
  holeNodes?: (PathNode[] | undefined)[];
}

/** A satin column: alternating left/right points along the column, `[l0, r0, l1, r1, ...]`. */
export interface SatinGeometry {
  strip: Pt[];
}

/** A running-stitch path. */
export interface RunGeometry {
  path: Pt[];
  closed: boolean;
  /** Nodes the path was drawn with; `path` is their flattened result. See `FillGeometry.shellNodes`. */
  nodes?: PathNode[];
}

export interface FillParams {
  /** Stitch row direction in degrees, measured from +x towards +y (so 45 runs down-right on screen). */
  angleDeg: number;
  rowSpacingMm: number;
  stitchLengthMm: number;
  /** Grow the outline by this much so the finished fill matches the artwork (pull compensation). */
  pullCompMm: number;
  /** Lay a sparse perpendicular stitch layer first to stabilise the fabric. */
  underlay: boolean;
  /**
   * Sew a running-stitch outline along the shell and holes after the fill (default true). Tatami
   * rows stop up to a stitch short of the edge, which looks ragged; the outline gives a clean edge.
   */
  edgeRun?: boolean;
  /** Fill pattern id (see `FILL_PATTERNS`). Default "tatami". */
  pattern?: FillPatternId;
  /** Pattern-specific numbers keyed by `PatternSetting.key`; missing keys use the pattern's default. */
  patternParams?: Record<string, number>;
  /** 0..5: seeded random wobble of needle positions so the fill looks hand-stitched. 0 = off. */
  handStitch?: number;
  /** Seed for every random choice (hand stitch, rainfall, stipple). Default derives from the object id. */
  seed?: number;
  /** Travel through the fill (hidden under the top stitches) instead of jumping between rows. */
  underpath?: boolean;
  /** Row-spacing gradient across the rows of a row-based pattern. */
  gradient?: FillGradient;
  /** Replaces the single `underlay` layer when set: any number of underlay passes. */
  underlays?: FillUnderlay[];
  /** Centre for centred patterns (Circular, Spiral, Tornado, Sunburst). Default: inside the shape. */
  center?: Pt;
  /** Guide curves that steer the Streamlines pattern. */
  guides?: Pt[][];
}

/** One underlay pass under a fill. */
export interface FillUnderlay {
  /** Absolute row direction of the pass in degrees (same convention as `FillParams.angleDeg`). */
  angleDeg: number;
  spacingMm: number;
  stitchLengthMm: number;
  /** Shrink the area by this much so the underlay stays under the top stitches. */
  insetMm: number;
}

/**
 * Spacing gradient: the row spacing is multiplied by a factor that goes from `from` to `to`
 * across the rows ("ramp"), or from `from` at both ends to `to` in the middle ("plateau").
 * Factors above 1 are sparser, below 1 denser. `reverse` flips the direction.
 */
export interface FillGradient {
  kind: "ramp" | "plateau";
  from: number;
  to: number;
  reverse?: boolean;
}

/** Ids come from `FILL_PATTERNS` in `./patterns`. Kept a plain string so older files still load. */
export type FillPatternId = string;

export type SatinUnderlay = "none" | "center" | "contour" | "zigzag";

export interface SatinParams {
  /** Distance between satin stitches along the column. */
  densityMm: number;
  /** Nominal column width, informational (the strip carries the real widths). */
  widthMm: number;
  /** Widen each side by this much (pull compensation). */
  pullCompMm: number;
  underlay: SatinUnderlay;
  /** Split columns wider than this into stitched halves so long satin stitches don't snag. */
  splitMaxWidthMm?: number;
  /** Stagger the split stitches: pattern repeat length in stitches, and sideways shift. */
  staggerCycles?: number;
  staggerAmountMm?: number;
  /** Shorten stitches on the inside of tight curves so they don't pile up. */
  shortStitches?: boolean;
}

/** The seven run types. */
export type RunType = "single" | "triple" | "satin" | "estitch" | "doublerope" | "triplerope" | "manual";

export interface RunParams {
  stitchLengthMm: number;
  /** 1 = single, 3 = triple (each stitch sewn forward-back-forward). Used when `type` is unset. */
  repeats: 1 | 3;
  /** Which run type to sew. Unset: derived from `repeats` (single/triple). */
  type?: RunType;
  /** How far a stitch may stray from the drawn curve (mm, min 0.1). */
  toleranceMm?: number;
  /** Width in mm: satin column width, E-stitch tooth width, rope twist width. */
  widthMm?: number;
  /** E-stitch teeth on the other side of the path. */
  flipped?: boolean;
  /** Satin-along-path settings (density, pull comp, underlay, split, stagger, short stitches). */
  satin?: Partial<SatinParams>;
}

interface ObjectBase {
  /** Unique within the design. */
  id: string;
  name: string;
  /** References `Design.threads[].id`. */
  threadId: string;
  /** Hidden objects are skipped by stitch generation and the canvas. Default true. */
  visible?: boolean;
  /** Locked objects can't be edited in the UI. */
  locked?: boolean;
  /** Where sewing of this object should start / end (mm). Optional; the generator picks the nearest vertex. */
  startPoint?: Pt;
  endPoint?: Pt;
}

export interface FillObject extends ObjectBase {
  kind: "fill";
  geometry: FillGeometry;
  params: FillParams;
}

export interface SatinObject extends ObjectBase {
  kind: "satin";
  geometry: SatinGeometry;
  params: SatinParams;
}

export interface RunObject extends ObjectBase {
  kind: "run";
  geometry: RunGeometry;
  params: RunParams;
}

export type DesignObject = FillObject | SatinObject | RunObject;

export interface Design {
  version: typeof DESIGN_VERSION;
  /** Millimetres per coordinate unit. Always 1 in v1 (geometry is already in mm); reserved for imports. */
  unitsMm: 1;
  hoop: Hoop;
  /** The threads this design uses (a subset of a catalogue, in first-use order). */
  threads: Thread[];
  /** Stitch order. */
  objects: DesignObject[];
}
