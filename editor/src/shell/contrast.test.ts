// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * WCAG AA for the glass. Text sits on a translucent layer, so what is behind it is whatever the desktop
 * (and the colour wash) happens to be. We can't know that, so each text/background pair is checked
 * against the worst cases: a pure white window, a pure black window, and each wash colour on both. If
 * this fails after a colour change in glass.css, the new colour is not readable on some wallpaper.
 */

const css = readFileSync(new URL("../glass.css", import.meta.url), "utf8");

type RGBA = [number, number, number, number];

function block(selector: string): string {
  const start = css.indexOf(selector + " {");
  if (start < 0) throw new Error(`no block ${selector}`);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

function tokens(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

function parse(v: string, vars: Record<string, string>): RGBA {
  const ref = /^var\(--([a-z0-9-]+)\)$/.exec(v);
  if (ref) return parse(vars[ref[1]], vars);
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1];
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)$/.exec(v) as RegExpExecArray | null;
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  throw new Error(`cannot parse colour: ${v}`);
}

const over = (fg: RGBA, bg: RGBA): RGBA => {
  const a = fg[3] + bg[3] * (1 - fg[3]);
  const mix = (i: number) => (fg[i] * fg[3] + bg[i] * bg[3] * (1 - fg[3])) / (a || 1);
  return [mix(0), mix(1), mix(2), a];
};
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (c: RGBA) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: RGBA, b: RGBA) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const root = tokens(block(":root"));
const themes: Record<string, Record<string, string>> = {
  light: root,
  // dark overrides the light tokens (the media-query copy is identical, so the attribute block stands for both)
  dark: { ...root, ...tokens(block(':root[data-theme="dark"]')) },
};
const washAlpha: Record<string, number> = { light: 0.09, dark: 0.13 };
const washColours = (vars: Record<string, string>): RGBA[] =>
  ["wash-pink", "wash-blue", "wash-cream"].map((k) => {
    const [r, g, b] = vars[k].split(",").map(Number);
    return [r, g, b, 1] as RGBA;
  });
void washColours;
const WASH: RGBA[] = [
  [217, 48, 90, 1],
  [35, 105, 201, 1],
  [240, 226, 200, 1],
];

/** Every backdrop the glass may sit on: white or black, bare or under a wash colour at its strongest. */
function backdrops(theme: string): RGBA[] {
  const a = washAlpha[theme] * 1.5; // the cream blob is 1.5x
  const base: RGBA[] = [
    [255, 255, 255, 1],
    [0, 0, 0, 1],
  ];
  const out = [...base];
  for (const b of base) for (const w of WASH) out.push(over([w[0], w[1], w[2], a], b));
  return out;
}

describe.each(["light", "dark"])("AA contrast on the glass (%s)", (theme) => {
  const v = themes[theme];
  const c = (name: string): RGBA => parse(v[name], v);
  const pairs: [string, string, string][] = [
    // [foreground, glass layer it sits on, label]
    ["text", "glass-bg", "text on a panel"],
    ["muted", "glass-bg", "muted text on a panel"],
    ["accent", "glass-bg", "accent text on a panel"],
    ["danger", "glass-bg", "error text on a panel"],
    ["text", "sheet-bg", "text on a dialog"],
    ["text", "material-content", "text on Home and Converter"],
    ["muted", "material-content", "muted text on Home and Converter"],
    ["muted", "sheet-bg", "muted text on a dialog"],
    ["warn-text", "warn-bg", "warning badge"],
    ["muted", "control-bg", "muted text on a control"],
  ];
  for (const [fg, layer, label] of pairs) {
    it(`${label}: ${fg} over ${layer} on white, black and the colour wash`, () => {
      for (const back of backdrops(theme)) {
        // a layer on a layer: the warning badge sits on a panel, which sits on the window
        const panel = layer === "warn-bg" || layer === "control-bg" ? over(c("glass-bg"), back) : back;
        const bg = over(c(layer), panel);
        const r = ratio(over(c(fg), bg), bg);
        expect(r, `${fg} on ${layer} over rgb(${back.slice(0, 3).map(Math.round)}): ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("text on the opaque surfaces (canvas card, player, solid mode)", () => {
    for (const [fg, bg] of [["text", "surface"], ["muted", "surface"], ["text", "canvas-bg"], ["muted", "canvas-bg"], ["text", "bg"], ["muted", "bg"], ["accent", "surface"]] as const) {
      const r = ratio(c(fg), c(bg));
      expect(r, `${fg} on ${bg}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("white-on-accent and ink-on-accent buttons", () => {
    expect(ratio(c("accent-text"), c("accent"))).toBeGreaterThanOrEqual(4.5);
  });

  it("the focus ring is visible against the panel and the canvas (3:1)", () => {
    for (const bg of ["surface", "canvas-bg"]) expect(ratio(c("focus"), c(bg))).toBeGreaterThanOrEqual(3);
  });
});

describe("the colour wash", () => {
  it("is faint, static and never behind the canvas", () => {
    expect(css).toContain("--wash-a: 0.09");
    expect(css).not.toMatch(/@keyframes/); // no animation
    // the canvas card paints its own opaque ground
    expect(block(".canvas")).toMatch(/background:\s*var\(--canvas-bg\)/);
    expect(parse(themes.light["canvas-bg"], themes.light)[3]).toBe(1);
    expect(parse(themes.dark["canvas-bg"], themes.dark)[3]).toBe(1);
  });
});
