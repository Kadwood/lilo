/**
 * Lilo font format (`data/fonts/<id>/font.json`), converted from Ink/Stitch's hand-digitized
 * embroidery fonts by `scripts/import-fonts.mjs`.
 *
 * Everything is in millimetres at the font's NOMINAL size (Ink/Stitch's "100%" scale), +y DOWN, with
 * y = 0 on the baseline and x = 0 at the glyph's left-most point (the glyph's `x0` margin is kept
 * separately, see `Glyph.x0`). Coordinates are flat `[x0, y0, x1, y1, ...]` arrays so the JSON stays
 * small. Layout scales every glyph by `heightMm / capHeightMm`.
 */

/** How the font's licence was classified by the importer. */
export type LicenceClass = "OFL" | "PD" | "CC0" | "CC-BY" | "CC-BY-SA";

export interface FontLicence {
  /** Normalised SPDX-ish id. */
  id: LicenceClass;
  /** Verbatim `font_license` from the upstream font.json. */
  label: string;
  /** Verbatim LICENSE text, kept next to the font as `LICENSE` and mirrored here for display. */
  text?: string;
}

/** Underlay of a satin column (maps to `SatinUnderlay`). */
export type FontUnderlay = "none" | "center" | "contour" | "zigzag";

/** A satin column: two rails and the rungs that cross them (Ink/Stitch's `satin_column`). */
export interface GlyphSatin {
  k: "s";
  /** Rail 1 and rail 2, flat xy arrays. Already corrected for `reverse_rails`. */
  rails: [number[], number[]];
  /** Rungs, each a flat xy array (2+ points). Empty = rails are paired by arc length. */
  rungs: number[][];
  /** Pull compensation per side, mm (0 = none). */
  pull?: number;
  /** Underlay (default "none"). */
  ul?: FontUnderlay;
  /** Stitch spacing along the column, mm (default 0.4). */
  dens?: number;
  /** Colour index into `LiloFont.colors` (default 0). */
  c?: number;
}

/** A tatami fill: outer ring + holes. */
export interface GlyphFill {
  k: "f";
  shell: number[];
  holes?: number[][];
  /** Row direction in degrees (SVG convention, y down). */
  angle?: number;
  rowSpacing?: number;
  stitchLen?: number;
  /** Pull compensation (`expand_mm`), mm. */
  expand?: number;
  underlay?: boolean;
  c?: number;
}

/** A running-stitch path. */
export interface GlyphRun {
  k: "r";
  path: number[];
  closed?: boolean;
  stitchLen?: number;
  /** 1 or 3 (bean stitch). */
  repeats?: 1 | 3;
  c?: number;
}

export type GlyphElement = GlyphSatin | GlyphFill | GlyphRun;

export interface Glyph {
  /** Width of the glyph's drawing (right - left), mm. */
  w: number;
  /** Left margin, mm: Ink/Stitch's `min_x` (the glyph was drawn this far right of its origin). */
  x0: number;
  els: GlyphElement[];
}

export type LetterCase = "" | "upper" | "lower";

export interface LiloFont {
  /** Format version. */
  v: 1;
  /**
   * On disk, coordinate arrays are delta-coded integers in 0.01 mm (`[x0, y0, dx1, dy1, ...]`) to keep
   * the files small. `parseFont` decodes them, so everything in memory is absolute mm.
   */
  enc?: "delta-cmm";
  id: string;
  name: string;
  licence: FontLicence;
  description?: string;
  /** Upstream attribution (original typeface). */
  originalFont?: string;
  originalFontUrl?: string;
  keywords?: string[];
  /** Height of a capital letter at nominal (100%) size, mm. `heightMm` in the API is measured against it. */
  capHeightMm: number;
  /** Lowest/highest scale (fraction of nominal) the font was designed for (Ink/Stitch min_scale/max_scale). */
  minScale: number;
  maxScale: number;
  letterCase: LetterCase;
  /** Ink/Stitch's `auto_satin`: columns inside a letter should be routed as one continuous path. */
  autoSatin: boolean;
  /** Ink/Stitch's `reversible` (alternate line direction on every other line; informational for Lilo). */
  reversible: boolean;
  textDirection: "ltr" | "rtl";
  /** Line pitch at nominal size, mm (Ink/Stitch `leading`). */
  leadingMm: number;
  /** Advance of a space, mm (Ink/Stitch `horiz_adv_x_space`). */
  spaceMm: number;
  /** Default glyph advance, mm; null = glyph.w + glyph.x0. */
  advDefaultMm: number | null;
  /** Per-character advance from glyph origin (x = 0 + x0 offset), mm. */
  adv: Record<string, number>;
  /** "A B" -> mm to subtract from the pen position (positive tightens). */
  kerning: Record<string, number>;
  /** Fallback glyph name (e.g. "�" or " "). */
  defaultGlyph: string;
  /** Distinct colours used by glyph elements, hex. Length 1 for single-colour fonts. */
  colors: string[];
  glyphs: Record<string, Glyph>;
}

/** One row of `data/fonts/index.json`. */
export interface FontIndexEntry {
  id: string;
  name: string;
  licence: LicenceClass;
  licenceLabel: string;
  /** Characters the font can draw (sorted, as a string). */
  coverage: string;
  glyphCount: number;
  minHeightMm: number;
  maxHeightMm: number;
  /** Cap height at nominal size, mm. */
  capHeightMm: number;
  colors: number;
  autoSatin: boolean;
  /** "satin" | "fill" | "run" mixes present, e.g. ["satin"]. */
  kinds: string[];
  keywords: string[];
  /** Size of font.json in bytes. */
  bytes: number;
  /** Relative to data/fonts/<id>/. */
  preview: string;
}
