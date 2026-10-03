import type { GlyphElement, LiloFont } from "./types";

/** Decode a delta-coded centi-mm array (`[x0, y0, dx1, dy1, ...]`) to absolute mm. */
export function decodeCoords(a: readonly number[]): number[] {
  const out = new Array<number>(a.length);
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < a.length; i += 2) {
    x += a[i];
    y += a[i + 1];
    out[i] = x / 100;
    out[i + 1] = y / 100;
  }
  return out;
}

function decodeElement(e: GlyphElement): GlyphElement {
  switch (e.k) {
    case "s":
      return { ...e, rails: [decodeCoords(e.rails[0]), decodeCoords(e.rails[1])], rungs: e.rungs.map(decodeCoords) };
    case "f":
      return { ...e, shell: decodeCoords(e.shell), holes: e.holes?.map(decodeCoords) };
    case "r":
      return { ...e, path: decodeCoords(e.path) };
  }
}

/**
 * Validate and decode a font read from `data/fonts/<id>/font.json` (or a custom Lilo font).
 * Fonts without `enc` are assumed to hold absolute mm already (hand-built test fonts).
 */
export function parseFont(raw: unknown): LiloFont {
  const f = raw as LiloFont;
  if (!f || typeof f !== "object" || f.v !== 1 || typeof f.glyphs !== "object" || typeof f.capHeightMm !== "number") {
    throw new Error("Not a Lilo font");
  }
  if (f.enc !== "delta-cmm") return f;
  const glyphs: LiloFont["glyphs"] = {};
  for (const [k, g] of Object.entries(f.glyphs)) glyphs[k] = { ...g, els: g.els.map(decodeElement) };
  return { ...f, enc: undefined, glyphs };
}

/** Lowest/highest sensible cap height (mm) for a font, from its designed scale range. */
export function fontHeightRange(font: LiloFont): { minMm: number; maxMm: number } {
  return { minMm: font.capHeightMm * font.minScale, maxMm: font.capHeightMm * font.maxScale };
}
