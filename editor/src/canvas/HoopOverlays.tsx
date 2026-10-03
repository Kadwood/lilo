import { useRef } from "react";
import { useStore } from "zustand";
import { findPlacementGuide, type PlacementGuide } from "@lilo/engine/light";
import { addGuide, hoopViewStore, moveGuide, removeGuide, type Guide } from "../state/hoopViewStore";
import type { Units } from "../state/units";
import { rulerTicks } from "./rulerTicks";
import type { View } from "./viewport";

/** Thickness of a ruler, px. */
export const RULER_PX = 22;

/** Where the pointer is inside the stage, from any pointer event. */
function stagePoint(e: { clientX: number; clientY: number }, el: Element): { x: number; y: number; w: number; h: number } {
  const stage = el.closest(".canvas-stage") ?? el;
  const r = stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
}

/**
 * Drag a guide: from a ruler it creates one, on a guide it moves it; letting go over a ruler (or off the
 * canvas) takes it away. `axis` "x" is a vertical line at an x position.
 */
function useGuideDrag(view: View) {
  const dragging = useRef<number | null>(null);
  const toMm = (axis: Guide["axis"], p: { x: number; y: number }) => (axis === "x" ? (p.x - view.x) / view.zoom : (p.y - view.y) / view.zoom);
  const start = (e: React.PointerEvent, axis: Guide["axis"], existing?: number) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement | SVGElement;
    el.setPointerCapture?.(e.pointerId);
    const p = stagePoint(e, el);
    dragging.current = existing ?? addGuide(axis, toMm(axis, p));
  };
  const move = (e: React.PointerEvent, axis: Guide["axis"]) => {
    if (dragging.current === null) return;
    moveGuide(dragging.current, toMm(axis, stagePoint(e, e.currentTarget as Element)));
  };
  const end = (e: React.PointerEvent, axis: Guide["axis"]) => {
    const id = dragging.current;
    if (id === null) return;
    dragging.current = null;
    const p = stagePoint(e, e.currentTarget as Element);
    const along = axis === "x" ? p.x : p.y;
    // dropped back on the ruler (or past the far edge): the guide goes away
    if (along < RULER_PX || along > (axis === "x" ? p.w : p.h)) removeGuide(id);
  };
  return { start, move, end };
}

/** Rulers along the top and left of the canvas (mm or inches, following zoom and pan), with a unit corner. */
export function Rulers({ view, width, height, units, onToggleUnits }: { view: View; width: number; height: number; units: Units; onToggleUnits: () => void }) {
  const on = useStore(hoopViewStore, (s) => s.showRulers);
  const drag = useGuideDrag(view);
  if (!on || width < 120 || height < 120) return null;
  const top = rulerTicks(view.x, view.zoom, width, units);
  const left = rulerTicks(view.y, view.zoom, height, units);
  return (
    <div className="rulers" data-testid="rulers">
      <button className="ruler-corner" onClick={onToggleUnits} title="Switch between millimetres and inches" aria-label={`Ruler units: ${units}. Switch`}>
        {units}
      </button>
      <svg
        className="ruler ruler-top"
        width={width - RULER_PX}
        height={RULER_PX}
        aria-label="Top ruler: drag down to make a horizontal guide"
        onPointerDown={(e) => drag.start(e, "y")}
        onPointerMove={(e) => drag.move(e, "y")}
        onPointerUp={(e) => drag.end(e, "y")}
      >
        {top.map((t) => (
          <g key={t.mm} transform={`translate(${t.px - RULER_PX} 0)`}>
            <line x1="0" x2="0" y1={t.major ? 8 : 15} y2={RULER_PX} />
            {t.label !== undefined && (
              <text x="3" y="10">
                {t.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <svg
        className="ruler ruler-left"
        width={RULER_PX}
        height={height - RULER_PX}
        aria-label="Left ruler: drag right to make a vertical guide"
        onPointerDown={(e) => drag.start(e, "x")}
        onPointerMove={(e) => drag.move(e, "x")}
        onPointerUp={(e) => drag.end(e, "x")}
      >
        {left.map((t) => (
          <g key={t.mm} transform={`translate(0 ${t.px - RULER_PX})`}>
            <line y1="0" y2="0" x1={t.major ? 8 : 15} x2={RULER_PX} />
            {t.label !== undefined && (
              <text x="0" y="0" transform="translate(10 3) rotate(-90)" textAnchor="end">
                {t.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function PlacementShape({ g, view }: { g: PlacementGuide; view: View }) {
  const z = view.zoom;
  const x = view.x - (g.widthMm / 2) * z;
  const y = view.y - (g.heightMm / 2) * z;
  const w = g.widthMm * z;
  const h = g.heightMm * z;
  let outline: React.ReactNode;
  if (g.kind === "cap") {
    // a cap front seen flat: a curved top edge and a gently curved bottom
    const bow = h * 0.16;
    outline = <path d={`M ${x} ${y + bow} Q ${x + w / 2} ${y - bow} ${x + w} ${y + bow} L ${x + w} ${y + h} Q ${x + w / 2} ${y + h + bow * 0.5} ${x} ${y + h} Z`} />;
  } else if (g.kind === "cuff") {
    // a barrel cuff: square at the top, buttonhole end rounded
    outline = <rect x={x} y={y} width={w} height={h} rx={Math.min(w, h) * 0.12} />;
  } else if (g.kind === "pocket") {
    // the lining panel with the welt opening near the top
    outline = (
      <>
        <rect x={x} y={y} width={w} height={h} rx={Math.min(w, h) * 0.05} />
        <rect x={x + w * 0.18} y={y + h * 0.5} width={w * 0.64} height={Math.max(3, 4 * z)} rx="2" className="placement-welt" />
      </>
    );
  } else {
    outline = <rect x={x} y={y} width={w} height={h} rx={Math.min(w, h) * 0.04} />;
  }
  const mx = view.x - (g.maxDesignMm.w / 2) * z;
  const my = view.y - (g.maxDesignMm.h / 2) * z;
  return (
    <g>
      <g className="placement-area">{outline}</g>
      <rect className="placement-max" x={mx} y={my} width={g.maxDesignMm.w * z} height={g.maxDesignMm.h * z} />
      <text className="placement-label" x={Math.max(x + 8, RULER_PX + 8)} y={Math.max(y + 16, RULER_PX + 16)}>
        {g.label} (approximate)
      </text>
      <text className="placement-sub" x={Math.max(mx + 6, RULER_PX + 8)} y={my + g.maxDesignMm.h * z - 6}>
        recommended max {g.maxDesignMm.w} × {g.maxDesignMm.h} mm
      </text>
    </g>
  );
}

/** The placement template (if one is picked) and the guides the user dragged out of the rulers. */
export function GuidesLayer({ view, width, height, units }: { view: View; width: number; height: number; units: Units }) {
  const placementId = useStore(hoopViewStore, (s) => s.placementId);
  const guides = useStore(hoopViewStore, (s) => s.guides);
  const rulers = useStore(hoopViewStore, (s) => s.showRulers);
  const drag = useGuideDrag(view);
  const placement = findPlacementGuide(placementId);
  if (!placement && guides.length === 0) return null;
  const off = rulers ? RULER_PX : 0;
  return (
    <svg className="guides-layer" width={width} height={height} aria-hidden={guides.length === 0}>
      {placement && <PlacementShape g={placement} view={view} />}
      {guides.map((g) => {
        const pos = (g.axis === "x" ? view.x : view.y) + g.mm * view.zoom;
        const label = units === "in" ? `${(g.mm / 25.4).toFixed(2)} in` : `${Math.round(g.mm * 10) / 10} mm`;
        const [x1, y1, x2, y2] = g.axis === "x" ? [pos, off, pos, height] : [off, pos, width, pos];
        return (
          <g key={g.id} className="guide">
            <line className="guide-line" x1={x1} y1={y1} x2={x2} y2={y2} />
            <line
              className="guide-hit"
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              role="separator"
              aria-label={`Guide at ${label}. Drag to move, drag onto the ruler or double-click to remove`}
              onPointerDown={(e) => drag.start(e, g.axis, g.id)}
              onPointerMove={(e) => drag.move(e, g.axis)}
              onPointerUp={(e) => drag.end(e, g.axis)}
              onDoubleClick={() => removeGuide(g.id)}
            />
            <text className="guide-label" x={g.axis === "x" ? pos + 4 : off + 4} y={g.axis === "x" ? off + 12 : pos - 4}>
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
