import { type SatinUnderlay,
  DEFAULT_FILL_PARAMS,
  DEFAULT_RUN_PARAMS,
  DEFAULT_SATIN_PARAMS,
  type Bounds,
  type DesignObject,
  type Pt,
} from "../model";
import { railsToStrip, stripWidths, toPts } from "./satin";
import type { Glyph, LetterCase, LiloFont } from "./types";

/**
 * Text layout: turns a string and a font into design objects (satin columns, fills, runs).
 *
 * `layoutText` is font-agnostic. A `Typeface` shapes ONE line into placed glyphs (built-in Ink/Stitch
 * fonts: `builtinTypeface`; uploaded TTF/OTF: `customTypeface` in ./custom). Layout then handles
 * multi-line stacking, alignment, text on a path, ordering and the model objects.
 */

export type TextAlign = "left" | "center" | "right";

/** Text-on-path guide. Angles are degrees in screen space (y down): x = cx + r cos, y = cy + r sin. */
export type PathGuide =
  | { kind: "polyline"; points: Pt[] }
  | { kind: "arc"; center: Pt; radiusMm: number; startDeg: number; endDeg: number };

export interface LetteringWarning {
  code: "below-min-height" | "above-max-height" | "missing-glyph" | "custom-font-small" | "text-longer-than-path" | "empty-text" | "glyph-failed";
  message: string;
}

export interface LayoutOptions {
  /** Cap height in mm. */
  heightMm: number;
  /** Thread for every object (multi-colour fonts use `threadIds` in colour order instead). */
  threadId: string;
  threadIds?: string[];
  /** Extra space between letters, mm (default 0). */
  letterSpacingMm?: number;
  /** Extra space between words, mm (default 0). */
  wordSpacingMm?: number;
  /** Multiplier of the font's line pitch (default 1). */
  lineSpacing?: number;
  align?: TextAlign;
  /** Put the text along this path instead of a straight baseline. */
  onPath?: PathGuide;
  /** Where the baseline's left end (or, for centre/right alignment, the anchor) goes. Default [0, 0]. */
  origin?: Pt;
  /** Object id prefix; ids are `<prefix>-1`, `<prefix>-2`... Default "txt". */
  idPrefix?: string;
}

export interface LayoutResult {
  objects: DesignObject[];
  warnings: LetteringWarning[];
  bounds: Bounds | null;
}

/** An element in final mm, relative to its glyph's drawing origin (x = 0 at the left edge, y = 0 baseline). */
export type PlacedElement =
  | { k: "satin"; strip: Pt[]; widthMm: number; pull: number; underlay: SatinUnderlay; density: number; c: number }
  | { k: "fill"; shell: Pt[]; holes: Pt[][]; angle: number; rowSpacing: number; stitchLen: number; pull: number; underlay: boolean; edgeRun: boolean; c: number }
  | { k: "run"; path: Pt[]; closed: boolean; stitchLen: number; repeats: 1 | 3; c: number };

export interface PlacedGlyph {
  char: string;
  /** Index of the character in the original text (after trimming). */
  index: number;
  /** Elements in final mm with the glyph's left edge at x (already added). */
  els: PlacedElement[];
}

export interface ShapeContext {
  heightMm: number;
  letterSpacingMm: number;
  wordSpacingMm: number;
}

export interface Typeface {
  readonly id: string;
  readonly name: string;
  readonly kind: "builtin" | "custom";
  /** Lowest/highest cap height (mm) the font was designed for. */
  readonly minHeightMm: number;
  readonly maxHeightMm: number;
  /** Number of colours (1 for most). */
  readonly colors: number;
  /** Route columns of a glyph as one continuous path (Ink/Stitch `auto_satin`). */
  readonly autoSatin: boolean;
  readonly textDirection?: "ltr" | "rtl";
  /** Line pitch in mm at `heightMm`. */
  leadingMm(heightMm: number): number;
  /** Shape one line (no newlines). `indexBase` is the offset of the line's first char in the text. */
  shapeLine(line: string, indexBase: number, ctx: ShapeContext): { glyphs: PlacedGlyph[]; missing: string[] };
  /** Font-specific warnings for a height. */
  heightWarnings?(heightMm: number): LetteringWarning[];
}

// ---------------------------------------------------------------------------------------------
// Built-in (Ink/Stitch) typeface
// ---------------------------------------------------------------------------------------------

const MIN_FILL_AREA_MM2 = 0.3;
const STRIP_SPACING_MM = 0.6;

interface Index {
  multi: Map<string, string[]>;
}
const indexCache = new WeakMap<LiloFont, Index>();

function indexOf(font: LiloFont): Index {
  let ix = indexCache.get(font);
  if (!ix) {
    const multi = new Map<string, string[]>();
    for (const name of Object.keys(font.glyphs)) {
      const cps = [...name];
      // Skip Arabic positional shapes ("x.init"): shaping is not implemented.
      if (cps.length < 2 || /\.(isol|init|medi|fina)$/.test(name)) continue;
      const list = multi.get(cps[0]) ?? [];
      list.push(name);
      multi.set(cps[0], list);
    }
    for (const list of multi.values()) list.sort((a, b) => b.length - a.length);
    ix = { multi };
    indexCache.set(font, ix);
  }
  return ix;
}

function areaOf(ring: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

function place(g: Glyph, scale: number, dx: number): PlacedElement[] {
  const pt = (flat: readonly number[]): Pt[] => toPts(flat).map(([x, y]) => [dx + x * scale, y * scale] as Pt);
  const out: PlacedElement[] = [];
  for (const e of g.els) {
    if (e.k === "s") {
      const strip = railsToStrip([pt(e.rails[0]), pt(e.rails[1])], e.rungs.map(pt), STRIP_SPACING_MM);
      if (strip.length < 4) continue;
      out.push({
        k: "satin",
        strip,
        widthMm: median(stripWidths(strip)),
        pull: e.pull ?? 0,
        underlay: e.ul ?? "none",
        density: e.dens ?? DEFAULT_SATIN_PARAMS.densityMm,
        c: e.c ?? 0,
      });
    } else if (e.k === "f") {
      const shell = pt(e.shell);
      if (shell.length < 3 || areaOf(shell) < MIN_FILL_AREA_MM2) continue;
      out.push({
        k: "fill",
        shell,
        holes: (e.holes ?? []).map(pt).filter((h) => h.length >= 3),
        angle: e.angle ?? DEFAULT_FILL_PARAMS.angleDeg,
        rowSpacing: e.rowSpacing ?? DEFAULT_FILL_PARAMS.rowSpacingMm,
        stitchLen: e.stitchLen ?? DEFAULT_FILL_PARAMS.stitchLengthMm,
        pull: e.expand ?? 0,
        underlay: e.underlay ?? true,
        edgeRun: false,
        c: e.c ?? 0,
      });
    } else {
      const path = pt(e.path);
      if (path.length < 2) continue;
      out.push({ k: "run", path, closed: Boolean(e.closed), stitchLen: e.stitchLen ?? DEFAULT_RUN_PARAMS.stitchLengthMm, repeats: e.repeats ?? 1, c: e.c ?? 0 });
    }
  }
  return out;
}

function applyCase(s: string, lc: LetterCase): string {
  return lc === "upper" ? s.toUpperCase() : lc === "lower" ? s.toLowerCase() : s;
}

/**
 * Wrap an Ink/Stitch-derived font as a `Typeface`. Pen arithmetic follows Ink/Stitch
 * `Font._render_line` / `_render_glyph`: the glyph's drawn left margin (`x0`) is added when it
 * follows another glyph in the same word, kerning is subtracted, advances come from `horiz_adv_x`.
 */
export function builtinTypeface(font: LiloFont): Typeface {
  const ix = indexOf(font);
  const heightRange = { min: font.capHeightMm * font.minScale, max: font.capHeightMm * font.maxScale };

  const lookup = (word: string, i: number): { name: string; len: number } | null => {
    const first = String.fromCodePoint(word.codePointAt(i)!);
    for (const name of ix.multi.get(first) ?? []) if (word.startsWith(name, i)) return { name, len: name.length };
    if (font.glyphs[first]) return { name: first, len: first.length };
    // Case fallback (Ink/Stitch has none; a missing "a" in a caps font should not turn into a blank).
    for (const alt of [first.toUpperCase(), first.toLowerCase()]) if (alt !== first && font.glyphs[alt]) return { name: alt, len: first.length };
    return null;
  };

  return {
    id: font.id,
    name: font.name,
    kind: "builtin",
    minHeightMm: heightRange.min,
    maxHeightMm: heightRange.max,
    colors: font.colors.length,
    autoSatin: font.autoSatin,
    textDirection: font.textDirection,
    leadingMm: (h) => font.leadingMm * (h / font.capHeightMm),
    shapeLine(rawLine, indexBase, ctx) {
      const s = ctx.heightMm / font.capHeightMm;
      const rtl = font.textDirection === "rtl";
      let line = rawLine;
      const lead = rawLine.length - rawLine.trimStart().length;
      line = line.trim();
      if (rtl) line = [...line].reverse().join("");
      const glyphs: PlacedGlyph[] = [];
      const missing = new Set<string>();
      let pos = 0;
      let charIndex = indexBase + lead;
      const words = line.split(" ");
      words.forEach((rawWord, wi) => {
        const word = applyCase(rawWord, font.letterCase);
        let last: string | null = null;
        let i = 0;
        while (i < word.length) {
          const hit = lookup(word, i);
          const ch = word.slice(i, i + (hit ? hit.len : String.fromCodePoint(word.codePointAt(i)!).length));
          let name: string | null = hit?.name ?? null;
          if (!hit) {
            missing.add(ch);
            name = font.glyphs[font.defaultGlyph] ? font.defaultGlyph : null;
          }
          const g = name ? font.glyphs[name] : undefined;
          const idx = charIndex;
          charIndex += ch.length;
          i += ch.length;
          if (!g || !name) {
            pos += font.spaceMm * s;
            last = null;
            continue;
          }
          if (last !== null) {
            let kern = rtl ? (font.kerning[`${name} ${last}`] ?? font.kerning[name + last]) : (font.kerning[`${last} ${name}`] ?? font.kerning[last + name]);
            kern = kern ?? 0;
            // SVG hkern convention (positive = tighten), as Ink/Stitch lib/lettering/font.py:487:
            //   position.x += glyph.min_x - kerning + letter_spacing
            // so we SUBTRACT kern. (Custom/OpenType fonts use the opposite sign; see custom.ts.)
            pos += g.x0 * s - kern * s + ctx.letterSpacingMm;
          }
          const els = place(g, s, pos);
          if (els.length) glyphs.push({ char: name, index: idx, els });
          const adv = font.adv[name] ?? font.advDefaultMm ?? g.w + g.x0;
          pos += (adv - g.x0) * s;
          last = name;
        }
        pos += font.spaceMm * s + ctx.wordSpacingMm;
        if (wi < words.length - 1) charIndex += 1; // the space
      });
      return { glyphs, missing: [...missing] };
    },
    heightWarnings(h) {
      const w: LetteringWarning[] = [];
      if (h < heightRange.min - 1e-6) {
        w.push({
          code: "below-min-height",
          message: `${font.name} is designed for ${fmt(heightRange.min)}-${fmt(heightRange.max)} mm letters; ${fmt(h)} mm will sew poorly (threads pile up). Try a smaller font or ${fmt(heightRange.min)} mm or more.`,
        });
      } else if (h > heightRange.max + 1e-6) {
        w.push({
          code: "above-max-height",
          message: `${font.name} is designed for ${fmt(heightRange.min)}-${fmt(heightRange.max)} mm letters; ${fmt(h)} mm will look sparse or leave long stitches.`,
        });
      }
      return w;
    },
  };
}

const fmt = (n: number): string => (Math.round(n * 10) / 10).toString();

// ---------------------------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------------------------

interface Polyline {
  pts: Pt[];
  cum: number[];
  length: number;
}

function polylineOf(guide: PathGuide): Polyline {
  let pts: Pt[];
  if (guide.kind === "polyline") pts = guide.points;
  else {
    const a0 = (guide.startDeg * Math.PI) / 180;
    const a1 = (guide.endDeg * Math.PI) / 180;
    const n = Math.max(12, Math.ceil((Math.abs(a1 - a0) * guide.radiusMm) / 0.5));
    pts = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([guide.center[0] + guide.radiusMm * Math.cos(a), guide.center[1] + guide.radiusMm * Math.sin(a)]);
    }
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, length: cum[cum.length - 1] };
}

/** Point and unit tangent at arc length `s` (clamped ends extend straight along the end tangent). */
function sample(pl: Polyline, s: number): { p: Pt; t: Pt } {
  const n = pl.pts.length;
  let seg: number;
  if (s <= 0) seg = 0;
  else if (s >= pl.length) seg = n - 2;
  else {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pl.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    seg = lo;
  }
  const a = pl.pts[seg];
  const b = pl.pts[seg + 1];
  const l = pl.cum[seg + 1] - pl.cum[seg] || 1;
  const t: Pt = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  const u = s - pl.cum[seg];
  return { p: [a[0] + t[0] * u, a[1] + t[1] * u], t };
}

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

function elementPoints(e: PlacedElement): Pt[] {
  return e.k === "satin" ? e.strip : e.k === "fill" ? e.shell : e.path;
}

function mapElement(e: PlacedElement, f: (p: Pt) => Pt): PlacedElement {
  switch (e.k) {
    case "satin":
      return { ...e, strip: e.strip.map(f) };
    case "fill":
      return { ...e, shell: e.shell.map(f), holes: e.holes.map((h) => h.map(f)) };
    case "run":
      return { ...e, path: e.path.map(f) };
  }
}

/** Order a glyph's satin columns by nearest end from the current needle position. */
function routeSatins(els: PlacedElement[], from: Pt): { els: PlacedElement[]; end: Pt } {
  const ends = (e: PlacedElement): [Pt, Pt] => {
    if (e.k === "satin") {
      const s = e.strip;
      const mid = (i: number): Pt => [(s[i][0] + s[i + 1][0]) / 2, (s[i][1] + s[i + 1][1]) / 2];
      return [mid(0), mid(s.length - 2)];
    }
    const pts = elementPoints(e);
    return [pts[0], pts[pts.length - 1]];
  };
  const left = [...els];
  const out: PlacedElement[] = [];
  let pos = from;
  while (left.length) {
    let bi = 0;
    let bd = Infinity;
    let flip = false;
    left.forEach((e, i) => {
      const [a, b] = ends(e);
      const da = Math.hypot(a[0] - pos[0], a[1] - pos[1]);
      const db = Math.hypot(b[0] - pos[0], b[1] - pos[1]);
      if (da < bd) {
        bd = da;
        bi = i;
        flip = false;
      }
      if (db < bd) {
        bd = db;
        bi = i;
        flip = true;
      }
    });
    const [e] = left.splice(bi, 1);
    const [a, b] = ends(e);
    pos = flip ? a : b;
    out.push(e);
  }
  return { els: out, end: pos };
}

/** Lay out `text` in `font` and return model objects (satin/fill/run) ready to insert in a design. */
export function layoutText(text: string, fontOrTypeface: LiloFont | Typeface, opts: LayoutOptions): LayoutResult {
  const face: Typeface = "shapeLine" in fontOrTypeface ? fontOrTypeface : builtinTypeface(fontOrTypeface);
  const warnings: LetteringWarning[] = [];
  const h = opts.heightMm;
  if (!(h > 0)) throw new Error("heightMm must be positive");
  const ctx: ShapeContext = { heightMm: h, letterSpacingMm: opts.letterSpacingMm ?? 0, wordSpacingMm: opts.wordSpacingMm ?? 0 };
  const align: TextAlign = opts.align ?? "left";
  const origin: Pt = opts.origin ?? [0, 0];
  const lineGap = face.leadingMm(h) * (opts.lineSpacing ?? 1);
  warnings.push(...(face.heightWarnings?.(h) ?? []));

  // 1. Shape every line (glyphs positioned along an x axis starting at 0).
  const normalized = text.normalize("NFC");
  const lines: { glyphs: PlacedGlyph[]; minX: number; maxX: number }[] = [];
  const missing = new Set<string>();
  let indexBase = 0;
  for (const raw of normalized.split(/\r\n|\r|\n/)) {
    const shaped = face.shapeLine(raw, indexBase, ctx);
    indexBase += raw.length + 1;
    shaped.missing.forEach((m) => missing.add(m));
    let minX = Infinity;
    let maxX = -Infinity;
    for (const g of shaped.glyphs) for (const e of g.els) for (const [x] of elementPoints(e)) (minX = Math.min(minX, x)), (maxX = Math.max(maxX, x));
    lines.push({ glyphs: shaped.glyphs, minX: Number.isFinite(minX) ? minX : 0, maxX: Number.isFinite(maxX) ? maxX : 0 });
  }
  if (missing.size) warnings.push({ code: "missing-glyph", message: `This font has no glyph for: ${[...missing].join(" ")}` });
  if (lines.every((l) => l.glyphs.length === 0)) {
    warnings.push({ code: "empty-text", message: "Nothing to stitch: the text is empty." });
    return { objects: [], warnings, bounds: null };
  }

  // 2. Alignment shifts and placement (straight baseline or along a path).
  const guide = opts.onPath ? polylineOf(opts.onPath) : null;
  const placedGlyphs: { g: PlacedGlyph; els: PlacedElement[]; line: number }[] = [];
  lines.forEach((line, li) => {
    const w = line.maxX - line.minX;
    // Align the INK of each line on the origin (the anchor); text-on-path aligns against the path instead.
    const shiftX = align === "left" ? -line.minX : align === "center" ? -(line.minX + line.maxX) / 2 : -line.maxX;
    const y = li * lineGap;
    if (guide) {
      const room = guide.length - w;
      if (room < -1e-6 && li === 0) {
        warnings.push({ code: "text-longer-than-path", message: `The text is ${fmt(w)} mm long but the path is only ${fmt(guide.length)} mm; the end runs off the path.` });
      }
      const start = (align === "left" ? 0 : align === "center" ? room / 2 : room) - line.minX;
      for (const g of line.glyphs) {
        let gMin = Infinity;
        let gMax = -Infinity;
        for (const e of g.els) for (const [x] of elementPoints(e)) (gMin = Math.min(gMin, x)), (gMax = Math.max(gMax, x));
        const xc = (gMin + gMax) / 2;
        const { p, t } = sample(guide, start + xc);
        const up: Pt = [t[1], -t[0]];
        const map = ([x, py]: Pt): Pt => {
          const lx = x - xc;
          const ly = py + y;
          return [p[0] + t[0] * lx - up[0] * ly, p[1] + t[1] * lx - up[1] * ly];
        };
        placedGlyphs.push({ g, els: g.els.map((e) => mapElement(e, map)), line: li });
      }
    } else {
      for (const g of line.glyphs) placedGlyphs.push({ g, els: g.els.map((e) => mapElement(e, ([x, py]) => [origin[0] + x + shiftX, origin[1] + py + y])), line: li });
    }
  });

  // 3. Ordering: per glyph (routed for auto-satin fonts), then colour-grouped for multi-colour fonts.
  const ordered: { g: PlacedGlyph; e: PlacedElement; line: number }[] = [];
  let needle: Pt = [origin[0], origin[1]];
  for (const pg of placedGlyphs) {
    let els = pg.els;
    if (face.autoSatin && els.every((e) => e.k === "satin") && els.length > 1) {
      const r = routeSatins(els, needle);
      els = r.els;
      needle = r.end;
    } else if (els.length) {
      const pts = elementPoints(els[els.length - 1]);
      needle = pts[pts.length - 1];
    }
    for (const e of els) ordered.push({ g: pg.g, e, line: pg.line });
  }
  if (face.colors > 1) ordered.sort((a, b) => a.e.c - b.e.c); // stable: keeps reading order inside a colour

  // 4. Model objects.
  const prefix = opts.idPrefix ?? "txt";
  const threadFor = (c: number): string => (opts.threadIds && opts.threadIds.length ? opts.threadIds[c % opts.threadIds.length] : opts.threadId);
  const counts = new Map<string, number>();
  const objects: DesignObject[] = ordered.map(({ g, e, line }, n) => {
    const id = `${prefix}-${n + 1}`;
    const key = `${g.index}/${e.k}`;
    const k = (counts.get(key) ?? 0) + 1;
    counts.set(key, k);
    const base = {
      id,
      name: `"${g.char}" ${e.k}${k > 1 ? ` ${k}` : ""}`,
      threadId: threadFor(e.c),
      sourceText: { group: prefix, char: g.char, line, index: g.index },
    };
    switch (e.k) {
      case "satin":
        return {
          ...base,
          kind: "satin",
          geometry: { strip: e.strip },
          params: { densityMm: e.density, widthMm: Math.round(e.widthMm * 10) / 10, pullCompMm: e.pull, underlay: e.underlay },
        };
      case "fill":
        return {
          ...base,
          kind: "fill",
          geometry: { shell: e.shell, holes: e.holes },
          params: { ...DEFAULT_FILL_PARAMS, angleDeg: e.angle, rowSpacingMm: e.rowSpacing, stitchLengthMm: e.stitchLen, pullCompMm: e.pull, underlay: e.underlay, edgeRun: e.edgeRun },
        };
      case "run":
        return { ...base, kind: "run", geometry: { path: e.closed ? e.path.slice(0, -1) : e.path, closed: e.closed }, params: { stitchLengthMm: e.stitchLen, repeats: e.repeats } };
    }
  });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { e } of ordered)
    for (const [x, y] of elementPoints(e)) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  const bounds: Bounds | null = Number.isFinite(minX) ? { minX, minY, maxX, maxY, widthMm: maxX - minX, heightMm: maxY - minY } : null;
  return { objects, warnings, bounds };
}
