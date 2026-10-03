/**
 * Ink/Stitch embroidery font -> Lilo font. Used by `scripts/import-fonts.mjs` (build time); the
 * editor and engine only ever read the converted JSON.
 *
 * Ported semantics (Ink/Stitch `lib/lettering/font_variant.py` + `glyph.py`, GPL-3.0-or-later):
 * - glyphs live in layers labelled `GlyphLayer-<name>` of `ltr.svg`;
 * - the layer's drawing is moved so its left edge is x = 0 (`min_x` is remembered) and the
 *   `baseline` guide is y = 0;
 * - `font.json` carries advances, kerning, scale limits, letter case, auto-satin...
 * User units are CSS px (96 per inch); we convert to mm at the font's nominal size.
 */
import { applyMatrix, IDENTITY, multiply, parseColor, parsePathData, parseTransform, parseXml, type Matrix, type Node, type P } from "../autodigitize/svg";
import type { Glyph, GlyphElement, FontUnderlay, LetterCase, LiloFont, LicenceClass } from "./types";

const MM_PER_PX = 25.4 / 96;
/** Curve flattening tolerance (mm). */
const FLATTEN_MM = 0.02;
/** Simplification tolerance (mm). */
const SIMPLIFY_MM = 0.03;

export interface ConvertStats {
  satin: number;
  fill: number;
  run: number;
  /** Elements using a stitch type Lilo cannot sew faithfully (cross stitch, meander...). */
  unsupported: number;
  skipped: number;
  glyphs: number;
  /** Baseline guide missing or implausible. */
  baselineGuess: boolean;
  /** Ratio of mm-per-viewBox-unit to the px assumption, should be ~1. */
  unitRatio: number;
}

export interface ConvertInput {
  id: string;
  /** Contents of font.json. */
  meta: Record<string, unknown>;
  /** Contents of every ltr svg (usually one; some fonts split glyphs across several files). */
  svgs: string[];
  licence: { id: LicenceClass; label: string; text?: string };
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

function styleMap(attrs: Record<string, string>): Record<string, string> {
  const s: Record<string, string> = {};
  for (const k of ["fill", "stroke", "stroke-width", "stroke-dasharray", "display"]) if (attrs[k] !== undefined) s[k] = attrs[k];
  if (attrs.style) {
    for (const decl of attrs.style.split(";")) {
      const i = decl.indexOf(":");
      if (i > 0) s[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim();
    }
  }
  return s;
}

const truthy = (v: string | undefined): boolean => v !== undefined && /^(true|1|yes)$/i.test(v.trim());
const numAttr = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Ramer-Douglas-Peucker on a polyline. */
function simplify(pts: P[], tol: number, closed = false): P[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let md = 0;
    let mi = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      let d: number;
      if (l2 < 1e-18) d = Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      else {
        const t = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / l2));
        d = Math.hypot(pts[i][0] - (ax + dx * t), pts[i][1] - (ay + dy * t));
      }
      if (d > md) {
        md = d;
        mi = i;
      }
    }
    if (mi >= 0 && md > tol) {
      keep[mi] = 1;
      stack.push([a, mi], [mi, b]);
    }
  }
  const out = pts.filter((_, i) => keep[i]);
  return closed && out.length < 3 ? pts : out;
}

/** Delta-coded integer hundredths of a mm: `[x0, y0, dx1, dy1, ...]` (see `decodeCoords`). */
const flat = (pts: P[]): number[] => {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  for (const [x, y] of pts) {
    const cx = Math.round(x * 100);
    const cy = Math.round(y * 100);
    out.push(cx - px, cy - py);
    px = cx;
    py = cy;
  }
  return out;
};

function ringArea(r: P[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % r.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function inRing(p: P, r: P[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Even-odd grouping of rings into polygons (shell + holes). */
function groupPolygons(rings: P[][]): { shell: P[]; holes: P[][] }[] {
  const rs = rings.filter((r) => r.length >= 3 && Math.abs(ringArea(r)) > 1e-6).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  const depth = rs.map((r, i) => {
    let d = 0;
    for (let j = 0; j < i; j++) if (inRing(r[0], rs[j])) d++;
    return d;
  });
  const polys: { shell: P[]; holes: P[][] }[] = [];
  const owner = new Map<number, number>();
  rs.forEach((r, i) => {
    if (depth[i] % 2 === 0) {
      owner.set(i, polys.length);
      polys.push({ shell: r, holes: [] });
    } else {
      // nearest enclosing even-depth ring (smallest area containing it)
      for (let j = i - 1; j >= 0; j--) {
        if (depth[j] % 2 === 0 && owner.has(j) && inRing(r[0], rs[j])) {
          polys[owner.get(j)!].holes.push(r);
          break;
        }
      }
    }
  });
  return polys;
}

interface Raw {
  node: Node;
  m: Matrix;
}

function collectPaths(node: Node, m: Matrix, out: Raw[], hidden = false): void {
  for (const c of node.children) {
    if (c.name === "defs" || c.name === "clippath" || c.name === "symbol" || c.name === "marker" || c.name === "metadata" || c.name === "namedview") continue;
    const st = styleMap(c.attrs);
    const hide = hidden || st.display === "none";
    const cm = multiply(m, parseTransform(c.attrs.transform));
    if (c.name === "path" && c.attrs.d && !hide) out.push({ node: c, m: cm });
    else if (c.name === "g") collectPaths(c, cm, out, hide);
  }
}

function findAll(node: Node, name: string, out: Node[] = []): Node[] {
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

interface RawGlyph {
  name: string;
  els: GlyphElement[];
  minX: number; // px
  width: number; // px
  minY: number; // px relative baseline
  maxY: number;
}

const UNSUPPORTED_FILL = new Set(["cross_stitch", "meander_fill", "circular_fill", "linear_gradient_fill", "tartan_fill", "guided_fill"]);

function convertLayer(layer: Node, mmPerUu: number, colors: string[], stats: ConvertStats): RawGlyph | null {
  const label = decodeEntities(layer.attrs["inkscape:label"] ?? "");
  const name = label.slice("GlyphLayer-".length).normalize("NFC");
  const raws: Raw[] = [];
  collectPaths(layer, multiply(IDENTITY, parseTransform(layer.attrs.transform)), raws);

  const colorIndex = (hex: string | null): number => {
    const h = hex ?? "#000000";
    let k = colors.indexOf(h);
    if (k < 0) {
      colors.push(h);
      k = colors.length - 1;
    }
    return k;
  };

  // First pass in px (user units): flatten + transform every path.
  interface Item {
    kind: "satin" | "fill" | "run";
    rings: { pts: P[]; closed: boolean }[];
    attrs: Record<string, string>;
    st: Record<string, string>;
    d: string;
    m: Matrix;
  }
  const items: Item[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { node, m } of raws) {
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    const rings = parsePathData(node.attrs.d, FLATTEN_MM / (scale * mmPerUu))
      .map((r) => ({ pts: r.pts.map((p) => applyMatrix(m, p)), closed: r.closed }))
      .filter((r) => r.pts.length >= 2);
    if (!rings.length) continue;
    const st = styleMap(node.attrs);
    const a = node.attrs;
    let kind: Item["kind"];
    if (truthy(a["inkstitch:satin_column"])) kind = "satin";
    else if (st.fill && st.fill !== "none") kind = "fill";
    else if (st.stroke && st.stroke !== "none") kind = "run";
    else {
      stats.skipped++;
      continue;
    }
    for (const r of rings)
      for (const [x, y] of r.pts) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    items.push({ kind, rings, attrs: a, st, d: node.attrs.d, m });
  }
  if (!items.length || !Number.isFinite(minX)) return null;

  const T = (p: P): P => [(p[0] - minX) * mmPerUu, p[1] * mmPerUu];
  const els: GlyphElement[] = [];
  for (const it of items) {
    const a = it.attrs;
    if (it.kind === "satin") {
      const subs = it.rings.map((r) => (r.closed ? [...r.pts, r.pts[0]] : r.pts));
      // Old-style columns (two subpaths, no rungs) pair their path NODES as rungs; curves are flattened
      // in `subs`, so read the nodes separately.
      const nodes =
        subs.length === 2
          ? parsePathData(it.d, 1e9)
              .map((r) => (r.closed ? [...r.pts, r.pts[0]] : r.pts).map((p) => applyMatrix(it.m, p)))
              .filter((r) => r.length >= 2)
          : null;
      let sat: { rails: [P[], P[]]; rungs: P[][] } | null;
      if (subs.length === 1) {
        // A single path is a stroke with a width: Ink/Stitch converts it into a satin column.
        const sw = (numAttr(it.st["stroke-width"]) ?? 1) * (Math.sqrt(Math.abs(it.m[0] * it.m[3] - it.m[1] * it.m[2])) || 1);
        const nodePts = parsePathData(it.d, 1e9)[0]?.pts.map((q) => applyMatrix(it.m, q)) ?? [];
        sat = strokeToSatin(subs[0], nodePts, sw / 2, it.rings[0].closed);
      } else {
        sat = satinRailsRungs(subs, nodes, a["inkstitch:reverse_rails"] ?? "automatic", truthy(a["inkstitch:swap_satin_rails"]));
      }
      if (!sat) {
        stats.skipped++;
        continue;
      }
      const r1 = sat.rails[0].map(T);
      const r2_ = sat.rails[1].map(T);
      const rungs = sat.rungs.map((r) => r.map(T));
      const pull = numAttr(a["inkstitch:pull_compensation_mm"]);
      const dens = numAttr(a["inkstitch:zigzag_spacing_mm"]);
      let ul: FontUnderlay = "none";
      if (truthy(a["inkstitch:contour_underlay"])) ul = "contour";
      else if (truthy(a["inkstitch:center_walk_underlay"])) ul = "center";
      else if (truthy(a["inkstitch:zigzag_underlay"])) ul = "zigzag";
      const el: GlyphElement = {
        k: "s",
        rails: [flat(simplify(r1, SIMPLIFY_MM)), flat(simplify(r2_, SIMPLIFY_MM))],
        rungs: rungs.map((r) => flat(simplify(r, SIMPLIFY_MM))),
      };
      if (pull) el.pull = r2(Math.max(0, Math.min(0.6, pull)));
      if (ul !== "none") el.ul = ul;
      if (dens) el.dens = r2(Math.max(0.2, Math.min(1, dens)));
      const col = parseColor(it.st.stroke) ?? parseColor(it.st.fill);
      const ci = colorIndex(col);
      if (ci) el.c = ci;
      els.push(el);
      stats.satin++;
      const sm = a["inkstitch:satin_method"];
      if (sm === "zigzag" || sm === "s_curve") stats.unsupported++;
    } else if (it.kind === "fill") {
      const method = a["inkstitch:fill_method"] ?? "";
      if (UNSUPPORTED_FILL.has(method)) stats.unsupported++;
      const polys = groupPolygons(it.rings.map((r) => r.pts.map(T)));
      const angle = numAttr(a["inkstitch:angle"]);
      const spacing = numAttr(a["inkstitch:row_spacing_mm"]);
      const expand = numAttr(a["inkstitch:expand_mm"]);
      const ci = colorIndex(parseColor(it.st.fill));
      for (const p of polys) {
        const el: GlyphElement = { k: "f", shell: flat(simplify(p.shell, SIMPLIFY_MM, true)) };
        if (p.holes.length) el.holes = p.holes.map((h) => flat(simplify(h, SIMPLIFY_MM, true)));
        // Ink/Stitch angles are y-up CCW degrees; SVG/Lilo is y-down, so negate.
        if (angle !== undefined) el.angle = -angle;
        if (spacing) el.rowSpacing = r2(Math.max(0.2, spacing));
        if (expand) el.expand = r2(Math.max(0, Math.min(0.6, expand)));
        if (a["inkstitch:fill_underlay"] !== undefined) el.underlay = truthy(a["inkstitch:fill_underlay"]);
        if (ci) el.c = ci;
        els.push(el);
        stats.fill++;
      }
    } else {
      const sm = a["inkstitch:stroke_method"] ?? "";
      if (sm && sm !== "running_stitch" && sm !== "manual_stitch" && sm !== "ripple_stitch") stats.unsupported++;
      const ci = colorIndex(parseColor(it.st.stroke));
      const len = numAttr(a["inkstitch:running_stitch_length_mm"]);
      const bean = numAttr(a["inkstitch:bean_stitch_repeats"]);
      for (const r of it.rings) {
        const pts = (r.closed ? [...r.pts, r.pts[0]] : r.pts).map(T);
        const el: GlyphElement = { k: "r", path: flat(simplify(pts, SIMPLIFY_MM)) };
        if (r.closed) el.closed = true;
        if (len) el.stitchLen = r2(Math.max(0.8, Math.min(6, len)));
        if (bean && bean > 0) el.repeats = 3;
        if (ci) el.c = ci;
        els.push(el);
        stats.run++;
      }
    }
  }
  const w = (maxX - minX) * mmPerUu;
  return { name, els, minX: minX * mmPerUu, width: w, minY: minY * mmPerUu, maxY: maxY * mmPerUu };
}

// ---------------------------------------------------------------------------------------------
// Satin column structure (port of Ink/Stitch lib/elements/satin_column: rail_indices, rungs, reversal)
// ---------------------------------------------------------------------------------------------

const lenOf = (pts: P[]): number => {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
};

function segHit(a: P, b: P, c: P, d: P): boolean {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  const eps = 1e-6;
  if (Math.abs(den) < 1e-12) return false;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  return t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps;
}

function pathsIntersect(a: P[], b: P[]): boolean {
  for (let i = 0; i + 1 < a.length; i++) for (let j = 0; j + 1 < b.length; j++) if (segHit(a[i], a[i + 1], b[j], b[j + 1])) return true;
  return false;
}

function pointAtFraction(pts: P[], f: number): P {
  const total = lenOf(pts);
  let want = Math.max(0, Math.min(1, f)) * total;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (want <= l || i === pts.length - 1) {
      const t = l > 0 ? Math.min(1, want / l) : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    }
    want -= l;
  }
  return pts[pts.length - 1];
}

/** Which subpaths are rails (Ink/Stitch `rail_indices`). */
function railIndices(paths: P[][]): number[] {
  const n = paths.length;
  if (n <= 2) return paths.map((_, i) => i);
  const counts = paths.map((p, i) => paths.reduce((c, q, j) => c + (i !== j && pathsIntersect(p, q) ? 1 : 0), 0));
  const possible = paths.map((_, i) => i).filter((i) => (n === 3 ? counts[i] === 1 : counts[i] > 2) && lenOf(paths[i]) > 0.1);
  if (possible.length === 2) return possible;
  return paths
    .map((_, i) => i)
    .sort((x, y) => lenOf(paths[y]) - lenOf(paths[x]))
    .slice(0, 2);
}

/** Ink/Stitch's `automatic` rail reversal: reverse rail 2 if corresponding points are closer that way. */
function autoReverse(r1: P[], r2: P[]): boolean {
  let same = 0;
  let flipped = 0;
  for (let i = 0; i < 10; i++) {
    const f = i / 10;
    const a = pointAtFraction(r1, f);
    const b = pointAtFraction(r2, f);
    const c = pointAtFraction(r2, 1 - f);
    same += Math.hypot(a[0] - b[0], a[1] - b[1]);
    flipped += Math.hypot(a[0] - c[0], a[1] - c[1]);
  }
  return same > flipped;
}

function satinRailsRungs(subs: P[][], nodes: P[][] | null, reverseChoice: string, swap: boolean): { rails: [P[], P[]]; rungs: P[][] } | null {
  const paths = subs.filter((p) => p.length > 1);
  if (paths.length < 2) return null;
  const idx = railIndices(paths);
  let rails: [P[], P[]] = [paths[idx[0]], paths[idx[1]]];
  let rungs = paths.filter((_, i) => !idx.includes(i));
  let rev: [boolean, boolean] = [false, false];
  if (reverseChoice === "first") rev = [true, false];
  else if (reverseChoice === "second") rev = [false, true];
  else if (reverseChoice === "both") rev = [true, true];
  else if (reverseChoice === "automatic" && autoReverse(rails[0], rails[1])) rev = [false, true];

  if (paths.length === 2 && nodes && nodes.length === 2) {
    // Synthesize rungs from node pairs.
    const equal = nodes[0].length === nodes[1].length;
    const ends = nodes.map((pts, i) => {
      const p = rev[i] ? [...pts].reverse() : pts;
      if (p.length > 2 || !equal) return p.slice(1, -1);
      return [pointAtFraction(p, 0.2 / Math.max(1e-9, lenOf(p)))];
    });
    rungs = [];
    const n = Math.min(ends[0].length, ends[1].length);
    for (let i = 0; i < n; i++) {
      const a = ends[0][i];
      const b = ends[1][i];
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      // Ink/Stitch scales each rung 1.1x about its centre so it surely crosses both rails.
      rungs.push([
        [mx + (a[0] - mx) * 1.1, my + (a[1] - my) * 1.1],
        [mx + (b[0] - mx) * 1.1, my + (b[1] - my) * 1.1],
      ]);
    }
  }
  rails = [rev[0] ? [...rails[0]].reverse() : rails[0], rev[1] ? [...rails[1]].reverse() : rails[1]];
  if (swap) rails = [rails[1], rails[0]];
  return { rails, rungs };
}

/**
 * Single-path satin (a stroke with a width, Ink/Stitch `convert_path_to_satin`): rails are the path
 * offset by half the stroke width on both sides (mitred, clamped), with a rung at every node.
 */
function strokeToSatin(pts: P[], nodes: P[], half: number, closed: boolean): { rails: [P[], P[]]; rungs: P[][] } | null {
  // drop repeated points
  const v: P[] = [];
  for (const q of pts) if (!v.length || Math.hypot(q[0] - v[v.length - 1][0], q[1] - v[v.length - 1][1]) > 1e-9) v.push(q);
  if (closed && v.length > 2 && Math.hypot(v[0][0] - v[v.length - 1][0], v[0][1] - v[v.length - 1][1]) < 1e-9) v.pop();
  if (v.length < 2 || half <= 0) return null;
  const n = v.length;
  const seg = (i: number): P => {
    const a = v[i];
    const b = v[(i + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const offsetAt = (i: number): P => {
    const hasPrev = closed || i > 0;
    const hasNext = closed || i < n - 1;
    const t1 = hasPrev ? seg((i - 1 + n) % n) : seg(i);
    const t2 = hasNext ? seg(i) : t1;
    // normal = rotate tangent by +90 degrees
    const n1: P = [-t1[1], t1[0]];
    const n2: P = [-t2[1], t2[0]];
    let mx = n1[0] + n2[0];
    let my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) return n2;
    mx /= ml;
    my /= ml;
    const cos = Math.max(0.4, mx * n2[0] + my * n2[1]); // miter clamp (about 2.5x)
    return [mx / cos, my / cos];
  };
  const L: P[] = [];
  const R: P[] = [];
  for (let i = 0; i < n; i++) {
    const o = offsetAt(i);
    L.push([v[i][0] + o[0] * half, v[i][1] + o[1] * half]);
    R.push([v[i][0] - o[0] * half, v[i][1] - o[1] * half]);
  }
  if (closed) {
    L.push(L[0]);
    R.push(R[0]);
  }
  const rungs: P[][] = [];
  for (const q of nodes) {
    let bi = -1;
    let bd = 1e-6;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(v[i][0] - q[0], v[i][1] - q[1]);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (bi > 0 && bi < n - 1) rungs.push([L[bi], R[bi]]);
  }
  return { rails: [L, R], rungs };
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

/** Convert one Ink/Stitch font. Throws if no glyphs could be read. */
export function convertInkstitchFont(input: ConvertInput): { font: LiloFont; stats: ConvertStats } {
  const { meta } = input;
  const stats: ConvertStats = { satin: 0, fill: 0, run: 0, unsupported: 0, skipped: 0, glyphs: 0, baselineGuess: false, unitRatio: 1 };
  const colors: string[] = [];
  const glyphs: Record<string, Glyph> = {};
  const capSamples: Record<string, number> = {};

  for (const svgText of input.svgs) {
    const root = parseXml(svgText).children.find((c) => c.name === "svg");
    if (!root) continue;
    const vb = (root.attrs.viewBox ?? "").split(/[\s,]+/).map(Number);
    // mm per user unit: the viewBox scale if there is one (page "meet" viewBox, uniform), else 1 CSS px.
    let mmPerUu = MM_PER_PX;
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      const wMm = parseUnitsMm(root.attrs.width);
      const hMm = parseUnitsMm(root.attrs.height);
      if (wMm && hMm) mmPerUu = Math.min(wMm / vb[2], hMm / vb[3]);
      else if (wMm) mmPerUu = wMm / vb[2];
    }
    stats.unitRatio = mmPerUu / MM_PER_PX;

    const layers = findAll(root, "g").filter((g) => (g.attrs["inkscape:label"] ?? "").startsWith("GlyphLayer-"));
    const rawGlyphs: RawGlyph[] = [];
    for (const layer of layers) {
      const g = convertLayer(layer, mmPerUu, colors, stats);
      if (g) rawGlyphs.push(g);
    }
    // Baseline. The font documents carry several (often stale or rotated) guides, so use where the
    // capitals (or other flat-bottomed letters) end, which is what every font's guide marks.
    const bottoms = (chars: RegExp): number[] => rawGlyphs.filter((g) => chars.test(g.name)).map((g) => g.maxY);
    let sit = bottoms(/^[ABDEFHIKLMNPRTUVWXYZ]$/);
    if (sit.length < 3) sit = bottoms(/^[abdefhiklmnrtuvwxz]$/);
    if (sit.length < 3) sit = bottoms(/^[0-9]$/);
    if (sit.length < 3) sit = rawGlyphs.map((g) => g.maxY);
    const baselineMm = median(sit);
    // Coordinates are delta-coded, so moving the baseline only changes each array's first y.
    const shift = Math.round(baselineMm * 100);
    const shiftArr = (a: number[]): void => {
      if (a.length > 1) a[1] -= shift;
    };
    for (const g of rawGlyphs) {
      for (const e of g.els) {
        if (e.k === "s") {
          shiftArr(e.rails[0]);
          shiftArr(e.rails[1]);
          e.rungs.forEach(shiftArr);
        } else if (e.k === "f") {
          shiftArr(e.shell);
          e.holes?.forEach(shiftArr);
        } else shiftArr(e.path);
      }
      g.minY -= baselineMm;
      g.maxY -= baselineMm;
    }
    for (const g of rawGlyphs) {
      if (glyphs[g.name]) continue;
      glyphs[g.name] = { w: r2(g.width), x0: r2(g.minX), els: g.els };
      capSamples[g.name] = -g.minY;
    }
  }
  if (!Object.keys(glyphs).length) throw new Error("no glyph layers found");
  stats.glyphs = Object.keys(glyphs).length;
  if (!colors.length) colors.push("#000000");

  const num = (k: string): number | undefined => (typeof meta[k] === "number" ? (meta[k] as number) : undefined);
  const px = (v: number | undefined): number | undefined => (v === undefined ? undefined : r2(v * MM_PER_PX));

  // Cap height: median top of capital letters (or ascenders / digits / any glyph).
  const sample = (chars: string): number[] => [...chars].filter((c) => capSamples[c] !== undefined).map((c) => capSamples[c]);
  let cap = median(sample("HEIFLTZMNVXAYK"));
  if (!cap) cap = median(sample("hdbklt"));
  if (!cap) cap = median(sample("0123456789"));
  if (!cap) cap = median(Object.values(capSamples));
  if (!cap || cap < 1) cap = num("size") ?? 10;

  const advRaw = (meta.horiz_adv_x ?? {}) as Record<string, number>;
  const adv: Record<string, number> = {};
  for (const [k, v] of Object.entries(advRaw)) if (typeof v === "number") adv[k.normalize("NFC")] = r2(v * MM_PER_PX);
  const kernRaw = (meta.kerning_pairs ?? {}) as Record<string, number>;
  const kerning: Record<string, number> = {};
  for (const [k, v] of Object.entries(kernRaw)) if (typeof v === "number" && v !== 0) kerning[k.normalize("NFC")] = r2(v * MM_PER_PX);

  const lc = String(meta.letter_case ?? "");
  const letterCase: LetterCase = lc === "upper" || lc === "lower" ? lc : "";
  const keywords = Array.isArray(meta.keywords) ? (meta.keywords as unknown[]).map(String) : [];

  const font: LiloFont = {
    v: 1,
    enc: "delta-cmm",
    id: input.id,
    name: String(meta.name ?? input.id),
    licence: input.licence,
    description: typeof meta.description === "string" ? meta.description : undefined,
    originalFont: typeof meta.original_font === "string" && meta.original_font.trim() ? meta.original_font.trim() : undefined,
    originalFontUrl: typeof meta.original_font_url === "string" && meta.original_font_url.trim() ? meta.original_font_url.trim() : undefined,
    keywords,
    capHeightMm: r2(cap),
    minScale: num("min_scale") ?? 1,
    maxScale: num("max_scale") ?? 1,
    letterCase,
    autoSatin: meta.auto_satin === undefined ? true : Boolean(meta.auto_satin),
    reversible: meta.reversible === undefined ? true : Boolean(meta.reversible),
    textDirection: meta.text_direction === "rtl" ? "rtl" : "ltr",
    leadingMm: px(num("leading") ?? 100)!,
    spaceMm: px(num("horiz_adv_x_space") ?? 20)!,
    advDefaultMm: px(num("horiz_adv_x_default")) ?? null,
    adv,
    kerning,
    defaultGlyph: typeof meta.default_glyph === "string" ? meta.default_glyph.normalize("NFC") : "�",
    colors,
    glyphs,
  };
  return { font, stats };
}

function parseUnitsMm(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^([\d.]+)\s*(mm|cm|in|px|pt)?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  switch (m[2]) {
    case "mm":
      return n;
    case "cm":
      return n * 10;
    case "in":
      return n * 25.4;
    case "pt":
      return (n * 25.4) / 72;
    default:
      return n * MM_PER_PX;
  }
}
