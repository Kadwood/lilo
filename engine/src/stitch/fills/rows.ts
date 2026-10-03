import type { Pt } from "../../model";
import type { FillCtx } from "./ctx";

/** Row patterns: parallel rows of needle points in the fill's local frame, bent or broken per pattern. */

type RowFn = (c: FillCtx, r: number, v: number, a: number, b: number) => Pt[];

/** Row spacing multiplier at position `t` (0..1) across the rows. */
export function gradientScale(c: FillCtx, t: number): number {
  const g = c.gradient;
  if (!g) return 1;
  const tt = g.reverse ? 1 - t : t;
  const k = g.kind === "plateau" ? 1 - Math.abs(2 * tt - 1) : tt;
  return Math.max(0.2, g.from + (g.to - g.from) * k);
}

/** Needle positions `off + k*step` strictly between a and b, plus a and b themselves. */
export function lattice(a: number, b: number, step: number, off: number): number[] {
  const out = [a];
  const k0 = Math.ceil((a - off) / step);
  for (let u = off + k0 * step; u < b - 1e-9; u += step) if (u > a + 1e-9) out.push(u);
  out.push(b);
  return out;
}

interface RowOpts {
  pitch?: number;
  /** Extra length (mm) to run each row past the shape so a bent row still covers it. */
  padU?: number;
  padV?: number;
}

function buildRows(c: FillCtx, fn: RowFn, o: RowOpts = {}): Pt[][] {
  const pitch = o.pitch ?? c.spacing;
  const padU = o.padU ?? 1;
  const padV = o.padV ?? 1;
  const out: Pt[][] = [];
  const span = Math.max(c.v1 - c.v0, 1e-6);
  let r = 0;
  for (let v = c.v0 - padV; v <= c.v1 + padV; r++) {
    const t = Math.min(1, Math.max(0, (v - c.v0) / span));
    const pts = fn(c, r, v, c.u0 - padU, c.u1 + padU);
    out.push(pts.map(c.toWorld));
    v += pitch * gradientScale(c, t);
    if (r > 20000) break;
  }
  return out;
}

const flat = (frac: number[]): RowFn => (c, r, v, a, b) => lattice(a, b, c.stitchLen, frac[r % frac.length] * c.stitchLen).map((u): Pt => [u, v]);

const triangle: RowFn = (c, _r, v, a, b) => {
  const amp = c.spacing * 1.5;
  const half = c.stitchLen / 2;
  const pts: Pt[] = [];
  const k0 = Math.floor(a / half);
  for (let k = k0, u = k0 * half; u <= b + half; k++, u += half) pts.push([u, v + (k % 2 === 0 ? -amp : amp)]);
  return pts;
};

const waves: RowFn = (c, _r, v, a, b) => {
  const steps = Math.max(2, Math.round(c.get("steps")));
  const amp = c.get("amplitude");
  const du = c.stitchLen / 2;
  const halfWave = steps * du;
  const pts: Pt[] = [];
  for (let u = Math.floor(a / du) * du; u <= b + du; u += du) pts.push([u, v + amp * Math.sin((Math.PI * u) / halfWave)]);
  return pts;
};

const zigzag: RowFn = (c, _r, v, a, b) => {
  const w = c.get("width");
  const du = Math.max(c.spacing, 0.25);
  const pts: Pt[] = [];
  let k = Math.floor(a / du);
  for (let u = k * du; u <= b + du; u += du, k++) pts.push([u, v + (k % 2 === 0 ? -w / 2 : w / 2)]);
  return pts;
};

const heartbeat: RowFn = (c, _r, v, a, b) => {
  const amp = c.get("intensity") * 0.5;
  const L = c.stitchLen;
  const period = L * 5;
  const spike: [number, number][] = [
    [0, 0],
    [0.5, -0.25],
    [1.0, 0.9],
    [1.5, -0.8],
    [2.0, 0.2],
    [2.5, 0],
  ];
  const pts: Pt[] = [];
  for (let p0 = Math.floor(a / period) * period; p0 <= b + period; p0 += period) {
    for (const [du, dv] of spike) pts.push([p0 + du * L, v + dv * amp]);
  }
  return pts;
};

const staircase: RowFn = (c, _r, v, a, b) => {
  const rise = c.get("stepHeight");
  const steps = Math.max(1, Math.round(c.get("steps")));
  const tread = steps * c.stitchLen;
  const pts: Pt[] = [];
  for (let k = Math.floor(a / tread), u = k * tread; u <= b + tread; k++, u += tread) {
    const h = v + k * rise;
    for (let s = 0; s < steps; s++) pts.push([u + s * c.stitchLen, h]);
    pts.push([u + tread, h]);
    pts.push([u + tread, h + rise]);
  }
  // thin out duplicate treads (the riser end doubles as the next tread start)
  return pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
};

function rainfall(c: FillCtx): Pt[][] {
  const chaos = c.get("chaos");
  const density = c.get("density");
  const L = c.stitchLen;
  const fn: RowFn = (cc, _r, v, a, b) => {
    const pts: Pt[] = [];
    let u = a - cc.rand() * L * (0.3 + chaos);
    pts.push([u, v]);
    while (u < b) {
      u += L * (1 - chaos * 0.7 + cc.rand() * chaos * 1.4);
      pts.push([u, v]);
    }
    return pts;
  };
  return buildRows(c, fn, { pitch: c.spacing / density });
}

const lines = (c: FillCtx, pitch: number, along: "u" | "v", bands = 1): Pt[][] => {
  const out: Pt[][] = [];
  const step = c.stitchLen;
  const [p0, p1, q0, q1] = along === "u" ? [c.v0, c.v1, c.u0, c.u1] : [c.u0, c.u1, c.v0, c.v1];
  const bandGap = c.spacing * 1.5;
  for (let p = Math.floor(p0 / pitch) * pitch; p <= p1 + pitch; p += pitch) {
    for (let k = 0; k < bands; k++) {
      const pp = p + (k - (bands - 1) / 2) * bandGap;
      const pts = lattice(q0 - 1, q1 + 1, step, 0).map((q): Pt => (along === "u" ? [q, pp] : [pp, q]));
      out.push(pts.map(c.toWorld));
    }
  }
  return out;
};

export const ROW_GENERATORS: Record<string, (c: FillCtx) => Pt[][]> = {
  tatami: (c) => buildRows(c, flat([0, 1 / 3, 2 / 3])),
  original: (c) => buildRows(c, flat([0, 0.5, 0.25, 0.75])),
  columns: (c) => buildRows(c, flat([0])),
  "offset-columns": (c) => buildRows(c, flat([0, 0.5])),
  triangle: (c) => buildRows(c, triangle, { padV: 2 }),
  waves: (c) => buildRows(c, waves, { padV: c.get("amplitude") + 1 }),
  zigzag: (c) => buildRows(c, zigzag, { pitch: c.get("width"), padV: c.get("width") }),
  heartbeat: (c) => buildRows(c, heartbeat, { padV: c.get("intensity") + 1 }),
  staircase: (c) => {
    const rise = c.get("stepHeight");
    const steps = Math.max(1, Math.round(c.get("steps")));
    // the stairs climb across the whole width: widen the row range by the total climb
    const climb = Math.ceil((c.u1 - c.u0) / (steps * c.stitchLen) + 2) * rise;
    return buildRows(c, staircase, { padV: climb + 1 });
  },
  rainfall,
  crosshatch: (c) => {
    const pitch = c.get("pitch");
    return [...lines(c, pitch, "u"), ...lines(c, pitch, "v")];
  },
  plaid: (c) => {
    const pitch = c.get("pitch");
    return [...lines(c, pitch, "u", 3), ...lines(c, pitch, "v", 3)];
  },
};
