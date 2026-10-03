import type { TraceRegion } from "../clickstitch";
import type { Design, FillParams, Hoop } from "../model";
import type { ThreadEntry } from "../threads";
import type { UnitsToMm } from "./cleanup";

/** The subset of the DOM `ImageData` the engine needs, so it runs in Node, Workers and the page. */
export interface ImageDataLike {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8ClampedArray | Uint8Array;
}

export interface AutoDigitizeOptions {
  /** Number of thread colours to quantise to (2-12). Default 6. */
  colors: number;
  /** Thread catalogue id (see `CATALOGUES`). Default "brother-embroidery". */
  catalogueId: string;
  /** Restrict snapping to these threads (e.g. "My Threads"). Overrides `catalogueId`. */
  threads?: ThreadEntry[];
  /**
   * Finished size. If only one is given the other follows the aspect ratio; if both, the design is
   * scaled to fit inside the box; if neither, the longest side is 60 mm.
   */
  widthMm?: number;
  heightMm?: number;
  /** Regions smaller than this (mm^2) are merged into their best neighbour or dropped. Default 2. */
  minRegionMm2: number;
  /** Outline simplification tolerance in mm. Default 0.1. */
  simplifyMm: number;
  /** Key out the dominant corner colour (or transparency). Default true. */
  removeBackground: boolean;
  /** Longest side the image is downscaled to before processing. Default 1200. */
  maxImageSide: number;
  hoop?: Hoop;
  /**
   * Narrowest satin column (mm). Strokes thinner than this (serif and Didone hairlines) are sewn as a
   * running stitch along their centre; thicker stems of the same letter stay satin. Default 1; a
   * machine that sews clean 0.8 mm columns can go lower.
   */
  minSatinWidthMm?: number;
  /** Centre-line (running stitch) pieces shorter than this (mm) are dropped. Default 1.5. */
  minRunMm?: number;
  /** Overrides for the fill stitch settings of generated fills. */
  fill?: Partial<FillParams>;
}

export const DEFAULT_AUTODIGITIZE_OPTIONS: AutoDigitizeOptions = {
  colors: 6,
  catalogueId: "brother-embroidery",
  minRegionMm2: 2,
  simplifyMm: 0.1,
  removeBackground: true,
  maxImageSide: 1200,
};

export interface PaletteChip {
  /** The catalogue thread this colour snapped to. */
  thread: ThreadEntry;
  /** The colour the quantiser found before snapping ("#rrggbb"). */
  sourceHex: string;
  /** Share of foreground pixels (0..1). */
  share: number;
}

/** What `autoDigitize` reports as it goes, so the UI can animate each stage. */
export type StageEvent =
  | { stage: "prep"; image: ImageDataLike; background: [number, number, number] | null }
  | { stage: "quantize"; image: ImageDataLike; palette: PaletteChip[] }
  | { stage: "trace"; svg: string; width: number; height: number; imageToMm: UnitsToMm }
  | { stage: "cleanup"; design: Design }
  | { stage: "done"; design: Design };

export type ProgressCallback = (event: StageEvent) => void;

export interface AutoDigitizeResult {
  design: Design;
  /** The raw vtracer SVG (pixel units) - the editable "trace" stage. Empty for SVG imports. */
  svg: string;
  palette: PaletteChip[];
  /** Size of the processed image, pixels (SVG: viewBox units). */
  imageWidth: number;
  imageHeight: number;
  /** How image pixels (SVG: user units) map to design mm; for placing a reference image. */
  imageToMm: UnitsToMm;
  /** Image-space coordinates of the image's top-left corner: (0, 0) for rasters, the viewBox origin for SVG. */
  imageOrigin: [number, number];
  /**
   * The trace's connected same-colour areas in design mm, for click-to-stitch. Built from the same
   * trace as `design`, so clicking a region never re-traces.
   */
  traceRegions: TraceRegion[];
}
