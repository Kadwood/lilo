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
  /**
   * Edge-walk underlay: a running-stitch loop along the shell and holes, `insetMm` inside the edge,
   * sewn before the tatami underlay. It fences the fabric so the top stitches don't pull the edge in.
   */
  edgeWalk?: { insetMm: number; stitchLengthMm: number };
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

/**
 * `contour-zigzag` is the "German" underlay: an edge walk up both sides and a loose zig-zag back,
 * for wide columns (Ink/Stitch: contour + zig-zag together).
 */
export type SatinUnderlay = "none" | "center" | "contour" | "zigzag" | "contour-zigzag";

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
  /** Stitch length (mm) of the centre / edge-walk underlay passes. Unset: the stitchjs default (3). */
  underlayStitchMm?: number;
  /** How far the edge walk / zig-zag underlay stays inside the column edge (mm). Unset: stitchjs default (0.6). */
  underlayInsetMm?: number;
  /** Peak-to-peak spacing of the zig-zag underlay (mm). Unset: stitchjs default (3). */
  underlayZigzagMm?: number;
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

/**
 * Set on objects generated by the Text tool (M4 lettering): every object of one text block shares
 * `group` (a `TextBlock.id`), so the editor can select, move or regenerate the whole word.
 */
export interface SourceText {
  group: string;
  /** The character this object belongs to (undefined for non-letter extras). */
  char?: string;
  /** 0-based line number within the block. */
  line?: number;
  /** 0-based position of the character in the block's text. */
  index?: number;
}

/** The parameters a text block was made with, kept so it can be edited later. */
export interface TextBlock {
  id: string;
  text: string;
  /** Built-in font id (`data/fonts/<id>`) or `custom:<name>` for an uploaded font. */
  fontId: string;
  /** Cap height in mm. */
  heightMm: number;
  letterSpacingMm: number;
  /** Multiplier of the font's line pitch. */
  lineSpacing: number;
  align: "left" | "center" | "right";
  /** Where the left end of the first baseline (or the alignment anchor) sits, mm. */
  origin: Pt;
  /** Text-on-path guide, if any (`PathGuide` in engine/src/lettering). */
  path?: unknown;
  /**
   * Where the block's layout centre sits now, mm. Kept in step with every move, rotate, scale and
   * flip of the word, so editing the text re-lays it out where it is, not where it was typed.
   * Absent in older files (re-layout then centres on the letters' bounding box).
   */
  centre?: Pt;
  /**
   * The linear part `[a, b, c, d]` of the transforms the user applied to the word (rotation, scale,
   * flip), as in `Affine`. Absent means none. Re-layout applies it to the fresh letters.
   */
  linear?: readonly [number, number, number, number];
}

interface ObjectBase {
  /** Unique within the design. */
  id: string;
  /** Present when the object came from the Text tool. */
  sourceText?: SourceText;
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
  /** Id of the `Design.mapGroups` entry this object was mapped to a path by, until it is detached. */
  mapGroup?: string;
}

/** How a selection is repeated along a path (the "map to path" action). */
export interface MapToPathOptions {
  /** "count": exactly `count` copies spread over the path. "spacing": as many as fit, `spacingMm` apart. */
  mode: "count" | "spacing";
  count: number;
  spacingMm: number;
  /** Turn each copy to follow the path's direction. */
  rotate: boolean;
  /** Start from the far end of the path. */
  reverse: boolean;
}

/** A live "map to path": the originals and the path, kept so the mapping can be edited until detached. */
export interface MapGroup {
  sources: DesignObject[];
  path: Pt[];
  closed: boolean;
  options: MapToPathOptions;
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

/**
 * A reference picture placed behind the stitches to trace over. The pixels live in the project file
 * (`images/`), not in the design: this is only where and how it is shown, so moving, fading,
 * reordering and removing images are ordinary undoable design edits.
 */
export interface DesignImage {
  /** Unique within the design; also the key of the bytes in the project file. */
  id: string;
  name: string;
  mime: string;
  /** Natural size in px (aspect ratio). */
  w: number;
  h: number;
  /** Top-left corner, mm. */
  x: number;
  y: number;
  widthMm: number;
  /** 0..1. */
  opacity: number;
  locked: boolean;
  visible: boolean;
}

export interface Design {
  version: typeof DESIGN_VERSION;
  /** Millimetres per coordinate unit. Always 1 in v1 (geometry is already in mm); reserved for imports. */
  unitsMm: 1;
  hoop: Hoop;
  /** The threads this design uses (a subset of a catalogue, in first-use order). */
  threads: Thread[];
  /** Stitch order. */
  objects: DesignObject[];
  /** Live map-to-path groups by id. Objects point at one through `mapGroup`. */
  mapGroups?: Record<string, MapGroup>;
  /** Text blocks behind `objects[].sourceText` (optional; absent in designs without lettering). */
  textBlocks?: TextBlock[];
  /** Reference images, bottom first (optional). Not stitched. */
  images?: DesignImage[];
}
