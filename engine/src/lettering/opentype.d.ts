// Minimal typings for the parts of opentype.js 2.x that Lilo uses (the package ships none).
declare module "opentype.js" {
  export interface PathCommand {
    type: "M" | "L" | "C" | "Q" | "Z";
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }
  export interface Glyph {
    index: number;
    name: string;
    advanceWidth?: number;
    path: { commands: PathCommand[] };
  }
  export interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    names: Record<string, Record<string, string> | undefined>;
    tables: { os2?: { sCapHeight?: number; sxHeight?: number }; hhea?: { lineGap?: number } };
    charToGlyph(ch: string): Glyph;
    getKerningValue(left: Glyph, right: Glyph): number;
  }
  export function parse(buffer: ArrayBuffer, opt?: Record<string, unknown>): Font;
}
