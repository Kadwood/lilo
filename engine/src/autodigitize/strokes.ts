import { Coordinate } from "jsts/org/locationtech/jts/geom";
import type { SatinUnderlay } from "../model";
import { factory, intersectionArea, unionAll, type Poly } from "../geom";
import type { Pt } from "../model";
import { stripWidths } from "../lettering/satin";
import { DEFAULTS } from "../presets/defaults";
import { underlayTypeFor } from "./underlay";
import { trimJunctions } from "./junction";
import { branchToStrip, edgesOf, skeletonBranches, stripPolygon, subdivide, type Branch } from "./spine";

/**
 * Per-stroke stitch classification, shared by custom-font lettering and auto-digitizing.
 *
 * A glyph or logo letter is rarely one width: a Didone "O" has thick sides and hairline top/bottom.
 * Classifying a whole shape by its mean width (2A/P) makes every hairline drag the shape under the
 * satin minimum, so everything became a running stitch. Real digitizing decides per stroke:
 *
 *   skeleton (straight skeleton, see spine.ts) -> branches, each with a local half-width
 *     -> optional split of a branch where its width crosses the satin minimum
 *     -> width < minSatinMm: run along the centre line; otherwise satin column (rungs cast to the
 *        outline). Shapes that are too wide / blobby / poorly covered by columns are filled instead.
 *
 * Pieces cut from one branch overlap by a stitch or two so there is no gap at the junction.
 */

type V2 = [number, number];

export interface StrokeOptions {
  /** Strokes narrower than this (mm) are a running stitch along their centre; at least this wide, satin. */
  minSatinMm: number;
  /** A shape wider than this anywhere (mm) is a fill even if the mean width looks like a stroke. */
  peakMaxMm: number;
  /** Spine length / mean width a shape needs to be worth columns at all, else fill. */
  minElongation: number;
  /** Share of the shape the columns (+ run halos) must cover, else fill. */
  minCoverage: number;
  /** Centre-line pieces shorter than this (mm) are dropped (unless they are all there is). */
  minRunMm: number;
  /** Split a branch where its width crosses `minSatinMm` (thick stem + hairline in one stroke). */
  splitByWidth: boolean;
  /** Shortest satin / run piece (mm) a width split may create; shorter ones merge into a neighbour. */
  minPieceMm: number;
  /** When there are no satin columns at all, skip the coverage test (a run cannot "cover" a hairline). */
  skipCoverageForRunsOnly: boolean;
  /**
   * Premium: a stroke narrower than `minSatinMm` (and at least `hairlineMinMm` long) becomes a narrow
   * satin column this wide (mm) along its centre line instead of a faint single run. 0 / unset = off.
   */
  hairlineSatinMm?: number;
  /** Shortest hairline (mm) that gets a narrow satin column; shorter ones stay (triple) runs. */
  hairlineMinMm?: number;
  /** Premium: trim columns that meet so they overlap by this much (mm) instead of stacking. Unset = off. */
  junctionOverlapMm?: number;
}

/** The values custom-font lettering has always used (so its output is unchanged). */
export const LETTERING_STROKES: StrokeOptions = {
  minSatinMm: 1,
  peakMaxMm: 9,
  minElongation: 1.8,
  minCoverage: 0.75,
  minRunMm: 1.2,
  splitByWidth: false,
  minPieceMm: 1,
  skipCoverageForRunsOnly: false,
};

/** Defaults for auto-digitizing artwork. */
export const AUTODIGITIZE_STROKES: StrokeOptions = {
  minSatinMm: DEFAULTS.satin.minWidthMm.standard,
  peakMaxMm: 9,
  minElongation: 2,
  minCoverage: 0.8,
  minRunMm: DEFAULTS.run.minRunMm,
  splitByWidth: true,
  minPieceMm: 1,
  skipCoverageForRunsOnly: true,
};

export interface SatinPiece {
  /** Quad strip `[l0, r0, l1, r1, ...]`. */
  strip: Pt[];
  /** Median column width, mm. */
  widthMm: number;
}
export interface RunPiece {
  path: Pt[];
  closed: boolean;
  /** Median stroke width this line stands for, mm. */
  widthMm: number;
}
export interface StrokePlan {
  satins: SatinPiece[];
  runs: RunPiece[];
}

export const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

export const pathLength = (pts: readonly Pt[]): number => pts.reduce((n, p, i) => (i ? n + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

/** Round the facets of a skeleton centre line (corner cutting; end points stay put). */
export function smoothPath(path: Pt[], closed: boolean): Pt[] {
  let pts = path;
  for (let it = 0; it < 2 && pts.length >= 3; it++) {
    const out: Pt[] = closed ? [] : [pts[0]];
    const m = pts.length;
    for (let i = 0; i < (closed ? m : m - 1); i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % m];
      out.push([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]], [0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]);
    }
    if (!closed) out.push(pts[m - 1]);
    pts = out;
  }
  return pts;
}

/**
 * A constant-width satin strip along a (smoothed) centre line. Rung directions come from a baseline of
 * about 1 mm either side of each point, not the next segment: a skeleton path that hooks sideways for
 * a tenth of a millimetre at a junction would otherwise start the column with a stray cross-bar.
 */
export function hairlineStrip(path: readonly Pt[], widthMm: number, closed: boolean, stepMm = 0.25, baseMm = 0.5): Pt[] {
  const pts: Pt[] = closed && path.length > 1 ? [...path, path[0]] : [...path];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  if (total < 1e-6) return [];
  const at = (sIn: number): Pt => {
    const s = closed ? ((sIn % total) + total) % total : Math.min(total, Math.max(0, sIn));
    let k = 1;
    while (k < cum.length - 1 && cum[k] < s) k++;
    const seg = cum[k] - cum[k - 1] || 1;
    const t = (s - cum[k - 1]) / seg;
    return [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * t, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * t];
  };
  const n = Math.max(1, Math.ceil(total / stepMm));
  const strip: Pt[] = [];
  const h = widthMm / 2;
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * total;
    const a = at(s - baseMm);
    const b = at(s + baseMm);
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const l = Math.hypot(tx, ty);
    if (l < 1e-9) continue;
    tx /= l;
    ty /= l;
    const p = at(s);
    strip.push([p[0] - ty * h, p[1] + tx * h], [p[0] + ty * h, p[1] - tx * h]);
  }
  return strip;
}

/** Pull compensation and underlay type for a satin column of width `w` (Standard rules; Premium refines both in profile.ts). */
export function satinTraits(w: number): { pull: number; underlay: SatinUnderlay } {
  return { pull: DEFAULTS.satin.pullCompMm, underlay: underlayTypeFor(w, 1, true, 0) };
}

// ---------------------------------------------------------------------------------------------
// Splitting a branch by width
// ---------------------------------------------------------------------------------------------

interface Seg {
  satin: boolean;
  i0: number;
  i1: number;
}

/** Overlap (in resample steps, ~0.5 mm each) pieces share with their neighbours. */
const OVERLAP_STEPS = 1;
const STEP_MM = 0.5;
/** A branch is split by width only if its widest tenth reaches the satin minimum, its narrowest tenth is under CONTRAST_LO times it, and the two differ by CONTRAST_RATIO. */
const CONTRAST_RATIO = 2;
const CONTRAST_LO = 0.85;

/** Resample a branch (rotated to start at its narrowest point if it is a closed loop) and cut it by width class. */
function splitBranch(b: Branch, opts: StrokeOptions): { pts: V2[]; half: number[]; segs: Seg[] } {
  const rs = subdivide(b.pts, b.half, STEP_MM);
  let pts = rs.pts;
  let half = rs.half;
  if (b.closed && pts.length > 3) {
    // The last point repeats the first; start the loop at its narrowest spot so a class boundary
    // falls at the seam, then close it again.
    const body = pts.slice(0, -1);
    const hb = half.slice(0, -1);
    let k = 0;
    hb.forEach((h, i) => {
      if (h < hb[k]) k = i;
    });
    pts = [...body.slice(k), ...body.slice(0, k), body[k]];
    half = [...hb.slice(k), ...hb.slice(0, k), hb[k]];
  }
  const n = pts.length;
  // 3-point smoothing so a single noisy skeleton node doesn't flip the class.
  const w = half.map((_, i) => (2 * (half[Math.max(0, i - 1)] + half[i] + half[Math.min(n - 1, i + 1)])) / 3);
  const hi = opts.minSatinMm;
  const lo = opts.minSatinMm * 0.85; // hysteresis: leave satin only once clearly narrower
  let satin = w[0] >= hi;
  const cls: boolean[] = [];
  for (let i = 0; i < n; i++) {
    if (satin && w[i] < lo) satin = false;
    else if (!satin && w[i] >= hi) satin = true;
    cls.push(satin);
  }
  let segs: Seg[] = [];
  let start = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || cls[i] !== cls[start]) {
      segs.push({ satin: cls[start], i0: start, i1: i - 1 });
      start = i;
    }
  }
  const segLen = (s: Seg) => pathLength(pts.slice(s.i0, s.i1 + 1));
  // Absorb pieces too short to stitch on their own into the longer neighbour (its class wins).
  for (let guard = 0; guard < 64 && segs.length > 1; guard++) {
    let k = -1;
    let shortest = Infinity;
    segs.forEach((s, i) => {
      const l = segLen(s);
      if (l < opts.minPieceMm && l < shortest) {
        shortest = l;
        k = i;
      }
    });
    if (k < 0) break;
    const left = segs[k - 1];
    const right = segs[k + 1];
    segs[k].satin = (!left ? right : !right ? left : segLen(left) >= segLen(right) ? left : right).satin;
    const merged: Seg[] = [];
    for (const s of segs) {
      const last = merged[merged.length - 1];
      if (last && last.satin === s.satin) last.i1 = s.i1;
      else merged.push({ ...s });
    }
    segs = merged;
  }
  return { pts, half, segs };
}

interface RawPiece {
  satin: boolean;
  b: Branch;
}

function piecesOfBranch(b: Branch, opts: StrokeOptions): RawPiece[] {
  if (!opts.splitByWidth) return [{ satin: 2 * median(b.half) >= opts.minSatinMm, b }];
  // Only strokes with real contrast are cut: a uniform stroke whose width merely wobbles around the
  // threshold (a traced 1 mm line) stays one piece, classed by its median width.
  const ws = b.half.map((h) => 2 * h).sort((x, y) => x - y);
  const q = (f: number) => ws[Math.min(ws.length - 1, Math.floor(f * ws.length))];
  if (!(q(0.9) >= opts.minSatinMm && q(0.1) < opts.minSatinMm * CONTRAST_LO && q(0.9) >= CONTRAST_RATIO * q(0.1))) return [{ satin: 2 * median(b.half) >= opts.minSatinMm, b }];
  const { pts, half, segs } = splitBranch(b, opts);
  // One class all along: keep the original (un-resampled, possibly closed) branch.
  if (segs.length === 1) return [{ satin: segs[0].satin, b }];
  const n = pts.length;
  const leafStart = b.leafStart && !b.closed;
  const leafEnd = b.leafEnd && !b.closed;
  return segs.map((s, k) => {
    const i0 = Math.max(0, s.i0 - (k > 0 ? OVERLAP_STEPS : 0));
    const i1 = Math.min(n - 1, s.i1 + (k < segs.length - 1 ? OVERLAP_STEPS : 0));
    return {
      satin: s.satin,
      b: {
        pts: pts.slice(i0, i1 + 1),
        half: half.slice(i0, i1 + 1),
        closed: false,
        leafStart: k === 0 && leafStart,
        leafEnd: k === segs.length - 1 && leafEnd,
      },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Whole polygon
// ---------------------------------------------------------------------------------------------

/**
 * Columns from short branches at a junction (serif feet, the crotch of a K or W) mostly lie on top of
 * the big column beside them; sewing both stacks stitches into a crosshatched lump. Drop a column when
 * most of its area is already covered by longer ones (the coverage test below still guards the result).
 */
function dropShadowedSatins(satins: SatinPiece[]): void {
  if (satins.length < 2 || satins.length > 150) return;
  const polys = satins.map((s) => stripPolygon(s.strip));
  const order = satins.map((_, i) => i).sort((a, b) => (polys[b]?.getArea() ?? 0) - (polys[a]?.getArea() ?? 0));
  const kept: Poly[] = [];
  const drop = new Set<number>();
  for (const i of order) {
    const sp = polys[i];
    if (!sp) continue;
    const a = sp.getArea();
    if (kept.length && a > 0) {
      const covered = intersectionArea(unionAll(kept), sp);
      if (covered > 0.6 * a) {
        drop.add(i);
        continue;
      }
    }
    kept.push(sp);
  }
  for (let i = satins.length - 1; i >= 0; i--) if (drop.has(i)) satins.splice(i, 1);
}

/**
 * Plan the stitching of one solid polygon (mm, y down): satin columns + centre-line runs, or null
 * when it should be a fill (no skeleton, too wide/blobby/short, or columns cover too little).
 */
export function strokePlan(part: Poly, opts: StrokeOptions): StrokePlan | null {
  const area = part.getArea();
  const perimeter = part.getLength();
  const meanWidth = (2 * area) / Math.max(perimeter, 1e-6);
  const branches = skeletonBranches(part);
  if (!branches) return null;

  let peak = 0;
  let spine = 0;
  for (const b of branches) {
    peak = Math.max(peak, 2 * Math.max(...b.half));
    spine += pathLength(b.pts.map((p) => [p[0], p[1]] as Pt));
  }
  // Wide, blobby (dots, bowls of bold letters) or very short shapes are filled.
  if (peak > opts.peakMaxMm || spine / Math.max(meanWidth, 1e-6) < opts.minElongation) return null;

  const edges = edgesOf(part);
  const satins: SatinPiece[] = [];
  const runs: (RunPiece & { branch: Branch })[] = [];
  const asRun = (b: Branch, onlyOne: boolean): void => {
    const path = b.pts.map((p) => [p[0], p[1]] as Pt);
    if (pathLength(path) >= opts.minRunMm || onlyOne) runs.push({ path, closed: b.closed, widthMm: 2 * median(b.half), branch: b });
  };
  for (const raw of branches) {
    const pieces = piecesOfBranch(raw, opts);
    for (const piece of pieces) {
      const b = piece.b;
      if (!piece.satin) {
        asRun(b, branches.length === 1 && pieces.length === 1);
        continue;
      }
      const s = branchToStrip(b, edges);
      if (!s) continue;
      const sw = median(stripWidths(s));
      // Rays can hit the outline sooner than the skeleton's radius suggests (serifs, junction mouths).
      if (sw < opts.minSatinMm * 0.9) asRun(b, false);
      else satins.push({ strip: s, widthMm: sw });
    }
  }
  if (opts.hairlineSatinMm) {
    // Strokes below the satin minimum: a narrow satin at the minimum width reads as a fine line on the
    // cloth; one single run is a 0.2 mm thread that vanishes. Too short for a column: stays a run.
    for (let i = runs.length - 1; i >= 0; i--) {
      const r = runs[i];
      const body = r.closed ? r.path.slice(0, -1) : r.path;
      if (body.length < 2 || pathLength(r.path) < (opts.hairlineMinMm ?? 1.6)) continue;
      const strip = hairlineStrip(smoothPath(body, r.closed), opts.hairlineSatinMm, r.closed);
      if (strip.length < 4) continue;
      satins.push({ strip, widthMm: opts.hairlineSatinMm });
      runs.splice(i, 1);
    }
  }
  if (opts.splitByWidth) dropShadowedSatins(satins);
  if (satins.length === 0 && runs.length === 0) return null;

  if (satins.length > 0 || !opts.skipCoverageForRunsOnly) {
    // Coverage check: columns plus a 0.35 mm halo around runs must account for most of the area.
    const covering: Poly[] = [];
    for (const s of satins) {
      const sp = stripPolygon(s.strip);
      if (sp && !sp.isEmpty()) covering.push(sp);
    }
    for (const r of runs) {
      try {
        const line = factory.createLineString(r.path.map(([x, y]) => new Coordinate(x, y)));
        covering.push(line.buffer(0.35));
      } catch {
        /* degenerate run: ignore for coverage */
      }
    }
    const covered = covering.length ? intersectionArea(unionAll(covering), part) : 0;
    if (covered / area < opts.minCoverage) return null;
  }
  let outRuns = runs.map(({ path, closed, widthMm }) => ({ path, closed, widthMm }));
  if (opts.junctionOverlapMm !== undefined && satins.length > 1) {
    const trimmed = trimJunctions(satins.map((s) => s.strip), opts.junctionOverlapMm);
    const next: SatinPiece[] = trimmed.map(({ index, strip }) => ({ strip, widthMm: satins[index].widthMm }));
    satins.length = 0;
    satins.push(...next);
  }
  if (opts.hairlineSatinMm && satins.length && outRuns.length) {
    // Short stubs left at junctions (too short for a column) that already lie on a column add only a
    // knot of thread: drop those, keep the ones that stand on their own (serif tips, dots).
    const cover: Poly[] = [];
    for (const s of satins) {
      const sp = stripPolygon(s.strip);
      if (sp && !sp.isEmpty()) cover.push(sp);
    }
    if (cover.length) {
      const covered = unionAll(cover);
      outRuns = outRuns.filter((r) => {
        try {
          const line = factory.createLineString(r.path.map(([x, y]) => new Coordinate(x, y)));
          const halo = line.buffer(0.3);
          const a = halo.getArea();
          return a <= 0 || intersectionArea(covered, halo) / a < 0.6;
        } catch {
          return true;
        }
      });
    }
  }
  return { satins, runs: outRuns };
}
