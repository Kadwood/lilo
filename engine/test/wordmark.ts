import { readFileSync } from "node:fs";
import * as opentype from "opentype.js";
import { FIXTURE_FONTS_DIR } from "./lettering-helpers";

/**
 * A synthetic high-contrast serif wordmark as an SVG: `text` in Playfair Display (SIL OFL, see
 * fixtures/fonts), a Didone with thick stems, hairline serifs and an O with hairline top/bottom.
 */
export function wordmarkSvg(text: string): string {
  const b = readFileSync(`${FIXTURE_FONTS_DIR}/PlayfairDisplay-VF.ttf`);
  const font = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  let x = 0;
  const d: string[] = [];
  const f = (n: number) => (Math.round(n * 100) / 100).toString();
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    for (const c of g.path.commands) {
      const X = (v?: number) => f(x + (v ?? 0));
      const Y = (v?: number) => f(-(v ?? 0));
      if (c.type === "M" || c.type === "L") d.push(`${c.type}${X(c.x)} ${Y(c.y)}`);
      else if (c.type === "Q") d.push(`Q${X(c.x1)} ${Y(c.y1)} ${X(c.x)} ${Y(c.y)}`);
      else if (c.type === "C") d.push(`C${X(c.x1)} ${Y(c.y1)} ${X(c.x2)} ${Y(c.y2)} ${X(c.x)} ${Y(c.y)}`);
      else d.push("Z");
    }
    x += g.advanceWidth ?? 0;
  }
  const h = font.unitsPerEm;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${-h} ${Math.ceil(x)} ${h * 1.2}"><path fill="#000000" d="${d.join("")}"/></svg>`;
}
