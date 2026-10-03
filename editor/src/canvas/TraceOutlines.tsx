import { objectPoints, type Design, type DesignObject } from "@lilo/engine/light";
import type { Timeline } from "./timeline";

const fmt = (n: number) => Math.round(n * 1000) / 1000;

/** SVG path data (mm) for an object's outline, as it will be stitched. */
export function outlinePath(o: DesignObject): string {
  const ring = (pts: readonly (readonly [number, number])[], close: boolean) =>
    pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${fmt(x)} ${fmt(y)}`).join("") + (close ? "Z" : "");
  if (o.kind === "fill") return ring(o.geometry.shell, true) + o.geometry.holes.map((h) => ring(h, true)).join("");
  if (o.kind === "satin") {
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (let i = 0; i + 1 < o.geometry.strip.length; i += 2) {
      left.push([...o.geometry.strip[i]] as [number, number]);
      right.push([...o.geometry.strip[i + 1]] as [number, number]);
    }
    return ring([...left, ...right.reverse()], true);
  }
  return ring(objectPoints(o), o.geometry.closed);
}

/**
 * The "outlines draw on" step of the tracing animation: every object's outline, stroked in its
 * thread colour, drawn on with a dash-offset animation. Colour layers start one after another.
 * Strokes keep their pixel width at any zoom (`vector-effect`).
 */
export function TraceOutlines({ design, timeline }: { design: Design; timeline: Timeline }) {
  const layerOf = new Map(design.threads.map((t, i) => [t.id, i]));
  return (
    <g className="trace-outlines" style={{ animationDelay: `${timeline.traceEnd}s` }}>
      {design.objects.map((o) => {
        if (o.visible === false) return null;
        const layer = layerOf.get(o.threadId) ?? 0;
        const hex = design.threads[layer]?.hex ?? "#000";
        return (
          <path
            key={o.id}
            className="trace-path"
            d={outlinePath(o)}
            stroke={hex}
            pathLength={1}
            style={{ animationDelay: `${timeline.layerStart[layer] ?? 0}s`, animationDuration: `${timeline.layerDuration}s` }}
          />
        );
      })}
    </g>
  );
}
