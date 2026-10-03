/**
 * Ruler tick maths: given where the design origin sits on screen and the zoom, which ticks to draw
 * along one ruler. Pure functions, no DOM. The origin of a ruler is the hoop centre (design 0,0).
 */
import type { Units } from "../state/units";

export interface Tick {
  /** Screen pixels from the start of the ruler. */
  px: number;
  /** Design position, mm. */
  mm: number;
  /** Major ticks carry a label. */
  major: boolean;
  label?: string;
}

const MM_PER_IN = 25.4;
/** Closest two labels may sit, in px. */
export const MIN_LABEL_PX = 56;

/** Steps in the ruler's own unit that look natural: 1, 2, 5 times a power of ten (and fractions of an inch). */
const MM_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
const IN_STEPS = [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 5, 10, 20, 50];

/** The smallest labelled step (in mm) whose spacing on screen is at least `minPx`. */
export function labelStepMm(zoom: number, units: Units, minPx = MIN_LABEL_PX): number {
  const steps = units === "in" ? IN_STEPS.map((s) => s * MM_PER_IN) : MM_STEPS;
  return steps.find((s) => s * zoom >= minPx) ?? steps[steps.length - 1];
}

/** How many minor ticks fit between two labelled ones (so the minors never get denser than ~6 px). */
export function subdivisions(stepMm: number, zoom: number, units: Units): number {
  let candidates: number[];
  if (units === "in") candidates = [8, 4, 2];
  else {
    const exp = Math.pow(10, Math.floor(Math.log10(stepMm) + 1e-9));
    const lead = Math.round(stepMm / exp); // 1, 2 or 5
    candidates = lead === 1 ? [10, 5, 2] : lead === 2 ? [4, 2] : [5, 1];
  }
  return candidates.find((n) => (stepMm * zoom) / n >= 6) ?? 1;
}

/** "12", "2.5", "0.125" without trailing zeros; unit-free (the ruler prints the unit once, in its corner). */
export function formatTick(mm: number, units: Units): string {
  const v = units === "in" ? mm / MM_PER_IN : mm;
  const r = Math.round(v * 1000) / 1000;
  if (Object.is(r, -0)) return "0";
  return String(r);
}

/**
 * Ticks for one ruler. `originPx` is the screen position of design 0 along the ruler's axis, `zoom`
 * is px per mm, `length` the ruler's length in px.
 */
export function rulerTicks(originPx: number, zoom: number, length: number, units: Units): Tick[] {
  if (!(zoom > 0) || !(length > 0)) return [];
  const step = labelStepMm(zoom, units);
  const sub = subdivisions(step, zoom, units);
  const minor = step / sub;
  const minMm = (0 - originPx) / zoom;
  const maxMm = (length - originPx) / zoom;
  const first = Math.floor(minMm / minor) - 1;
  const last = Math.ceil(maxMm / minor) + 1;
  const out: Tick[] = [];
  for (let i = first; i <= last; i++) {
    const mm = i * minor;
    const px = originPx + mm * zoom;
    if (px < -1 || px > length + 1) continue;
    const major = i % sub === 0;
    out.push(major ? { px, mm, major, label: formatTick(mm, units) } : { px, mm, major });
  }
  return out;
}
