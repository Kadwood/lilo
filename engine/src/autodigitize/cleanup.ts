import { hexToRgb } from "../color";
import { bufferGeom, polygonFromRings, polygonsOf, ringsOf, simplifyGeom, unionAll, type Geom, type Poly } from "../geom";
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
import { runPaths, satinColumns } from "./spine";

export interface CleanupOptions {
  minRegionMm2: number;
  simplifyMm: number;
  widthMm?: number;
  heightMm?: number;
  fill?: Partial<FillParams>;
  hoop?: Hoop;
}

/** Shapes narrower than this (mm) are stitched as a line along their centre. */
export const RUN_MAX_WIDTH_MM = 1;
/** Shapes up to this wide (and elongated) are satin columns; wider ones are fills. */
export const SATIN_MAX_WIDTH_MM = 7;
/** Elongation (spine length / width) a shape needs to be worth a satin column. */
const SATIN_MIN_ELONGATION = 2;
/** Minimum share of a shape the satin columns must cover, else we fill it instead. */
const SATIN_MIN_COVERAGE = 0.8;
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

/**
 * Turn coloured regions (pixels or SVG units) into a clean `Design` in mm:
 * 1. snap region colours to threads (merging regions that share one),
 * 2. scale/centre to the requested size,
 * 3. simplify outlines and fill in tiny holes,
 * 4. merge regions under `minRegionMm2` into their best neighbour (or drop them),
 * 5. classify each shape by its mean width (2 * area / perimeter): hairline -> run along the centre,
 *    stroke-like -> satin columns, otherwise tatami fill,
 * 6. order objects to minimise thread changes (colour by colour, nearest-neighbour inside).
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
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of snapped) {
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
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
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
      const share = halo.intersection(o.geom).getArea();
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
  interface Draft {
    threadIdx: number;
    kind: DesignObject["kind"];
    build: (id: string, name: string, threadId: string) => DesignObject;
    cx: number;
    cy: number;
    area: number;
  }
  const drafts: Draft[] = [];
  const centre = (pts: readonly Pt[]): [number, number] => {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of pts) {
      sx += x;
      sy += y;
    }
    return [sx / pts.length, sy / pts.length];
  };
  for (const p of live) {
    const area = p.geom.getArea();
    const perimeter = p.geom.getLength();
    const width = (2 * area) / perimeter;
    const { shell, holes } = ringsOf(p.geom);
    const asFill = (): Draft => {
      const [fx, fy] = centre(shell);
      return {
        threadIdx: p.threadIdx,
        kind: "fill",
        cx: fx,
        cy: fy,
        area,
        build: (id, name, threadId) => ({ id, name, kind: "fill", threadId, geometry: { shell, holes }, params: fillParams }),
      };
    };
    if (width < RUN_MAX_WIDTH_MM) {
      const rp = runPaths(p.geom);
      if (rp && rp.paths.length) {
        rp.paths.forEach((path, k) => {
          const [fx, fy] = centre(path);
          const closed = rp.closed[k];
          drafts.push({
            threadIdx: p.threadIdx,
            kind: "run",
            cx: fx,
            cy: fy,
            area: area / rp.paths.length,
            build: (id, name, threadId) => ({
              id,
              name,
              kind: "run",
              threadId,
              geometry: { path: closed ? path.slice(0, -1) : path, closed },
              params: { ...DEFAULT_RUN_PARAMS, repeats: width >= 0.6 ? 3 : 1 },
            }),
          });
        });
      } else drafts.push(asFill());
    } else if (width <= SATIN_MAX_WIDTH_MM) {
      const sc = satinColumns(p.geom);
      if (sc && sc.coverage >= SATIN_MIN_COVERAGE && sc.spineLengthMm / width >= SATIN_MIN_ELONGATION) {
        for (const strip of sc.strips) {
          const [fx, fy] = centre(strip);
          drafts.push({
            threadIdx: p.threadIdx,
            kind: "satin",
            cx: fx,
            cy: fy,
            area: area / sc.strips.length,
            build: (id, name, threadId) => ({
              id,
              name,
              kind: "satin",
              threadId,
              geometry: { strip },
              params: { ...DEFAULT_SATIN_PARAMS, widthMm: Math.round(width * 10) / 10, underlay: width < 1.2 ? "none" : width < 4 ? "center" : "contour" },
            }),
          });
        }
      } else drafts.push(asFill());
    } else drafts.push(asFill());
  }

  // 6. Order: colours by total area (big base colours first, fine detail last); inside a colour,
  //    fills then satins then runs, each nearest-neighbour from where the needle ended.
  const colourArea = new Map<number, number>();
  for (const d of drafts) colourArea.set(d.threadIdx, (colourArea.get(d.threadIdx) ?? 0) + d.area);
  const colourOrder = [...colourArea.keys()].sort((a, b) => colourArea.get(b)! - colourArea.get(a)! || a - b);
  let pos: [number, number] = [-Infinity, -Infinity];
  const sorted: Draft[] = [];
  for (const ti of colourOrder) {
    for (const kind of ["fill", "satin", "run"] as const) {
      const pool = drafts.filter((d) => d.threadIdx === ti && d.kind === kind);
      if (pool.length === 0) continue;
      if (!Number.isFinite(pos[0])) {
        // Very first object: start at the top-left-most.
        pool.sort((a, b) => a.cy + a.cx - (b.cy + b.cx));
        const first = pool.shift()!;
        sorted.push(first);
        pos = [first.cx, first.cy];
      }
      while (pool.length) {
        let bi = 0;
        let bd = Infinity;
        pool.forEach((d, i) => {
          const dd = (d.cx - pos[0]) ** 2 + (d.cy - pos[1]) ** 2;
          if (dd < bd) {
            bd = dd;
            bi = i;
          }
        });
        const next = pool.splice(bi, 1)[0];
        sorted.push(next);
        pos = [next.cx, next.cy];
      }
    }
  }

  // 7. Build the design.
  const designThreads: Thread[] = colourOrder.map((ti) => toDesignThread(entries[ti]));
  const threadOf = new Map(colourOrder.map((ti, k) => [ti, designThreads[k]]));
  const counts = new Map<string, number>();
  const objects = sorted.map((d, i) => {
    const t = threadOf.get(d.threadIdx)!;
    const key = `${t.id}/${d.kind}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return d.build(`obj-${i + 1}`, `${t.name} ${d.kind} ${n}`, t.id);
  });
  return { version: DESIGN_VERSION, unitsMm: 1, hoop: opts.hoop ?? DEFAULT_HOOP, threads: designThreads, objects };
}
