/**
 * Click-to-stitch (spec 4.3): the traced regions of an imported picture, kept as plain data so the
 * editor can hit-test them under the mouse and turn the ones the user clicks into objects. No jsts:
 * this file is part of the light entry and runs on the main thread. The regions are built once, by
 * `autoDigitize`, from the same trace the automatic result comes from, so nothing is traced twice.
 */
import {
  DEFAULT_FILL_PARAMS,
  DEFAULT_RUN_PARAMS,
  nodesFromPolyline,
  makeFill,
  makeRun,
  simplifyPolyline,
  type Box,
  type DesignObject,
  type FillParams,
  type Pt,
  type RunParams,
  type Thread,
} from "./model";

/** One connected same-colour area of the trace, in design millimetres. */
export interface TraceRegion {
  /** Stable within one trace: `r1`, `r2`... */
  id: string;
  /** The traced colour ("#rrggbb"): already a thread colour for pictures, the artwork's own for SVGs. */
  hex: string;
  /** The thread that colour snapped to. */
  thread: Thread;
  shell: Pt[];
  holes: Pt[][];
  areaMm2: number;
  box: Box;
}

/** Even-odd point-in-ring test. */
export function pointInRing(p: Pt, ring: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Is `p` inside the region (inside the shell, outside every hole)? */
export function regionContains(r: TraceRegion, p: Pt): boolean {
  const b = r.box;
  if (p[0] < b.minX || p[0] > b.maxX || p[1] < b.minY || p[1] > b.maxY) return false;
  if (!pointInRing(p, r.shell)) return false;
  return !r.holes.some((h) => pointInRing(p, h));
}

/** The region under `p`: the smallest one when several overlap (SVG artwork can), else null. */
export function hitRegion(regions: readonly TraceRegion[], p: Pt): TraceRegion | null {
  let best: TraceRegion | null = null;
  for (const r of regions) {
    if (regionContains(r, p) && (!best || r.areaMm2 < best.areaMm2)) best = r;
  }
  return best;
}

/** How a clicked region is stitched. */
export interface RegionStitchSettings {
  /** `fill` sews the whole area; `outline` sews its edge (and the edges of its holes) as runs. */
  style: "fill" | "outline";
  fill: FillParams;
  run: RunParams;
  /** Sew in this thread instead of the traced colour. */
  thread?: Thread;
}

export const DEFAULT_REGION_SETTINGS: RegionStitchSettings = {
  style: "fill",
  fill: { ...DEFAULT_FILL_PARAMS },
  run: { ...DEFAULT_RUN_PARAMS },
};

/** Outline tolerance (mm) when a region becomes an editable object: fine enough to look the same. */
const SIMPLIFY_MM = 0.05;

const closedSimple = (ring: readonly Pt[]): Pt[] => {
  const s = simplifyPolyline([...ring, ring[0]], SIMPLIFY_MM).slice(0, -1);
  return s.length >= 3 ? s : [...ring];
};

/**
 * The objects a region becomes: one fill (with its holes), or one closed run per outline. `newId`
 * hands out unique ids (`makeIdGen`). Thread: `settings.thread` if set, else the region's.
 */
export function regionToObjects(r: TraceRegion, settings: RegionStitchSettings, newId: () => string): { objects: DesignObject[]; thread: Thread } {
  const thread = settings.thread ?? r.thread;
  const shell = closedSimple(r.shell);
  const holes = r.holes.map(closedSimple);
  if (settings.style === "outline") {
    const rings = [shell, ...holes];
    const objects = rings.map((ring, i) =>
      makeRun(newId(), `${thread.name} outline ${r.id}${i === 0 ? "" : `.${i}`}`, thread.id, nodesFromPolyline(ring), true, { ...settings.run }),
    );
    return { objects, thread };
  }
  const fill = makeFill(newId(), `${thread.name} region ${r.id}`, thread.id, nodesFromPolyline(shell), holes);
  fill.params = { ...settings.fill };
  return { objects: [fill], thread };
}
