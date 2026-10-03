/// <reference path="./opentype.d.ts" />
import { init as initStitch } from "@stitchables/stitchjs";
import * as opentype from "opentype.js";
import { LETTERING_STROKES, median, satinTraits, strokePlan } from "../autodigitize/strokes";
import { DEFAULTS } from "../presets/defaults";
import { polygonFromRings, polygonsOf, ringsOf, unionAll, type Poly } from "../geom";
import { DEFAULT_FILL_PARAMS, DEFAULT_SATIN_PARAMS, type Pt } from "../model";
import { stripWidths } from "./satin";
import type { LetteringWarning, PlacedElement, PlacedGlyph, ShapeContext, Typeface } from "./layout";

/**
 * Custom fonts (TTF / OTF / TTC): glyph outline -> straight skeleton -> per-stroke satin/run/fill.
 *
 * For each glyph at the requested height:
 * 1. flatten the outline (mm, y down) into a polygon (non-zero winding via jsts);
 * 2. take the straight skeleton (str8 via stitchjs; see `autodigitize/spine.ts`), prune spurs, split
 *    at junctions into branches, each with a local half-width (distance to the outline);
 * 3. per branch: width < 1 mm -> running stitch along the skeleton; 1-7 mm -> satin quad strip with
 *    rungs perpendicular to the skeleton; the shape is wider than that (or blobby, or the columns
 *    leave too much uncovered) -> tatami fill with an edge run;
 * 4. pull compensation + underlay are set from the column width.
 * Results are cached per glyph and height.
 */

export const CUSTOM_MIN_HEIGHT_MM = 6;
export const RUN_MAX_WIDTH_MM = 1;
export const SATIN_MAX_WIDTH_MM = 7;
const MIN_AREA_MM2 = 0.15;
const FLATTEN_MM = 0.05;

/** Needed once before laying out custom fonts: loads the straight-skeleton WASM. */
export async function initLettering(): Promise<void> {
  await initStitch();
}

export interface CustomFont {
  readonly kind: "custom";
  readonly name: string;
  readonly font: opentype.Font;
  /** Cap height in font units. */
  readonly capUnits: number;
  readonly cache: Map<string, PlacedElement[]>;
}

// ---------------------------------------------------------------------------------------------
// Loading (TTF/OTF; TTC is split into a stand-alone face first)
// ---------------------------------------------------------------------------------------------

const u32 = (v: DataView, o: number) => v.getUint32(o);
const tagAt = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

export function isCollection(data: ArrayBuffer): boolean {
  return data.byteLength > 12 && tagAt(new DataView(data), 0) === "ttcf";
}

/** Copy face `index` of a TrueType Collection into a stand-alone sfnt (table offsets rewritten). */
export function extractCollectionFace(data: ArrayBuffer, index: number): ArrayBuffer {
  const v = new DataView(data);
  if (tagAt(v, 0) !== "ttcf") return data;
  const count = u32(v, 8);
  if (index < 0 || index >= count) throw new Error(`The collection has ${count} fonts; there is no font number ${index + 1}.`);
  const off = u32(v, 12 + 4 * index);
  const numTables = v.getUint16(off + 4);
  const tables: { tag: number; sum: number; off: number; len: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const r = off + 12 + 16 * i;
    tables.push({ tag: u32(v, r), sum: u32(v, r + 4), off: u32(v, r + 8), len: u32(v, r + 12) });
  }
  let size = 12 + 16 * numTables;
  for (const t of tables) size += (t.len + 3) & ~3;
  const out = new Uint8Array(size);
  const ov = new DataView(out.buffer);
  out.set(new Uint8Array(data, off, 12), 0);
  let cursor = 12 + 16 * numTables;
  tables.forEach((t, i) => {
    const r = 12 + 16 * i;
    ov.setUint32(r, t.tag);
    ov.setUint32(r + 4, t.sum);
    ov.setUint32(r + 8, cursor);
    ov.setUint32(r + 12, t.len);
    out.set(new Uint8Array(data, t.off, t.len), cursor);
    cursor += (t.len + 3) & ~3;
  });
  return out.buffer;
}

export function collectionSize(data: ArrayBuffer): number {
  return isCollection(data) ? u32(new DataView(data), 8) : 1;
}

function nameOf(font: opentype.Font): string {
  // opentype.js 1.x: names[key][lang]; 2.x: names[platform][key][lang].
  const n = font.names as Record<string, Record<string, unknown>>;
  const first = (v: unknown): string | undefined => {
    if (!v || typeof v !== "object") return undefined;
    const rec = v as Record<string, unknown>;
    const s = rec.en ?? Object.values(rec).find((x) => typeof x === "string");
    return typeof s === "string" ? s : undefined;
  };
  const pick = (k: string): string | undefined => {
    const direct = first(n[k]);
    if (direct) return direct;
    for (const platform of ["windows", "unicode", "macintosh"]) {
      const s = first(n[platform]?.[k]);
      if (s) return s;
    }
    return undefined;
  };
  const family = pick("fontFamily") ?? pick("preferredFamily");
  const sub = pick("fontSubfamily") ?? pick("preferredSubfamily");
  return [family, sub && sub !== "Regular" ? sub : ""].filter(Boolean).join(" ") || "Custom font";
}

/** Names of the faces in a file (one entry for plain TTF/OTF). */
export function listFaces(data: ArrayBuffer): { index: number; name: string }[] {
  const n = collectionSize(data);
  const out: { index: number; name: string }[] = [];
  for (let i = 0; i < n; i++) {
    try {
      out.push({ index: i, name: nameOf(opentype.parse(extractCollectionFace(data, i))) });
    } catch {
      out.push({ index: i, name: `Font ${i + 1}` });
    }
  }
  return out;
}

/** Parse an uploaded font file. For a TTC pick the face with `faceIndex` (default 0). */
export function loadCustomFont(data: ArrayBuffer, options: { faceIndex?: number; name?: string } = {}): CustomFont {
  const face = isCollection(data) ? extractCollectionFace(data, options.faceIndex ?? 0) : data;
  let font: opentype.Font;
  try {
    font = opentype.parse(face);
  } catch (e) {
    throw new Error(`That file is not a usable font (${e instanceof Error ? e.message : String(e)}). Use a .ttf, .otf or .ttc file.`);
  }
  const h = font.charToGlyph("H");
  const hTop = Math.max(0, ...h.path.commands.map((c) => Math.max(c.y ?? 0, c.y1 ?? 0, c.y2 ?? 0)));
  const capUnits = font.tables.os2?.sCapHeight || hTop || font.unitsPerEm * 0.7;
  return { kind: "custom", name: options.name ?? nameOf(font), font, capUnits, cache: new Map() };
}

// ---------------------------------------------------------------------------------------------
// Outline -> polygon
// ---------------------------------------------------------------------------------------------

function ringArea(r: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % r.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function glyphRings(g: opentype.Glyph, k: number): Pt[][] {
  const rings: Pt[][] = [];
  let cur: Pt[] = [];
  let cx = 0;
  let cy = 0;
  const P = (x: number, y: number): Pt => [x * k, -y * k];
  const segs = (len: number) => Math.max(3, Math.min(48, Math.ceil(len / (FLATTEN_MM * 8))));
  const flush = () => {
    if (cur.length >= 3) rings.push(cur);
    cur = [];
  };
  for (const c of g.path.commands) {
    if (c.type === "M") {
      flush();
      cx = c.x ?? 0;
      cy = c.y ?? 0;
      cur = [P(cx, cy)];
    } else if (c.type === "L") {
      cx = c.x ?? 0;
      cy = c.y ?? 0;
      cur.push(P(cx, cy));
    } else if (c.type === "Q") {
      const n = segs((Math.hypot((c.x1 ?? 0) - cx, (c.y1 ?? 0) - cy) + Math.hypot((c.x ?? 0) - (c.x1 ?? 0), (c.y ?? 0) - (c.y1 ?? 0))) * k);
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        cur.push(P(u * u * cx + 2 * u * t * (c.x1 ?? 0) + t * t * (c.x ?? 0), u * u * cy + 2 * u * t * (c.y1 ?? 0) + t * t * (c.y ?? 0)));
      }
      cx = c.x ?? 0;
      cy = c.y ?? 0;
    } else if (c.type === "C") {
      const n = segs((Math.hypot((c.x1 ?? 0) - cx, (c.y1 ?? 0) - cy) + Math.hypot((c.x2 ?? 0) - (c.x1 ?? 0), (c.y2 ?? 0) - (c.y1 ?? 0)) + Math.hypot((c.x ?? 0) - (c.x2 ?? 0), (c.y ?? 0) - (c.y2 ?? 0))) * k);
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        cur.push(
          P(
            u * u * u * cx + 3 * u * u * t * (c.x1 ?? 0) + 3 * u * t * t * (c.x2 ?? 0) + t * t * t * (c.x ?? 0),
            u * u * u * cy + 3 * u * u * t * (c.y1 ?? 0) + 3 * u * t * t * (c.y2 ?? 0) + t * t * t * (c.y ?? 0),
          ),
        );
      }
      cx = c.x ?? 0;
      cy = c.y ?? 0;
    } else flush();
  }
  flush();
  // drop repeated closing points
  return rings.map((r) => {
    const out: Pt[] = [];
    for (const p of r) if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > 1e-6) out.push(p);
    if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-6) out.pop();
    return out;
  });
}

/** Non-zero winding fill of a glyph's contours as jsts polygons. */
function outlinePolygons(rings: Pt[][]): Poly[] {
  const valid = rings.filter((r) => r.length >= 3 && Math.abs(ringArea(r)) > 1e-6);
  if (!valid.length) return [];
  const biggest = valid.reduce((a, b) => (Math.abs(ringArea(a)) >= Math.abs(ringArea(b)) ? a : b));
  const dominant = Math.sign(ringArea(biggest));
  const mk = (r: Pt[]): Poly => {
    const p = polygonFromRings(r);
    return p.isValid() ? p : p.buffer(0);
  };
  const pos = valid.filter((r) => Math.sign(ringArea(r)) === dominant).map(mk);
  const neg = valid.filter((r) => Math.sign(ringArea(r)) !== dominant).map(mk);
  let shape = unionAll(pos);
  if (neg.length) shape = shape.difference(unionAll(neg));
  return polygonsOf(shape);
}

// ---------------------------------------------------------------------------------------------
// Polygon -> stitch elements
// ---------------------------------------------------------------------------------------------

function fillOf(part: Poly): PlacedElement {
  const { shell, holes } = ringsOf(part);
  return {
    k: "fill",
    shell,
    holes,
    angle: DEFAULT_FILL_PARAMS.angleDeg,
    rowSpacing: DEFAULT_FILL_PARAMS.rowSpacingMm,
    stitchLen: DEFAULT_FILL_PARAMS.stitchLengthMm,
    pull: DEFAULTS.lettering.fillPullCompMm,
    underlay: part.getArea() > DEFAULTS.lettering.fillUnderlayMinAreaMm2,
    edgeRun: true,
    c: 0,
  };
}

function satinFrom(strip: Pt[]): PlacedElement {
  const w = median(stripWidths(strip));
  return {
    k: "satin",
    strip,
    widthMm: w,
    pull: satinTraits(w).pull,
    underlay: satinTraits(w).underlay,
    density: DEFAULT_SATIN_PARAMS.densityMm,
    c: 0,
  };
}

function runFrom(path: Pt[], closed: boolean): PlacedElement {
  return { k: "run", path, closed, stitchLen: 1.6, repeats: 1, c: 0 };
}

/** Elements for one polygon part (solid area without touching others). */
export function partElements(part: Poly): PlacedElement[] {
  if (part.getArea() < MIN_AREA_MM2) return [];
  // Per-stroke classification lives in autodigitize/strokes.ts (shared with auto-digitizing).
  const plan = strokePlan(part, LETTERING_STROKES);
  if (!plan) return [fillOf(part)];
  return [...plan.satins.map((s) => satinFrom(s.strip)), ...plan.runs.map((r) => runFrom(r.path, r.closed))];
}

/** Elements for a whole glyph outline (rings in mm, y down). */
export function outlineElements(rings: Pt[][]): PlacedElement[] {
  const out: PlacedElement[] = [];
  for (const part of outlinePolygons(rings)) out.push(...partElements(part));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Typeface
// ---------------------------------------------------------------------------------------------

export function customTypeface(cf: CustomFont): Typeface {
  const f = cf.font;
  const upm = f.unitsPerEm;
  const unitsFor = (h: number): number => h / cf.capUnits; // mm per font unit
  return {
    id: `custom:${cf.name}`,
    name: cf.name,
    kind: "custom",
    minHeightMm: CUSTOM_MIN_HEIGHT_MM,
    maxHeightMm: Infinity,
    colors: 1,
    autoSatin: true,
    leadingMm: (h) => (f.ascender - f.descender + (f.tables.hhea?.lineGap ?? 0)) * unitsFor(h),
    shapeLine(rawLine, indexBase, ctx: ShapeContext) {
      const k = unitsFor(ctx.heightMm);
      const lead = rawLine.length - rawLine.trimStart().length;
      const line = rawLine.trim();
      const glyphs: PlacedGlyph[] = [];
      const missing = new Set<string>();
      let pos = 0;
      let prev: opentype.Glyph | null = null;
      let idx = indexBase + lead;
      for (const ch of line) {
        const g = f.charToGlyph(ch);
        const here = idx;
        idx += ch.length;
        if (ch === " " || ch === "\t") {
          pos += (g.advanceWidth ?? upm * 0.3) * k + ctx.wordSpacingMm;
          prev = null;
          continue;
        }
        if (g.index === 0) missing.add(ch);
        if (prev) {
          let kern = 0;
          try {
            kern = f.getKerningValue(prev, g) || 0;
          } catch {
            kern = 0;
          }
          // OpenType convention (opentype.js getKerningValue): negative = tighten, so we ADD it.
          // The built-in Ink/Stitch fonts use the SVG hkern sign instead (subtract); see layout.ts.
          pos += kern * k + ctx.letterSpacingMm;
        }
        const key = `${g.index}@${Math.round(ctx.heightMm * 100)}`;
        let els = cf.cache.get(key);
        if (!els) {
          els = outlineElements(glyphRings(g, k));
          cf.cache.set(key, els);
        }
        const dx = pos;
        const placed: PlacedElement[] = els.map((e) => shift(e, dx));
        if (placed.length) glyphs.push({ char: ch, index: here, els: placed });
        pos += (g.advanceWidth ?? 0) * k;
        prev = g;
      }
      return { glyphs, missing: [...missing] };
    },
    heightWarnings(h): LetteringWarning[] {
      return h < CUSTOM_MIN_HEIGHT_MM - 1e-6
        ? [{ code: "custom-font-small", message: "Custom fonts sew best above 6 mm. Try a built-in font for smaller letters." }]
        : [];
    },
  };
}

function shift(e: PlacedElement, dx: number): PlacedElement {
  const m = ([x, y]: Pt): Pt => [x + dx, y];
  switch (e.k) {
    case "satin":
      return { ...e, strip: e.strip.map(m) };
    case "fill":
      return { ...e, shell: e.shell.map(m), holes: e.holes.map((h) => h.map(m)) };
    case "run":
      return { ...e, path: e.path.map(m) };
  }
}
