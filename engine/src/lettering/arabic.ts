import bidiFactory from "bidi-js";
import { joiningType, type JoiningType } from "./joining-types";
import type { ShapeContext } from "./layout";
import type { Glyph, LiloFont } from "./types";

const bidi = bidiFactory();
const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });
const forms = /^(.*)\.(isol|init|medi|fina)$/u;
type Form = "isol" | "init" | "medi" | "fina";

/** Detect Arabic text; non-Arabic fonts keep their established path for other scripts. */
export const hasArabic = (text: string): boolean => /\p{Script_Extensions=Arabic}/u.test(text);

function presentationChar(char: string): string {
  const cp = char.codePointAt(0)!;
  if (!(cp >= 0xfb50 && cp <= 0xfdff || cp >= 0xfe70 && cp <= 0xfefc)) return char;
  const decomposed = char.normalize("NFKC");
  // Presentation-form diacritics decompose to SPACE/TATWEEL + mark. Neither is text spacing.
  return cp >= 0xfe70 && cp <= 0xfe7f ? decomposed.replace(/^[ \u0640](?=\p{M})/u, "") : decomposed;
}

/** Only Arabic compatibility forms are folded; e.g. Latin ﬃ remains a distinct glyph. */
export const arabicCanonical = (text: string): string => [...text].map(presentationChar).join("").normalize("NFC");

interface Character {
  char: string;
  /** UTF-16 offset in the normalized line, for the bidi algorithm. */
  start: number;
  /** UTF-16 offset in the caller's original text, before compatibility/NFC normalization. */
  source: number;
  joining: JoiningType;
}

function characters(raw: string, indexBase: number, font: LiloFont): Character[] {
  const out: Character[] = [];
  let start = 0;
  for (const segment of graphemes.segment(raw)) {
    const parts: { char: string; source: number; used: boolean }[] = [];
    let offset = indexBase + segment.index;
    let folded = "";
    for (const char of segment.segment) {
      let value = presentationChar(char);
      if (font.letterCase === "upper") value = value.toUpperCase();
      if (font.letterCase === "lower") value = value.toLowerCase();
      folded += value;
      for (const part of value.normalize("NFD")) parts.push({ char: part, source: offset, used: false });
      offset += char.length;
    }
    // Match canonical decomposition components to retain offsets through composition and mark reordering.
    for (const char of folded.normalize("NFC")) {
      const sources: number[] = [];
      for (const part of char.normalize("NFD")) {
        const found = parts.find((p) => !p.used && p.char === part)!;
        found.used = true;
        sources.push(found.source);
      }
      out.push({ char, start, source: Math.min(...sources), joining: joiningType(char) });
      start += char.length;
    }
  }
  return out;
}

interface Candidate {
  name: string;
  chars: string[];
  form?: Form;
  wholeWord: boolean;
}

interface FontIndex {
  candidates: Map<string, Candidate[]>;
  advances: Map<string, number>;
  kerning: Map<string, number>;
  fallback?: string;
}
const cache = new WeakMap<LiloFont, FontIndex>();

function indexOf(font: LiloFont): FontIndex {
  let index = cache.get(font);
  if (index) return index;
  const candidates = new Map<string, Candidate[]>();
  for (const name of Object.keys(font.glyphs)) {
    const match = forms.exec(name);
    const stem = arabicCanonical(match ? match[1] : name);
    const chars = [...stem];
    if (!chars.length) continue;
    const candidate: Candidate = {
      name, chars, form: match?.[2] as Form | undefined,
      wholeWord: !match && chars.length > 1 && hasArabic(stem) && /^\p{L}+$/u.test(stem),
    };
    const list = candidates.get(chars[0]) ?? [];
    list.push(candidate);
    candidates.set(chars[0], list);
  }
  for (const list of candidates.values()) list.sort((a, b) => b.chars.length - a.chars.length || Number(!!b.form) - Number(!!a.form));
  const aliases = (values: Record<string, number>): Map<string, number> => {
    const out = new Map<string, number>();
    for (const [key, value] of Object.entries(values)) {
      const canonical = arabicCanonical(key);
      // Never overwrite a canonical authored key. Callers prefer original exact keys first.
      if (!out.has(canonical) || key === canonical) out.set(canonical, value);
    }
    return out;
  };
  const fallback = font.glyphs[font.defaultGlyph] ? font.defaultGlyph : font.defaultGlyph.trim();
  index = { candidates, advances: aliases(font.adv), kerning: aliases(font.kerning), fallback: font.glyphs[fallback] ? fallback : undefined };
  cache.set(font, index);
  return index;
}

const joinsNext = (t: JoiningType): boolean => t === "D" || t === "L" || t === "C";
const joinsPrevious = (t: JoiningType): boolean => t === "D" || t === "R" || t === "C";
const invisible = (char: string): boolean => /\p{Default_Ignorable_Code_Point}/u.test(char);
const mark = (char: string): boolean => /^\p{M}$/u.test(char);

interface ResolvedGlyph {
  name?: string;
  index: number;
  char: string;
  advance?: number;
}
interface Cluster {
  base?: ResolvedGlyph;
  marks: ResolvedGlyph[];
  space?: boolean;
  rtl: boolean;
}

/** Drawing positions in nominal font mm. `name` always identifies the original embroidery glyph. */
export interface ArabicGlyphPosition {
  name: string;
  index: number;
  x: number;
  y: number;
}

interface YBounds { min: number; max: number }
const yBoundsCache = new WeakMap<Glyph, YBounds>();

function yBounds(glyph: Glyph): YBounds {
  const cached = yBoundsCache.get(glyph);
  if (cached) return cached;
  let min = Infinity;
  let max = -Infinity;
  const include = (points: readonly number[]): void => {
    for (let i = 1; i < points.length; i += 2) {
      min = Math.min(min, points[i]);
      max = Math.max(max, points[i]);
    }
  };
  for (const element of glyph.els) {
    if (element.k === "s") {
      element.rails.forEach(include);
      element.rungs.forEach(include);
    } else if (element.k === "f") {
      include(element.shell);
      element.holes?.forEach(include);
    } else include(element.path);
  }
  const bounds = Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
  yBoundsCache.set(glyph, bounds);
  return bounds;
}

// Arabic marks with below placement. Other supported Arabic combining marks sit above the base.
const belowMark = (char: string): boolean => /[\u064d\u0650\u0656\u065c\u065f\u06e3\u06ea\u06ed\u08f2]/u.test(char);

/** Resolve logical characters, reorder whole clusters with UAX #9, then apply Ink/Stitch metrics. */
export function positionArabic(rawLine: string, indexBase: number, font: LiloFont, ctx: ShapeContext): { glyphs: ArabicGlyphPosition[]; missing: string[] } {
  const lead = rawLine.length - rawLine.trimStart().length;
  const chars = characters(rawLine.trim(), indexBase + lead, font);
  const text = chars.map((c) => c.char).join("");
  const embeddings = bidi.getEmbeddingLevels(text, font.textDirection);
  const ix = indexOf(font);
  const missing = new Set<string>();
  const owners: (Cluster | undefined)[] = new Array(text.length);
  const previous: number[] = [];
  const next: number[] = [];
  let neighbor = -1;
  for (let i = 0; i < chars.length; i++) {
    previous[i] = neighbor;
    if (chars[i].joining !== "T") neighbor = i;
  }
  neighbor = -1;
  for (let i = chars.length - 1; i >= 0; i--) {
    next[i] = neighbor;
    if (chars[i].joining !== "T") neighbor = i;
  }
  const connects = (a: number, b: number): boolean => a >= 0 && b >= 0 &&
    joinsNext(chars[a].joining) && joinsPrevious(chars[b].joining) &&
    embeddings.levels[chars[a].start] === embeddings.levels[chars[b].start];
  const formFor = (first: number, last: number): Form => {
    const before = connects(previous[first], first);
    const after = connects(last, next[last]);
    return before ? after ? "medi" : "fina" : after ? "init" : "isol";
  };
  const own = (i: number, cluster: Cluster): void => {
    for (let j = 0; j < chars[i].char.length; j++) owners[chars[i].start + j] = cluster;
  };
  const resolve = (char: Character, name?: string, allowFallback = true): ResolvedGlyph => {
    if (!name) missing.add(char.char);
    return { name: name ?? (allowFallback ? ix.fallback : undefined), index: char.source, char: char.char };
  };
  let attachment: Cluster | undefined;
  for (let i = 0; i < chars.length;) {
    const current = chars[i];
    const rtl = Boolean(embeddings.levels[current.start] & 1);
    if (invisible(current.char)) {
      // Controls still participate in joining and bidi, but never become fallback stitches.
      if (current.char === "\u200c") attachment = undefined;
      i++;
      continue;
    }
    if (/\s/u.test(current.char)) {
      own(i++, { space: true, marks: [], rtl });
      attachment = undefined;
      continue;
    }
    if (mark(current.char)) {
      const cluster = attachment ?? { marks: [], rtl };
      // A letter-shaped fallback cannot represent a missing zero-width mark without obscuring its
      // base. Report the mark and leave it undrawn; unsupported spacing characters still fallback.
      cluster.marks.push(resolve(current, font.glyphs[current.char] ? current.char : undefined, false));
      own(i++, cluster);
      attachment = cluster;
      continue;
    }
    const mirrored = rtl ? bidi.getMirroredCharacter(current.char) : null;
    const firstChar = mirrored ?? current.char;
    const lookupChar = [firstChar, firstChar.toUpperCase(), firstChar.toLowerCase()].find((c) => ix.candidates.has(c)) ?? firstChar;
    const candidates = ix.candidates.get(lookupChar) ?? [];
    let selected: Candidate | undefined;
    let consumed = [i];
    let last = i;
    for (const candidate of candidates) {
      let j = i;
      const matched: number[] = [];
      let valid = true;
      for (let k = 0; k < candidate.chars.length; k++) {
        if (k) {
          j++;
          while (j < chars.length && chars[j].joining === "T" && !invisible(chars[j].char)) j++;
        }
        if (j >= chars.length || embeddings.levels[chars[j].start] !== embeddings.levels[current.start] ||
          (k ? chars[j].char : lookupChar) !== candidate.chars[k]) { valid = false; break; }
        matched.push(j);
      }
      if (!valid || candidate.form && candidate.form !== formFor(i, j)) continue;
      // A hand-digitized word is indivisible, and must not replace a prefix inside a larger word.
      if (candidate.wholeWord && [previous[i], next[j]].some((n) => n >= 0 && /[\p{L}\p{N}\u200c\u200d]/u.test(chars[n].char))) continue;
      selected = candidate;
      consumed = matched;
      last = j;
      break;
    }
    const base = resolve(current, selected?.name);
    if (selected) {
      const g = font.glyphs[selected.name];
      base.advance = font.adv[selected.name] ?? ix.advances.get(arabicCanonical(selected.name)) ??
        (selected.wholeWord ? g.w + g.x0 : font.advDefaultMm ?? g.w + g.x0);
    }
    const cluster: Cluster = { base, marks: [], rtl };
    for (let j = i; j <= last; j++) {
      own(j, cluster);
      if (!consumed.includes(j) && mark(chars[j].char)) cluster.marks.push(resolve(chars[j], font.glyphs[chars[j].char] ? chars[j].char : undefined, false));
    }
    attachment = cluster;
    i = last + 1;
  }

  const visual: Cluster[] = [];
  const seen = new Set<Cluster>();
  for (const index of bidi.getReorderedIndices(text, embeddings)) {
    const cluster = owners[index];
    if (cluster && !seen.has(cluster)) { visual.push(cluster); seen.add(cluster); }
  }
  const scale = ctx.heightMm / font.capHeightMm;
  const glyphs: ArabicGlyphPosition[] = [];
  let pen = 0;
  let previousGlyph: { name: string; rtl: boolean } | undefined;
  for (const cluster of visual) {
    if (cluster.space) {
      pen += font.spaceMm + ctx.wordSpacingMm / scale;
      previousGlyph = undefined;
      continue;
    }
    const base = cluster.base;
    const g = base?.name ? font.glyphs[base.name] : undefined;
    let x = pen;
    if (base && g && base.name) {
      if (previousGlyph) {
        const pair = cluster.rtl ? [base.name, previousGlyph.name] : [previousGlyph.name, base.name];
        const kern = previousGlyph.rtl !== cluster.rtl ? 0 :
          font.kerning[pair.join(" ")] ?? font.kerning[pair.join("")] ??
          ix.kerning.get(pair.map(arabicCanonical).join(" ")) ?? ix.kerning.get(pair.map(arabicCanonical).join("")) ?? 0;
        pen += g.x0 - kern + ctx.letterSpacingMm / scale;
      }
      x = pen;
      glyphs.push({ name: base.name, index: base.index, x, y: 0 });
      pen += (base.advance ?? font.adv[base.name] ?? font.advDefaultMm ?? g.w + g.x0) - g.x0;
      previousGlyph = { name: base.name, rtl: cluster.rtl };
    } else if (base) {
      pen += font.spaceMm;
      previousGlyph = undefined;
    }
    const markY = new Map<ResolvedGlyph, number>();
    if (g) {
      const baseBounds = yBounds(g);
      // The source fonts have no attachment anchors and store standalone marks far from the
      // baseline (Malika explicitly asks Ink/Stitch users to move them by hand). Attach them to
      // the actual ink instead. Reversing canonical mark order puts shadda nearest the letter and
      // a vowel above it; below marks use the same deterministic stacking rule.
      const gap = font.capHeightMm * 0.025;
      let above = baseBounds.min - gap;
      let below = baseBounds.max + gap;
      for (const m of [...cluster.marks].reverse()) {
        if (!m.name) continue;
        const bounds = yBounds(font.glyphs[m.name]);
        if (belowMark(m.char)) {
          const y = below - bounds.min;
          markY.set(m, y);
          below = bounds.max + y + gap;
        } else {
          const y = above - bounds.max;
          markY.set(m, y);
          above = bounds.min + y - gap;
        }
      }
    }
    for (const m of cluster.marks) {
      if (!m.name) continue;
      const drawing = font.glyphs[m.name];
      // Marks never advance the pen or replace the preceding base used for kerning/spacing.
      glyphs.push({ name: m.name, index: m.index, x: g ? x + (g.w - drawing.w) / 2 : x, y: markY.get(m) ?? 0 });
    }
  }
  return { glyphs, missing: [...missing] };
}
