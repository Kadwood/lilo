/**
 * Timing of the tracing animation, in seconds from the moment a result arrives:
 *   quantised image -> outlines draw on, one colour layer at a time -> stitches fade in.
 */
export interface Timeline {
  /** Quantised image shown until here. */
  quantizeEnd: number;
  /** Start time of each colour layer's outline drawing. */
  layerStart: number[];
  /** How long one layer takes to draw. */
  layerDuration: number;
  traceEnd: number;
  stitchStart: number;
  stitchEnd: number;
  total: number;
}

export function buildTimeline(layerCount: number, reducedMotion: boolean): Timeline {
  if (reducedMotion) {
    return { quantizeEnd: 0, layerStart: Array.from({ length: layerCount }, () => 0), layerDuration: 0, traceEnd: 0, stitchStart: 0, stitchEnd: 0, total: 0 };
  }
  const quantizeEnd = 0.9;
  // Keep the whole trace under about 3.5 s however many colours there are.
  const stagger = Math.min(0.6, 2.6 / Math.max(1, layerCount));
  const layerDuration = 0.9;
  const layerStart = Array.from({ length: layerCount }, (_, k) => quantizeEnd + k * stagger);
  const traceEnd = (layerStart[layerCount - 1] ?? quantizeEnd) + layerDuration;
  const stitchStart = traceEnd;
  const stitchEnd = stitchStart + 0.8;
  return { quantizeEnd, layerStart, layerDuration, traceEnd, stitchStart, stitchEnd, total: stitchEnd };
}

export type AnimPhase = "quantize" | "trace" | "stitch" | "done";

export function phaseAt(t: Timeline, seconds: number): AnimPhase {
  if (seconds < t.quantizeEnd) return "quantize";
  if (seconds < t.traceEnd) return "trace";
  if (seconds < t.stitchEnd) return "stitch";
  return "done";
}

export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
