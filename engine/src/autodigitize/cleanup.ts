import { hexToRgb } from "../color";
import { bufferGeom, intersectionArea, polygonFromRings, polygonsOf, ringsOf, simplifyGeom, unionAll, type Geom, type Poly } from "../geom";
import {
  DEFAULT_FILL_PARAMS,
  DEFAULT_HOOP,
  DEFAULT_RUN_PARAMS,
  DEFAULT_SATIN_PARAMS,
  DESIGN_VERSION,
  type Design,
  type DesignObject,
  type FillParams,
  type Hoop,
  type Pt,
  type Thread,
} from "../model";
import { nearestThread, toDesignThread, type ThreadEntry } from "../threads";
import type { Region } from "./regions";
import { AUTODIGITIZE_STROKES, satinTraits, strokePlan, type StrokeOptions } from "./strokes";

export interface CleanupOptions {
  minRegionMm2: number;
  simplifyMm: number;
  widthMm?: number;
  heightMm?: number;
  fill?: Partial<FillParams>;
  hoop?: Hoop;
  /** Strokes narrower than this (mm) become running stitches, wider ones satin. Default 1. */
  minSatinWidthMm?: number;
  /** Centre-line pieces shorter than this (mm) are dropped. Default 1.5. */
  minRunMm?: number;
}

/** Strokes narrower than this (mm) are a line along their centre (default `minSatinWidthMm`). */
export const RUN_MAX_WIDTH_MM = 1;
/** Shapes up to this wide (and elongated) are satin columns; wider ones are fills. */
export const SATIN_MAX_WIDTH_MM = 7;
/** How close (mm) two regions must be to count as neighbours when merging specks. */
const NEIGHBOUR_MM = 0.3;
const DEFAULT_LONGEST_MM = 60;

interface Part {
  threadIdx: number;
  geom: Poly;
  alive: boolean;
}

/** Map every coordinate of a polygonal geometry through `fn`. */
function mapGeom(g: Geom, fn: (x: number, y: number) => Pt): Geom[] {
  return polygonsOf(g).map((p: Poly) => {
    const { shell, holes } = ringsOf(p);
    const m = (r: readonly Pt[]) => r.map(([x, y]) => fn(x, y));
    return polygonFromRings(m(shell), holes.map(m));
  });
}

function dropSmallHoles(p: Poly, minArea: number): Poly {
  const { shell, holes } = ringsOf(p);
  if (holes.length === 0) return p;
  const keep = holes.filter((h) => polygonFromRings(h).getArea() >= minArea);
  return keep.length === holes.length ? p : polygonFromRings(shell, keep);
}

/** Source units -> mm: `mm = (unit - centre) * scale`. */
export interface UnitsToMm {
  scale: number;
  cx: number;
  cy: number;
}

/**
 * Where the artwork lands: its bounding box is scaled to the requested size (see
 * `AutoDigitizeOptions.widthMm/heightMm`; default longest side 60 mm) and centred on (0, 0).
 */
export function regionsTransform(regions: readonly { geom: Poly }[], opts: Pick<CleanupOptions, "widthMm" | "heightMm">): UnitsToMm {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of regions) {
    const e = s.geom.getEnvelopeInternal();
    x0 = Math.min(x0, e.getMinX());
    y0 = Math.min(y0, e.getMinY());
    x1 = Math.max(x1, e.getMaxX());
    y1 = Math.max(y1, e.getMaxY());
  }
  const bw = Math.max(x1 - x0, 1e-9);
  const bh = Math.max(y1 - y0, 1e-9);
  let scale: number;
  if (opts.widthMm && opts.heightMm) scale = Math.min(opts.widthMm / bw, opts.heightMm / bh);
  else if (opts.widthMm) scale = opts.widthMm / bw;
  else if (opts.heightMm) scale = opts.heightMm / bh;
  else scale = DEFAULT_LONGEST_MM / Math.max(bw, bh);
  return { scale, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/**
 * Turn coloured regions (pixels or SVG units) into a clean `Design` in mm:
 * 1. snap region colours to threads (merging regions that share one),
 * 2. scale/centre to the requested size,
 * 3. simplify outlines and fill in tiny holes,
 * 4. merge regions under `minRegionMm2` into their best neighbour (or drop them),
 * 5. classify each shape per stroke (see `strokes.ts`): a thick stem becomes a satin column and a
 *    hairline of the same letter a run along its centre; blobs, bowls and shapes the columns cannot
 *    cover become tatami fills,
 * 6. order objects to minimise thread changes (colour by colour; fills first, then each letter's
 *    strokes chained nearest-end to nearest-end).
 */
export function regionsToDesign(regions: Region[], threads: readonly ThreadEntry[], opts: CleanupOptions): Design {
  // 1. Thread snapping.
  const entries: ThreadEntry[] = [];
  const byHex = new Map<string, number>();
  const snapped: { threadIdx: number; geom: Geom }[] = [];
  for (const r of regions) {
    const t = nearestThread(hexToRgb(r.hex), threads).thread;
    let k = byHex.get(t.hex);
    if (k === undefined) {
      k = entries.length;
      byHex.set(t.hex, k);
      entries.push(t);
    }
    snapped.push({ threadIdx: k, geom: r.geom });
  }
  if (snapped.length === 0) throw new Error("Nothing to digitize: no coloured regions found.");

  // 2. Scale + centre.
  const { scale, cx, cy } = regionsTransform(
    snapped.map((r) => ({ hex: "", geom: r.geom })),
    opts,
  );
  const toMm = (x: number, y: number): Pt => [(x - cx) * scale, (y - cy) * scale];

  // 3. Parts: simplified polygons in mm, tiny holes filled.
  const parts: Part[] = [];
  for (const s of snapped) {
    for (const mm of mapGeom(s.geom, toMm)) {
      const simp = opts.simplifyMm > 0 ? simplifyGeom(mm, opts.simplifyMm) : mm;
      for (const p of polygonsOf(simp)) {
        const q = dropSmallHoles(p, opts.minRegionMm2);
        if (q.getArea() > 1e-6) parts.push({ threadIdx: s.threadIdx, geom: q, alive: true });
      }
    }
  }

  // 4. Merge specks into the neighbour they share the most boundary with.
  const order = parts.map((_, i) => i).sort((a, b) => parts[a].geom.getArea() - parts[b].geom.getArea());
  for (const i of order) {
    const part = parts[i];
    if (!part.alive || part.geom.getArea() >= opts.minRegionMm2) continue;
    part.alive = false;
    const halo = bufferGeom(part.geom, NEIGHBOUR_MM);
    const hEnv = halo.getEnvelopeInternal();
    let best = -1;
    let bestShare = 0;
    for (let j = 0; j < parts.length; j++) {
      const o = parts[j];
      if (j === i || !o.alive) continue;
      if (!o.geom.getEnvelopeInternal().intersects(hEnv)) continue;
      const share = intersectionArea(halo, o.geom);
      if (share > bestShare) {
        bestShare = share;
        best = j;
      }
    }
    if (best < 0) continue; // isolated speck: drop it
    const merged = unionAll([parts[best].geom, part.geom]);
    const pieces = polygonsOf(merged);
    if (pieces.length === 0) continue;
    // `best` keeps the largest piece; stragglers become parts of their own.
    pieces.sort((a: Poly, b: Poly) => b.getArea() - a.getArea());
    parts[best].geom = dropSmallHoles(pieces[0], opts.minRegionMm2);
    for (const extra of pieces.slice(1)) parts.push({ threadIdx: parts[best].threadIdx, geom: extra, alive: true });
  }
  const live = parts.filter((p) => p.alive && p.geom.getArea() >= opts.minRegionMm2 * 0.999);
  if (live.length === 0) throw new Error("Nothing left after removing small regions; try a lower minimum region size.");

  // 5. Classify into objects.
  const fillParams: FillParams = { ...DEFAULT_FILL_PARAMS, ...opts.fill };
  const strokeOpts: StrokeOptions = {
    ...AUTODIGITIZE_STROKES,
    minSatinMm: opts.minSatinWidthMm ?? AUTODIGITIZE_STROKES.minSatinMm,
    minRunMm: opts.minRunMm ?? AUTODIGITIZE_STROKES.minRunMm,
  };
  interface Draft {
    threadIdx: number;
    kind: DesignObject["kind"];
    /** Index of the shape this came from: a letter's strokes are sewn together. */
    group: number;
    /** Needle entry / exit when sewn forwards (fills: both the centroid). */
    a: Pt;
    b: Pt;
    /** Can be sewn end-to-start (open satin columns and runs). */
    reversible: boolean;
    area: number;
    build: (id: string, name: string, threadId: string, reversed: boolean) => DesignObject;
  }
  const drafts: Draft[] = [];
  const centre = (pts: readonly Pt[]): Pt => {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of pts) {
      sx += x;
      sy += y;
    }
    return [sx / pts.length, sy / pts.length];
  };
  /** A satin strip is [l0, r0, l1, r1, ...]; sewing it backwards reverses the rung order, not each pair. */
  const flipStrip = (strip: Pt[]): Pt[] => {
    const out: Pt[] = [];
    for (let i = strip.length - 2; i >= 0; i -= 2) out.push(strip[i], strip[i + 1]);
    return out;
  };
  /** Round the facets of a skeleton centre line (corner cutting; end points stay put). */
  const smoothRun = (path: Pt[], closed: boolean): Pt[] => {
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
  };
  const mid = (l: Pt, r: Pt): Pt => [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2];
  live.forEach((p, group) => {
    const area = p.geom.getArea();
    const perimeter = p.geom.getLength();
    const meanWidth = (2 * area) / perimeter;
    const { shell, holes } = ringsOf(p.geom);
    const asFill = (): void => {
      const c = centre(shell);
      drafts.push({
        threadIdx: p.threadIdx,
        kind: "fill",
        group,
        a: c,
        b: c,
        reversible: false,
        area,
        build: (id, name, threadId) => ({ id, name, kind: "fill", threadId, geometry: { shell, holes }, params: fillParams }),
      });
    };
    // Shapes wider on average than a satin column are fills outright; the rest are cut per stroke.
    const plan = meanWidth > SATIN_MAX_WIDTH_MM ? null : strokePlan(p.geom, strokeOpts);
    if (!plan) return asFill();
    const n = plan.satins.length + plan.runs.length;
    for (const s of plan.satins) {
      const w = Math.round(s.widthMm * 10) / 10;
      const { pull, underlay } = satinTraits(s.widthMm);
      const first = mid(s.strip[0], s.strip[1]);
      const last = mid(s.strip[s.strip.length - 2], s.strip[s.strip.length - 1]);
      drafts.push({
        threadIdx: p.threadIdx,
        kind: "satin",
        group,
        a: first,
        b: last,
        reversible: true,
        area: area / n,
        build: (id, name, threadId, reversed) => ({
          id,
          name,
          kind: "satin",
          threadId,
          geometry: { strip: reversed ? flipStrip(s.strip) : s.strip },
          params: { ...DEFAULT_SATIN_PARAMS, widthMm: w, pullCompMm: pull, underlay },
        }),
      });
    }
    for (const r of plan.runs) {
      const path = smoothRun(r.closed ? r.path.slice(0, -1) : r.path, r.closed);
      const c = centre(path);
      drafts.push({
        threadIdx: p.threadIdx,
        kind: "run",
        group,
        a: r.closed ? c : path[0],
        b: r.closed ? c : path[path.length - 1],
        reversible: !r.closed,
        area: area / n,
        build: (id, name, threadId, reversed) => ({
          id,
          name,
          kind: "run",
          threadId,
          geometry: { path: reversed ? [...path].reverse() : path, closed: r.closed },
          params: { ...DEFAULT_RUN_PARAMS, stitchLengthMm: 1.8, repeats: r.widthMm >= 0.6 ? 3 : 1 },
        }),
      });
    }
  });

  // 6. Order: colours by total area (big base colours first, fine detail last). Inside a colour:
  //    fills nearest-neighbour from where the needle ended, then the strokes, one letter (shape)
  //    at a time, each hop to the nearest end of an unsewn stroke (reversing it if its far end is
  //    closer) so the needle travels as little as possible.
  const colourArea = new Map<number, number>();
  for (const d of drafts) colourArea.set(d.threadIdx, (colourArea.get(d.threadIdx) ?? 0) + d.area);
  const colourOrder = [...colourArea.keys()].sort((a, b) => colourArea.get(b)! - colourArea.get(a)! || a - b);
  let pos: [number, number] = [-Infinity, -Infinity];
  const sorted: { d: Draft; reversed: boolean }[] = [];
  for (const ti of colourOrder) {
    const fills = drafts.filter((d) => d.threadIdx === ti && d.kind === "fill");
    if (fills.length && !Number.isFinite(pos[0])) {
      // Very first object: start at the top-left-most.
      fills.sort((x, y) => x.a[1] + x.a[0] - (y.a[1] + y.a[0]));
      const first = fills.shift()!;
      sorted.push({ d: first, reversed: false });
      pos = [first.b[0], first.b[1]];
    }
    while (fills.length) {
      let bi = 0;
      let bd = Infinity;
      fills.forEach((d, i) => {
        const dd = (d.a[0] - pos[0]) ** 2 + (d.a[1] - pos[1]) ** 2;
        if (dd < bd) {
          bd = dd;
          bi = i;
        }
      });
      const next = fills.splice(bi, 1)[0];
      sorted.push({ d: next, reversed: false });
      pos = [next.b[0], next.b[1]];
    }
    const pool = drafts.filter((d) => d.threadIdx === ti && d.kind !== "fill");
    if (!Number.isFinite(pos[0])) pos = [-1e4, -1e4]; // nothing sewn yet: head for the top-left
    let group = -1;
    while (pool.length) {
      const inGroup = pool.filter((d) => d.group === group);
      const cands = inGroup.length ? inGroup : pool;
      let best = cands[0];
      let bestRev = false;
      let bd = Infinity;
      for (const d of cands) {
        const df = (d.a[0] - pos[0]) ** 2 + (d.a[1] - pos[1]) ** 2;
        const dr = d.reversible ? (d.b[0] - pos[0]) ** 2 + (d.b[1] - pos[1]) ** 2 : Infinity;
        if (df < bd) {
          bd = df;
          best = d;
          bestRev = false;
        }
        if (dr < bd) {
          bd = dr;
          best = d;
          bestRev = true;
        }
      }
      pool.splice(pool.indexOf(best), 1);
      sorted.push({ d: best, reversed: bestRev });
      pos = bestRev ? [best.a[0], best.a[1]] : [best.b[0], best.b[1]];
      group = best.group;
    }
  }

  // 7. Build the design.
  const designThreads: Thread[] = colourOrder.map((ti) => toDesignThread(entries[ti]));
  const threadOf = new Map(colourOrder.map((ti, k) => [ti, designThreads[k]]));
  const counts = new Map<string, number>();
  const objects = sorted.map(({ d, reversed }, i) => {
    const t = threadOf.get(d.threadIdx)!;
    const key = `${t.id}/${d.kind}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return d.build(`obj-${i + 1}`, `${t.name} ${d.kind} ${n}`, t.id, reversed);
  });
  return { version: DESIGN_VERSION, unitsMm: 1, hoop: opts.hoop ?? DEFAULT_HOOP, threads: designThreads, objects };
}
