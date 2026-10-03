import type { Geom } from "../../geom";
import type { Pt } from "../../model";
import { dist, lineString } from "./util";

const isClosed = (p: readonly Pt[]): boolean => p.length > 3 && dist(p[0], p[p.length - 1]) < 1e-6;

export interface ChainOptions {
  /** Where the needle is when this fill starts. */
  from: Pt;
  /** Longest connecting stitch allowed between two pieces. Further than this, a jump. */
  maxTravel: number;
  /** Polygon (slightly grown) a connecting stitch has to stay inside. */
  travelArea: Geom;
}

interface Candidate {
  piece: number;
  /** Which end (0 = start, 1 = end) or, for closed rings, a vertex index. */
  at: number;
  p: Pt;
}

const rotateRing = (ring: readonly Pt[], k: number): Pt[] => {
  const open = ring.slice(0, -1);
  const rot = [...open.slice(k), ...open.slice(0, k)];
  return [...rot, rot[0]];
};

/**
 * Order pieces greedily (nearest next end) into chains. Two pieces join into one chain when the
 * gap is within `maxTravel` and the straight connection stays inside the area; otherwise the next
 * piece starts a new chain, which the generator sews after a jump. Closed rings may start at any
 * vertex, so they are entered where the needle already is.
 */
export function chainPieces(pieces: readonly (readonly Pt[])[], o: ChainOptions): Pt[][] {
  const left = pieces.filter((p) => p.length >= 2).map((p) => [...p] as Pt[]);
  const closedFlags = left.map(isClosed);
  const used = new Array<boolean>(left.length).fill(false);
  const chains: Pt[][] = [];
  let remaining = left.length;

  // Bucket piece endpoints (and a sample of ring vertices) in a grid so the nearest search is local.
  const cell = Math.max(o.maxTravel, 1);
  const grid = new Map<string, Candidate[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const add = (c: Candidate) => {
    const k = key(c.p[0], c.p[1]);
    const l = grid.get(k);
    if (l) l.push(c);
    else grid.set(k, [c]);
  };
  left.forEach((p, i) => {
    if (closedFlags[i]) {
      const n = p.length - 1;
      const stepV = Math.max(1, Math.floor(n / 12));
      for (let k = 0; k < n; k += stepV) add({ piece: i, at: k, p: p[k] });
    } else {
      add({ piece: i, at: 0, p: p[0] });
      add({ piece: i, at: 1, p: p[p.length - 1] });
    }
  });

  /** Unused candidates within `radius` of `to`, nearest first. */
  const near = (to: Pt, radius: number): Candidate[] => {
    const cx = Math.floor(to[0] / cell);
    const cy = Math.floor(to[1] / cell);
    const reach = Math.ceil(radius / cell);
    const found: { c: Candidate; d: number }[] = [];
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        const l = grid.get(`${cx + dx},${cy + dy}`);
        if (!l) continue;
        for (const c of l) {
          if (used[c.piece]) continue;
          const d = dist(to, c.p);
          if (d <= radius) found.push({ c, d });
        }
      }
    }
    found.sort((a, b) => a.d - b.d);
    return found.map((f) => f.c);
  };

  /** Globally nearest unused candidate (for starting a new chain); linear scan. */
  const nearestAny = (to: Pt): Candidate | null => {
    let best: Candidate | null = null;
    let bd = Infinity;
    for (const l of grid.values()) {
      for (const c of l) {
        if (used[c.piece]) continue;
        const d = dist(to, c.p);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
    }
    return best;
  };

  const oriented = (c: Candidate): Pt[] => {
    const p = left[c.piece];
    if (closedFlags[c.piece]) return rotateRing(p, c.at);
    return c.at === 0 ? p : [...p].reverse();
  };

  let cursor: Pt = o.from;
  while (remaining > 0) {
    const c = nearestAny(cursor);
    if (!c) break;
    const chain = oriented(c);
    used[c.piece] = true;
    remaining--;
    for (;;) {
      const end = chain[chain.length - 1];
      let next: Candidate | null = null;
      let tries = 0;
      for (const cand of near(end, o.maxTravel)) {
        if (dist(end, cand.p) < 1e-6 || o.travelArea.covers(lineString([end, cand.p]))) {
          next = cand;
          break;
        }
        if (++tries >= 6) break;
      }
      if (!next) break;
      const seg = oriented(next);
      used[next.piece] = true;
      remaining--;
      // drop the join point when the new piece starts on top of where the chain ended
      seg.forEach((p, k) => {
        if (k === 0 && dist(chain[chain.length - 1], p) < 0.2) return;
        chain.push(p);
      });
    }
    chains.push(chain);
    cursor = chain[chain.length - 1];
  }
  return chains;
}
