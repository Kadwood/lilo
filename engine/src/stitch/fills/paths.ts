import { bufferGeom, polygonsOf, ringsOf } from "../../geom";
import type { Pt } from "../../model";
import type { FillCtx } from "./ctx";
import { densify, dist, pathLength, pointInRings, resampleEven } from "./util";

/** Path patterns: rings, spirals, rays, flow lines and dots that follow the shape rather than a grid. */

const step = (c: FillCtx, max: number): number => Math.min(c.stitchLen, max);

/** Spiral arms out from the centre. */
function spiral(c: FillCtx): Pt[][] {
  const arms = Math.max(1, Math.round(c.get("rotations")));
  const pitch = c.spacing * c.get("tightness");
  const R = c.radius + 1;
  const ds = step(c, 1.2);
  const k = (pitch * arms) / (2 * Math.PI);
  const out: Pt[][] = [];
  for (let a = 0; a < arms; a++) {
    const theta0 = (a / arms) * Math.PI * 2;
    const pts: Pt[] = [];
    let t = 0;
    for (let guard = 0; guard < 200000; guard++) {
      const r = k * t;
      if (r > R) break;
      const th = theta0 + t;
      pts.push([c.centre[0] + r * Math.cos(th), c.centre[1] + r * Math.sin(th)]);
      t += ds / Math.max(r, ds);
    }
    out.push(pts);
  }
  return out;
}

/** Van der Corput sequence: the first i values are spread as evenly as possible over [0, 1). */
function radicalInverse(i: number): number {
  let f = 0.5;
  let r = 0;
  for (let n = i; n > 0; n = Math.floor(n / 2), f /= 2) r += f * (n % 2);
  return r;
}

/**
 * Lines out from the centre, optionally twisted. Line i starts at a radius from a low-discrepancy
 * sequence, so at every radius the lines that have started are spread evenly around the circle and
 * the density stays close to `pitch` all the way in (no knot of overlapping lines at the middle).
 */
function radial(c: FillCtx, pitch: number, turns: number, ds: number): Pt[][] {
  const R = c.radius + 1;
  const n = Math.min(1500, Math.max(8, Math.ceil((2 * Math.PI * R) / pitch)));
  const out: Pt[][] = [];
  for (let i = 0; i < n; i++) {
    const th0 = (i / n) * Math.PI * 2;
    const pts: Pt[] = [];
    const r0 = R * radicalInverse(i);
    const len = R - r0;
    const m = Math.max(1, Math.ceil(len / ds));
    for (let s = 0; s <= m; s++) {
      const r = r0 + (len * s) / m;
      // Follow the curve finely enough that a twisted line stays smooth.
      const th = th0 + turns * Math.PI * 2 * (r / R);
      pts.push([c.centre[0] + r * Math.cos(th), c.centre[1] + r * Math.sin(th)]);
    }
    out.push(pts);
  }
  return out;
}

function circular(c: FillCtx): Pt[][] {
  const R = c.radius + 1;
  const out: Pt[][] = [];
  const ds = step(c, 2);
  for (let r = c.spacing; r <= R; r += c.spacing) {
    const n = Math.max(12, Math.ceil((2 * Math.PI * r) / ds));
    const off = (out.length * 2.399963) % (2 * Math.PI); // golden angle: seams don't line up
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const th = off + (i / n) * Math.PI * 2;
      pts.push([c.centre[0] + r * Math.cos(th), c.centre[1] + r * Math.sin(th)]);
    }
    out.push(pts);
  }
  return out;
}

function contour(c: FillCtx): Pt[][] {
  const pitch = c.get("pitch");
  const out: Pt[][] = [];
  for (let k = 0; k < 400; k++) {
    const g = bufferGeom(c.poly, -(k + 0.5) * pitch);
    const parts = polygonsOf(g);
    if (parts.length === 0) break;
    for (const p of parts) {
      const { shell, holes } = ringsOf(p);
      for (const rg of [shell, ...holes]) {
        if (rg.length < 3) continue;
        out.push(densify([...rg, rg[0]], step(c, 3)));
      }
    }
  }
  return out;
}

/** Random dots (Poisson-disk-ish) as tiny stitches; the router joins neighbours into a scribble. */
function stipple(c: FillCtx): Pt[][] {
  const pitch = c.get("pitch");
  const cellSize = pitch / Math.SQRT2;
  const w = c.u1 - c.u0;
  const h = c.v1 - c.v0;
  const gw = Math.ceil(w / cellSize) + 1;
  const gh = Math.ceil(h / cellSize) + 1;
  const grid = new Array<Pt | null>(gw * gh).fill(null);
  const pts: Pt[] = [];
  const active: Pt[] = [];
  const cellOf = (p: Pt): [number, number] => [Math.floor((p[0] - c.u0) / cellSize), Math.floor((p[1] - c.v0) / cellSize)];
  const ok = (p: Pt): boolean => {
    const [gx, gy] = cellOf(p);
    if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return false;
    for (let x = Math.max(0, gx - 2); x <= Math.min(gw - 1, gx + 2); x++) {
      for (let y = Math.max(0, gy - 2); y <= Math.min(gh - 1, gy + 2); y++) {
        const q = grid[y * gw + x];
        if (q && dist(p, q) < pitch) return false;
      }
    }
    return true;
  };
  const put = (p: Pt) => {
    const [gx, gy] = cellOf(p);
    grid[gy * gw + gx] = p;
    pts.push(p);
    active.push(p);
  };
  put([c.u0 + c.rand() * w, c.v0 + c.rand() * h]);
  while (active.length && pts.length < 6000) {
    const i = Math.floor(c.rand() * active.length);
    const base = active[i];
    let placed = false;
    for (let t = 0; t < 20; t++) {
      const a = c.rand() * Math.PI * 2;
      const r = pitch * (1 + c.rand());
      const p: Pt = [base[0] + r * Math.cos(a), base[1] + r * Math.sin(a)];
      if (ok(p)) {
        put(p);
        placed = true;
        break;
      }
    }
    if (!placed) active.splice(i, 1);
  }
  const out: Pt[][] = [];
  for (const p of pts) {
    const w2 = c.toWorld(p);
    if (!c.inside(w2)) continue;
    const a = c.rand() * Math.PI;
    const d = Math.min(0.45, pitch * 0.25);
    out.push([[w2[0] - Math.cos(a) * d, w2[1] - Math.sin(a) * d], [w2[0] + Math.cos(a) * d, w2[1] + Math.sin(a) * d]]);
  }
  return out;
}

/** Direction (radians) of the flow field at p: base angle, bent toward the nearest guide curve. */
function fieldAngle(c: FillCtx, p: Pt): number {
  let ang = c.angle;
  if (c.guides.length === 0) return ang;
  let best = Infinity;
  let tx = 0;
  let ty = 0;
  for (const g of c.guides) {
    for (let i = 1; i < g.length; i++) {
      const a = g[i - 1];
      const b = g[i];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      const d = Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
      if (d < best) {
        best = d;
        tx = dx;
        ty = dy;
      }
    }
  }
  const sigma = Math.max(4, c.radius * 0.35);
  const w = Math.exp(-(best * best) / (2 * sigma * sigma));
  let ga = Math.atan2(ty, tx);
  // flow lines have no direction: flip the guide's tangent to agree with the base angle
  if (Math.cos(ga - ang) < 0) ga += Math.PI;
  const x = Math.cos(ang) * (1 - w) + Math.cos(ga) * w;
  const y = Math.sin(ang) * (1 - w) + Math.sin(ga) * w;
  ang = Math.atan2(y, x);
  return ang;
}

/** Evenly spaced flow lines (Jobard-Lefer style seeding) through the direction field. */
function streamlines(c: FillCtx): Pt[][] {
  const sep = Math.max(0.25, c.get("separation"));
  const dTest = sep * 0.6;
  const h = Math.min(0.4, sep * 0.8);
  const cell = sep;
  const hash = new Map<string, Pt[]>();
  const k = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const addPt = (p: Pt) => {
    const key = k(p[0], p[1]);
    const l = hash.get(key);
    if (l) l.push(p);
    else hash.set(key, [p]);
  };
  const tooClose = (p: Pt, ignore: Set<Pt>): boolean => {
    const cx = Math.floor(p[0] / cell);
    const cy = Math.floor(p[1] / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const l = hash.get(`${cx + dx},${cy + dy}`);
        if (!l) continue;
        for (const q of l) if (!ignore.has(q) && dist(p, q) < dTest) return true;
      }
    }
    return false;
  };
  const parts = c.parts;
  const inside = (p: Pt) => parts.some((q) => pointInRings(p, q.shell, q.holes));
  const advance = (p: Pt, sign: number, prev: number | null): [Pt, number] => {
    // midpoint integration; keep a consistent heading (line fields have no direction)
    const dir = (q: Pt, ref: number | null): number => {
      let a = fieldAngle(c, q);
      if (ref !== null && Math.cos(a - ref) < 0) a += Math.PI;
      return a;
    };
    const a0 = dir(p, prev ?? (sign > 0 ? fieldAngle(c, p) : fieldAngle(c, p) + Math.PI));
    const mid: Pt = [p[0] + Math.cos(a0) * h * 0.5, p[1] + Math.sin(a0) * h * 0.5];
    const a1 = dir(mid, a0);
    return [[p[0] + Math.cos(a1) * h, p[1] + Math.sin(a1) * h], a1];
  };
  const trace = (seed: Pt): Pt[] => {
    const own = new Set<Pt>();
    const line: Pt[] = [seed];
    own.add(seed);
    for (const sign of [1, -1]) {
      let p = seed;
      let heading: number | null = null;
      const part: Pt[] = [];
      for (let i = 0; i < 4000; i++) {
        const [np, a] = advance(p, sign, heading);
        heading = a;
        if (!inside(np)) break;
        // only OTHER lines stop this one: its own points are ignored
        if (tooClose(np, own)) break;
        part.push(np);
        own.add(np);
        p = np;
      }
      if (sign > 0) line.push(...part);
      else line.unshift(...part.reverse());
    }
    return line;
  };

  const lines: Pt[][] = [];
  const queue: Pt[] = [];
  const seedFrom = (line: Pt[]) => {
    for (let i = 0; i < line.length; i += Math.max(1, Math.round(sep / h))) {
      const p = line[i];
      const a = fieldAngle(c, p) + Math.PI / 2;
      queue.push([p[0] + Math.cos(a) * sep, p[1] + Math.sin(a) * sep], [p[0] - Math.cos(a) * sep, p[1] - Math.sin(a) * sep]);
    }
  };
  const first = c.inside(c.centre) ? c.centre : c.toWorld([c.u0 + (c.u1 - c.u0) / 2, c.v0 + (c.v1 - c.v0) / 2]);
  queue.push(first);
  // extra seeds on a coarse grid so disconnected parts of the shape are reached too
  const gridStep = Math.max(sep * 6, 3);
  for (let u = c.u0; u <= c.u1; u += gridStep) for (let v = c.v0; v <= c.v1; v += gridStep) queue.push(c.toWorld([u, v]));
  let guard = 0;
  for (let qi = 0; qi < queue.length && guard++ < 200000; qi++) {
    const s = queue[qi];
    if (!inside(s) || tooClose(s, new Set())) continue;
    const line = trace(s);
    if (line.length < 2 || pathLength(line) < sep) continue;
    for (const p of line) addPt(p);
    lines.push(line);
    seedFrom(line);
  }
  const ds = step(c, 1.5);
  return lines.map((l) => resampleEven(l, ds));
}

export const PATH_GENERATORS: Record<string, (c: FillCtx) => Pt[][]> = {
  spiral,
  tornado: (c) => radial(c, c.spacing * c.get("tightness"), c.get("rotations"), step(c, 1.5)),
  sunburst: (c) => radial(c, c.get("pitch"), 0, step(c, 3)),
  circular,
  contour,
  stipple,
  streamlines,
};
