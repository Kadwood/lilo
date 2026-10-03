import type { Pt } from "../../model";
import type { FillCtx } from "./ctx";
import { densify } from "./util";

/** Motif patterns: one small shape repeated on a lattice in the fill's local frame. */

type Motif = (cx: number, cy: number, s: number, nest: number) => Pt[][];

const NEST = [1, 0.62, 0.3];

function ring(cx: number, cy: number, r: number, n: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return pts;
}

const HEART: Pt[] = (() => {
  const raw: Pt[] = [];
  const n = 32;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    raw.push([16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]);
  }
  const ys = raw.map((p) => p[1]);
  const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  return raw.map((p): Pt => [p[0] / 32, (p[1] - mid) / 32]);
})();

const heart: Motif = (cx, cy, s, nest) =>
  NEST.slice(0, nest).map((k) => HEART.map((p): Pt => [cx + p[0] * s * k, cy + p[1] * s * k]));

const diamond: Motif = (cx, cy, s, nest) =>
  NEST.slice(0, nest).map((k) => {
    const r = (s / 2) * k;
    return [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy], [cx, cy - r]] as Pt[];
  });

const circle: Motif = (cx, cy, s, nest) => NEST.slice(0, nest).map((k) => ring(cx, cy, (s / 2) * k, Math.max(10, Math.ceil(Math.PI * s * k))));

const star: Motif = (cx, cy, s) => {
  const pts: Pt[] = [];
  for (let i = 0; i <= 10; i++) {
    const r = i % 2 === 0 ? s / 2 : s * 0.2;
    const t = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return [pts];
};

const SQ3 = Math.sqrt(3);
const hexVertex = (cx: number, cy: number, R: number, k: number): Pt => {
  const t = -Math.PI / 2 + (k * Math.PI) / 3;
  return [cx + R * Math.cos(t), cy + R * Math.sin(t)];
};

const hexweave: Motif = (cx, cy, s) => {
  const R = s / SQ3;
  const vs = Array.from({ length: 7 }, (_, k) => hexVertex(cx, cy, R, k % 6));
  return [vs, ...[0, 2, 4].map((k): Pt[] => [[cx, cy], hexVertex(cx, cy, R, k)])];
};

const honeycomb: Motif = (cx, cy, s) => {
  const R = s / SQ3;
  return [[0, 1, 2, 3].map((k) => hexVertex(cx, cy, R, k))];
};

/** Each brick owns its left and top edge so neighbours don't double up. */
const brick: Motif = (cx, cy, s) => {
  const w = s * 1.6;
  const h = s * 0.8;
  return [[[cx - w / 2, cy + h / 2], [cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2]]];
};

const scale: Motif = (cx, cy, s) =>
  NEST.map((k) => {
    const pts: Pt[] = [];
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI;
      pts.push([cx + (s / 2) * k * Math.cos(t), cy - s * 0.25 + (s / 2) * k * Math.sin(t)]);
    }
    return pts;
  });

const chevron: Motif = (cx, cy, s) => [[[cx - s / 2, cy - s / 4], [cx, cy + s / 4], [cx + s / 2, cy - s / 4]]];

interface Lattice {
  /** Cell size (mm). */
  w: number;
  h: number;
  /** Fraction of a cell each odd row is shifted by. */
  shift: number;
  motif: Motif;
  nest: number;
  /** Motif size passed to the motif function (mm). */
  size: number;
  /** Alternate the motif per cell (herringbone/basket weave) */
  perCell?: (i: number, j: number, cx: number, cy: number) => Pt[][];
}

function lattice(c: FillCtx, l: Lattice): Pt[][] {
  const out: Pt[][] = [];
  const maxEdge = Math.min(c.stitchLen, 2.2);
  const j0 = Math.floor((c.v0 - l.h) / l.h);
  const j1 = Math.ceil((c.v1 + l.h) / l.h);
  const i0 = Math.floor((c.u0 - l.w * 2) / l.w);
  const i1 = Math.ceil((c.u1 + l.w * 2) / l.w);
  for (let j = j0; j <= j1; j++) {
    const cy = j * l.h;
    const rowShift = (((j % 2) + 2) % 2) * l.shift * l.w;
    for (let i = i0; i <= i1; i++) {
      const cx = i * l.w + rowShift;
      const shapes = l.perCell ? l.perCell(i, j, cx, cy) : l.motif(cx, cy, l.size, l.nest);
      for (const sh of shapes) out.push(densify(sh, maxEdge).map(c.toWorld));
    }
  }
  return out;
}

const spread = (c: FillCtx): number => 1 + Math.max(0, c.spacing - 0.4);

const stroke = (cx: number, cy: number, s: number, dir: 1 | -1): Pt[] => [[cx - s / 2, cy - (dir * s) / 2], [cx + s / 2, cy + (dir * s) / 2]];

const basket = (s: number) => (i: number, j: number, cx: number, cy: number): Pt[][] => {
  const horiz = (((i + j) % 2) + 2) % 2 === 0;
  return [-1, 0, 1].map((k): Pt[] => (horiz ? [[cx - s * 0.45, cy + (k * s) / 3], [cx + s * 0.45, cy + (k * s) / 3]] : [[cx + (k * s) / 3, cy - s * 0.45], [cx + (k * s) / 3, cy + s * 0.45]]));
};

type LatticeSpec = (c: FillCtx) => Lattice;

const nestOf = (id: string): number => (id.endsWith("-l") ? 3 : id.endsWith("-m") ? 2 : 1);

const SPECS: Record<string, LatticeSpec> = {};
for (const id of ["hearts-s", "hearts-m", "hearts-l"]) {
  SPECS[id] = (c) => {
    const s = c.get("size");
    return { w: s * 1.1 * spread(c), h: s * 1.0 * spread(c), shift: 0.5, motif: heart, nest: nestOf(id), size: s };
  };
}
for (const id of ["diamonds-s", "diamonds-m", "diamonds-l"]) {
  SPECS[id] = (c) => {
    const s = c.get("size");
    return { w: s * spread(c), h: s * 0.5 * spread(c), shift: 0.5, motif: diamond, nest: nestOf(id), size: s };
  };
}
for (const id of ["circles-s", "circles-m", "circles-l"]) {
  SPECS[id] = (c) => {
    const s = c.get("size");
    return { w: s * 1.05 * spread(c), h: s * 0.9 * spread(c), shift: 0.5, motif: circle, nest: nestOf(id), size: s };
  };
}
SPECS.hexweave = (c) => {
  const s = c.get("size");
  return { w: s * spread(c), h: ((s / SQ3) * 1.5) * spread(c), shift: 0.5, motif: hexweave, nest: 1, size: s };
};
SPECS.honeycomb = (c) => {
  const s = c.get("size");
  return { w: s * spread(c), h: ((s / SQ3) * 1.5) * spread(c), shift: 0.5, motif: honeycomb, nest: 1, size: s };
};
SPECS.brick = (c) => {
  const s = c.get("size");
  return { w: s * 1.6 * spread(c), h: s * 0.8 * spread(c), shift: 0.5, motif: brick, nest: 1, size: s };
};
SPECS.stars = (c) => {
  const s = c.get("size");
  return { w: s * 1.1 * spread(c), h: s * 0.95 * spread(c), shift: 0.5, motif: star, nest: 1, size: s };
};
SPECS.scales = (c) => {
  const s = c.get("size");
  return { w: s * spread(c), h: s * 0.5 * spread(c), shift: 0.5, motif: scale, nest: 3, size: s };
};
SPECS.chevrons = (c) => {
  const s = c.get("size");
  return { w: s * spread(c), h: s * 0.5 * spread(c), shift: 0, motif: chevron, nest: 1, size: s };
};
SPECS.herringbone = (c) => {
  const s = c.get("size");
  return {
    w: s * spread(c),
    h: s * spread(c),
    shift: 0,
    motif: star,
    nest: 1,
    size: s,
    perCell: (i, _j, cx, cy) => [stroke(cx, cy, s, i % 2 === 0 ? 1 : -1)],
  };
};
SPECS.basketweave = (c) => {
  const s = c.get("size");
  return { w: s * spread(c), h: s * spread(c), shift: 0, motif: star, nest: 1, size: s, perCell: basket(s) };
};

export const MOTIF_GENERATORS: Record<string, (c: FillCtx) => Pt[][]> = Object.fromEntries(Object.entries(SPECS).map(([id, spec]) => [id, (c: FillCtx) => lattice(c, spec(c))]));
