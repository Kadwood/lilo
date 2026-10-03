import { bufferGeom, type Poly } from "../../geom";
import { DEFAULT_FILL_PATTERN, type FillGradient, type FillPatternId, type Pt } from "../../model";
import { makeCtx, type FillCtx } from "./ctx";
import { MOTIF_GENERATORS } from "./motifs";
import { PATH_GENERATORS } from "./paths";
import { chainPieces } from "./route";
import { ROW_GENERATORS } from "./rows";
import { clipLine, dist, rng, tidy } from "./util";

export { hashString } from "./util";

export interface FillRequest {
  /** The area to fill, already pull-compensated. */
  poly: Poly;
  pattern?: FillPatternId;
  patternParams?: Record<string, number>;
  angleDeg: number;
  rowSpacingMm: number;
  stitchLengthMm: number;
  handStitch?: number;
  seed: number;
  underpath?: boolean;
  gradient?: FillGradient;
  center?: Pt;
  guides?: Pt[][];
  /** Needle position before this fill starts. */
  from: Pt;
}

/** The longest edge a generated polyline may have (the plan validator splits anything beyond 12 mm). */
export const MAX_EDGE_MM = 10;
/** Stitches shorter than this are merged away. */
const MIN_GAP_MM = 0.2;

/** Generator for a pattern id, in world coordinates and unclipped. */
function generator(id: string): (c: FillCtx) => Pt[][] {
  return ROW_GENERATORS[id] ?? MOTIF_GENERATORS[id] ?? PATH_GENERATORS[id] ?? ROW_GENERATORS[DEFAULT_FILL_PATTERN];
}

/** Move needle points a little at random: along the line (irregular stitch length) and sideways. */
function applyHand(polys: Pt[][], c: FillCtx): Pt[][] {
  if (c.hand <= 0) return polys;
  const along = c.hand * 0.1 * c.stitchLen;
  const side = c.hand * 0.06;
  return polys.map((p) =>
    p.map((q, i): Pt => {
      if (i === 0 || i === p.length - 1) return q;
      const a = p[i - 1];
      const b = p[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const tx = (b[0] - a[0]) / len;
      const ty = (b[1] - a[1]) / len;
      const s = (c.rand() - 0.5) * 2 * along;
      const n = (c.rand() - 0.5) * 2 * side;
      return [q[0] + tx * s - ty * n, q[1] + ty * s + tx * n];
    }),
  );
}

function limitEdges(chain: Pt[], max: number): Pt[] {
  const out: Pt[] = [chain[0]];
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1];
    const b = chain[i];
    const d = dist(a, b);
    const n = Math.ceil(d / max);
    for (let k = 1; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    out.push(b);
  }
  return out;
}

/**
 * Generate a pattern fill as a list of polylines. Each polyline is sewn continuously; the needle
 * jumps between polylines. Everything stays inside `req.poly`. Deterministic for a given request.
 */
export function generateFill(req: FillRequest): Pt[][] {
  const id = req.pattern ?? DEFAULT_FILL_PATTERN;
  const c = makeCtx({
    patternId: id,
    poly: req.poly,
    angleDeg: req.angleDeg,
    rowSpacingMm: req.rowSpacingMm,
    stitchLengthMm: Math.min(req.stitchLengthMm, MAX_EDGE_MM),
    handStitch: req.handStitch ?? 0,
    rand: rng(req.seed),
    params: req.patternParams,
    center: req.center,
    guides: req.guides,
    gradient: req.gradient,
  });
  const raw = applyHand(generator(id)(c), c);
  const pieces: Pt[][] = [];
  for (const line of raw) {
    for (const piece of clipLine(c.poly, line)) {
      const t = tidy(piece, MIN_GAP_MM);
      if (t.length >= 2 && dist(t[0], t[t.length - 1]) + (t.length - 2) > 0.05) pieces.push(t);
    }
  }
  const travelArea = bufferGeom(c.poly, 0.05);
  const maxTravel = req.underpath ? 8 : Math.max(c.spacing * 2.2, 1);
  const chains = chainPieces(pieces, { from: req.from, maxTravel, travelArea });
  return chains.map((ch) => limitEdges(ch, MAX_EDGE_MM));
}
