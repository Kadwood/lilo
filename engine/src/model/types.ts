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

export type ObjectKind = "fill" | "satin" | "run";

/** A filled area: outline plus holes. Stitched as tatami (rows) with optional underlay. */
export interface FillGeometry {
  /** Outer boundary (implicitly closed; first point need not be repeated). */
  shell: Pt[];
  /** Zero or more holes, each implicitly closed. */
  holes: Pt[][];
}

/** A satin column: alternating left/right points along the column, `[l0, r0, l1, r1, ...]`. */
export interface SatinGeometry {
  strip: Pt[];
}

/** A running-stitch path. */
export interface RunGeometry {
  path: Pt[];
  closed: boolean;
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
}

export type SatinUnderlay = "none" | "center" | "contour" | "zigzag";

export interface SatinParams {
  /** Distance between satin stitches along the column. */
  densityMm: number;
  /** Nominal column width, informational (the strip carries the real widths). */
  widthMm: number;
  /** Widen each side by this much (pull compensation). */
  pullCompMm: number;
  underlay: SatinUnderlay;
}

export interface RunParams {
  stitchLengthMm: number;
  /** 1 = single, 3 = triple (each stitch sewn forward-back-forward). */
  repeats: 1 | 3;
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
