import type { Theme } from "./scene";

/** Parse "#rgb"/"#rrggbb"/"rgb(...)" from a CSS custom property into a 0xRRGGBB number. */
export function cssColorNumber(value: string, fallback: number): number {
  const v = value.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return parseInt(m[1], 16);
  m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return parseInt([...m[1]].map((c) => c + c).join(""), 16);
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v);
  if (m) return (Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3]);
  return fallback;
}

/** Scene colours from the editor's CSS variables, so the canvas follows light/dark. */
export function readTheme(el: Element = document.documentElement): Theme {
  const cs = getComputedStyle(el);
  const get = (name: string, fb: number) => cssColorNumber(cs.getPropertyValue(name), fb);
  return {
    grid: get("--canvas-grid", 0xdcd9d3),
    gridMajor: get("--canvas-grid-major", 0xc5c1b8),
    hoop: get("--canvas-hoop", 0x2f5fd0),
    accent: get("--accent", 0x2f5fd0),
    needle: get("--canvas-needle", 0xe0245e),
  };
}
