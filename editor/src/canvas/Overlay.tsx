import { useSyncExternalStore, type ReactNode } from "react";
import {
  editRings,
  flattenNodes,
  mapToPath,
  makeIdGen,
  objectBox,
  satinOutline,
  transformObject,
  type Box,
  type DesignObject,
  type Pt,
} from "@lilo/engine/light";
import { useEditorSelector } from "../state/store";
import { selectionBox } from "../state/editorStore";
import { formatLength } from "../state/units";
import type { CanvasController, Draft } from "./controller";
import { boxFromDrag, handlePoint, HANDLE_NAMES, rotateHandlePoint } from "./geometry";
import type { View } from "./viewport";

const d = (pts: readonly Pt[], close: boolean): string => pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]} ${p[1]}`).join(" ") + (close ? " Z" : "");

/** The outlines of an object as SVG path data (shell + holes, satin edge, or the path). */
function outlineD(o: DesignObject): string {
  switch (o.kind) {
    case "fill":
      return [d(o.geometry.shell, true), ...o.geometry.holes.map((h) => d(h, true))].join(" ");
    case "satin":
      return d(satinOutline(o.geometry.strip), true);
    case "run":
      return d(o.geometry.path, o.geometry.closed);
  }
}

const HANDLE_PX = 9;
const ROTATE_OFFSET_PX = 26;

interface Props {
  controller: CanvasController;
  view: View;
}

/**
 * Everything drawn on top of the stitches: selection outlines and handles, reshape nodes, the shape
 * being drawn, measure/knife lines, markers, the angle dial and the map-to-path preview. Purely a
 * view of controller + store state; all pointer handling is in the controller.
 */
export function Overlay({ controller, view }: Props) {
  const model = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const s = useEditorSelector((st) => st);
  const { design, selectedIds, tool, mode, mapDraft } = s;
  const z = view.zoom;
  const px = (n: number) => n / z;
  const sel = design ? design.objects.filter((o) => selectedIds.includes(o.id)) : [];
  const preview = controller.previewAffine();
  const shown = preview ? sel.map((o) => transformObject(o, preview)) : sel;
  const box: Box | null = preview ? selectionBox({ ...design!, objects: shown }, selectedIds) : selectionBox(design, selectedIds);
  const stroke = { vectorEffect: "non-scaling-stroke" as const };
  const nodes: ReactNode[] = [];

  // ---- selection ----------------------------------------------------------------------------
  const outlines = shown.map((o) => <path key={`sel-${o.id}`} className={o.kind === "run" ? "ov-outline open" : "ov-outline"} d={outlineD(o)} {...stroke} />);

  const showHandles = tool === "select" && mode === "none" && box && sel.length > 0;
  const locked = sel.length > 0 && sel.every((o) => o.locked);
  if (showHandles && box) {
    nodes.push(<rect key="box" className="ov-box" x={box.minX} y={box.minY} width={box.maxX - box.minX} height={box.maxY - box.minY} {...stroke} />);
    if (!locked) {
      const rp = rotateHandlePoint(box, px(ROTATE_OFFSET_PX));
      const top = handlePoint(box, "n");
      nodes.push(<line key="rotline" className="ov-box" x1={top[0]} y1={top[1]} x2={rp[0]} y2={rp[1]} {...stroke} />);
      nodes.push(<circle key="rot" className="ov-handle" cx={rp[0]} cy={rp[1]} r={px(HANDLE_PX / 2 + 1)} {...stroke} />);
      for (const h of HANDLE_NAMES) {
        const p = handlePoint(box, h);
        const sz = px(HANDLE_PX);
        nodes.push(<rect key={h} className="ov-handle" x={p[0] - sz / 2} y={p[1] - sz / 2} width={sz} height={sz} {...stroke} />);
      }
    }
  }

  // ---- reshape nodes ------------------------------------------------------------------------
  if (mode === "reshape" && sel.length === 1) {
    const o = sel[0];
    const rings = editRings(o);
    rings.forEach((ring, ri) => {
      const drag = model.drag;
      const live = drag && drag.kind === "node" && drag.id === o.id && drag.ring === ri ? drag.nodes : ring.nodes;
      const line = ring.structural ? flattenNodes(live, ring.closed) : live.map((n) => n.p);
      nodes.push(<path key={`rs-${ri}`} className="ov-outline strong" d={d(line, ring.closed)} {...stroke} />);
      live.forEach((n, k) => {
        const isSel = model.nodeSel?.ring === ri && model.nodeSel.index === k;
        const sz = px(HANDLE_PX);
        nodes.push(
          n.curve ? (
            <circle key={`n-${ri}-${k}`} className={`ov-node curve${isSel ? " sel" : ""}`} cx={n.p[0]} cy={n.p[1]} r={sz / 2} {...stroke} />
          ) : (
            <rect key={`n-${ri}-${k}`} className={`ov-node${isSel ? " sel" : ""}`} x={n.p[0] - sz / 2} y={n.p[1] - sz / 2} width={sz} height={sz} {...stroke} />
          ),
        );
      });
    });
  }

  // ---- start / end markers and the pattern centre -------------------------------------------
  if (sel.length === 1) {
    const o = sel[0];
    const drag = model.drag;
    const at = (which: "start" | "end" | "center", def: Pt | undefined): Pt | undefined => (drag && drag.kind === "marker" && drag.id === o.id && drag.which === which ? drag.at : def);
    const st = at("start", o.startPoint);
    const en = at("end", o.endPoint);
    const r = px(6);
    if (st) nodes.push(<path key="start" className="ov-start" d={`M${st[0] - r} ${st[1] - r} L${st[0] + r} ${st[1]} L${st[0] - r} ${st[1] + r} Z`} {...stroke} />);
    if (en) nodes.push(<rect key="end" className="ov-end" x={en[0] - r} y={en[1] - r} width={r * 2} height={r * 2} {...stroke} />);
    const c = o.kind === "fill" ? controllerCentre(controller, o, drag) : null;
    if (c) {
      nodes.push(<path key="centre" className="ov-centre" d={`M${c[0] - r * 1.4} ${c[1]} L${c[0] + r * 1.4} ${c[1]} M${c[0]} ${c[1] - r * 1.4} L${c[0]} ${c[1] + r * 1.4}`} {...stroke} />);
      nodes.push(<circle key="centre-o" className="ov-centre" cx={c[0]} cy={c[1]} r={r * 0.8} fill="none" {...stroke} />);
    }
    if (o.kind === "fill" && o.params.guides) {
      o.params.guides.forEach((g, i) => nodes.push(<path key={`guide-${i}`} className="ov-guide" d={d(g, false)} {...stroke} />));
    }
  }

  // ---- angle dial ---------------------------------------------------------------------------
  if (mode === "angle") {
    const o = sel.find((x) => x.kind === "fill");
    const c = controller.dialCentre();
    const b = o ? objectBox(o) : null;
    if (o && o.kind === "fill" && c && b) {
      const R = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2 + px(28);
      const a = (o.params.angleDeg * Math.PI) / 180;
      const hx = c[0] + R * Math.cos(a);
      const hy = c[1] + R * Math.sin(a);
      nodes.push(<circle key="dial" className="ov-dial" cx={c[0]} cy={c[1]} r={R} {...stroke} />);
      for (let k = 0; k < 24; k++) {
        const t = (k / 24) * Math.PI * 2;
        const len = k % 6 === 0 ? px(9) : px(5);
        nodes.push(<line key={`tick-${k}`} className="ov-dial" x1={c[0] + (R - len) * Math.cos(t)} y1={c[1] + (R - len) * Math.sin(t)} x2={c[0] + R * Math.cos(t)} y2={c[1] + R * Math.sin(t)} {...stroke} />);
      }
      // stitch rows drawn through the centre
      nodes.push(<line key="dial-axis" className="ov-dial strong" x1={c[0] - (hx - c[0])} y1={c[1] - (hy - c[1])} x2={hx} y2={hy} {...stroke} />);
      nodes.push(<circle key="dial-h" className="ov-handle" cx={hx} cy={hy} r={px(7)} {...stroke} />);
      nodes.push(
        <text key="dial-t" className="ov-label" x={c[0]} y={c[1] - R - px(8)} fontSize={px(12)} textAnchor="middle">
          {`${Math.round(o.params.angleDeg * 10) / 10}°`}
        </text>,
      );
    }
  }

  // ---- draft, drags --------------------------------------------------------------------------
  const draft: Draft | null = model.draft;
  if (draft) nodes.push(<DraftView key="draft" draft={draft} cursor={model.cursor} zoom={z} />);

  const drag = model.drag;
  if (drag?.kind === "marquee") {
    const b = boxFromDrag(drag.a, drag.b, false);
    nodes.push(<rect key="marq" className="ov-marquee" x={b.minX} y={b.minY} width={b.maxX - b.minX} height={b.maxY - b.minY} {...stroke} />);
  }
  if (drag?.kind === "shapeBox") {
    const b = boxFromDrag(drag.a, drag.b, drag.square);
    nodes.push(
      drag.shape === "rect" ? (
        <rect key="sb" className="ov-draft" x={b.minX} y={b.minY} width={b.maxX - b.minX} height={b.maxY - b.minY} {...stroke} />
      ) : (
        <ellipse key="sb" className="ov-draft" cx={(b.minX + b.maxX) / 2} cy={(b.minY + b.maxY) / 2} rx={(b.maxX - b.minX) / 2} ry={(b.maxY - b.minY) / 2} {...stroke} />
      ),
    );
    nodes.push(<SizeLabel key="sbl" at={[b.maxX, b.maxY]} text={`${(b.maxX - b.minX).toFixed(1)} × ${(b.maxY - b.minY).toFixed(1)} mm`} zoom={z} />);
  }
  if (drag?.kind === "pen") nodes.push(<path key="pen" className="ov-draft" d={d(drag.pts, false)} {...stroke} />);
  if (drag?.kind === "knife") nodes.push(<line key="knife" className="ov-knife" x1={drag.a[0]} y1={drag.a[1]} x2={drag.b[0]} y2={drag.b[1]} {...stroke} />);
  const m = drag?.kind === "measure" ? { a: drag.a, b: drag.b } : model.measure;
  if (m) nodes.push(<MeasureView key="measure" a={m.a} b={m.b} zoom={z} units={s.units} />);

  // ---- map to path preview ------------------------------------------------------------------
  if (mapDraft && design) {
    const sources = design.objects.filter((o) => mapDraft.sourceIds.includes(o.id));
    const group = mapDraft.groupId ? design.mapGroups?.[mapDraft.groupId] : null;
    const path = mapDraft.path ?? group?.path ?? null;
    const srcs = group ? group.sources : sources;
    if (path && path.length >= 2 && srcs.length) {
      const copies = mapToPath(srcs, path, false, mapDraft.options, makeIdGen(design));
      nodes.push(<path key="mp-path" className="ov-guide" d={d(path, false)} {...stroke} />);
      copies.forEach((c, i) => nodes.push(<path key={`mp-${i}`} className="ov-ghost" d={outlineD(c)} {...stroke} />));
    }
  }

  return (
    <svg className="tool-overlay" aria-hidden="true" data-testid="tool-overlay">
      <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
        {outlines}
        {nodes}
      </g>
    </svg>
  );
}

function controllerCentre(c: CanvasController, o: DesignObject, drag: ReturnType<CanvasController["getSnapshot"]>["drag"]): Pt | null {
  if (drag && drag.kind === "marker" && drag.id === o.id && drag.which === "center") return drag.at;
  return c.patternCentre(o);
}

function SizeLabel({ at, text, zoom }: { at: Pt; text: string; zoom: number }) {
  return (
    <text className="ov-label" x={at[0] + 6 / zoom} y={at[1] + 16 / zoom} fontSize={12 / zoom}>
      {text}
    </text>
  );
}

function MeasureView({ a, b, zoom, units }: { a: Pt; b: Pt; zoom: number; units: "mm" | "in" }) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const r = 4 / zoom;
  return (
    <g>
      <line className="ov-measure" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} vectorEffect="non-scaling-stroke" />
      <circle className="ov-measure-dot" cx={a[0]} cy={a[1]} r={r} vectorEffect="non-scaling-stroke" />
      <circle className="ov-measure-dot" cx={b[0]} cy={b[1]} r={r} vectorEffect="non-scaling-stroke" />
      <text className="ov-label measure" x={mid[0]} y={mid[1] - 8 / zoom} fontSize={13 / zoom} textAnchor="middle" data-testid="measure-label">
        {formatLength(len, units)}
      </text>
      <text className="ov-label" x={mid[0]} y={mid[1] + 14 / zoom} fontSize={11 / zoom} textAnchor="middle">
        {`Δx ${formatLength(Math.abs(b[0] - a[0]), units)}, Δy ${formatLength(Math.abs(b[1] - a[1]), units)}`}
      </text>
    </g>
  );
}

function DraftView({ draft, cursor, zoom }: { draft: Draft; cursor: Pt | null; zoom: number }) {
  const pts = draft.kind === "path" ? flattenNodes(draft.nodes, false) : draft.nodes.map((n) => n.p);
  const tail: Pt[] = cursor && pts.length ? [pts[pts.length - 1], cursor] : [];
  const r = 4 / zoom;
  const kind = draft.kind;
  return (
    <g>
      {kind === "satin" ? (
        <>
          {draft.nodes.map((n, i) => (i % 2 === 1 ? <line key={`r${i}`} className="ov-draft" x1={draft.nodes[i - 1].p[0]} y1={draft.nodes[i - 1].p[1]} x2={n.p[0]} y2={n.p[1]} vectorEffect="non-scaling-stroke" /> : null))}
          <path className="ov-draft thin" d={d(draft.nodes.filter((_, i) => i % 2 === 0).map((n) => n.p), false)} vectorEffect="non-scaling-stroke" />
          <path className="ov-draft thin" d={d(draft.nodes.filter((_, i) => i % 2 === 1).map((n) => n.p), false)} vectorEffect="non-scaling-stroke" />
        </>
      ) : (
        pts.length > 1 && <path className="ov-draft" d={d(pts, false)} vectorEffect="non-scaling-stroke" />
      )}
      {tail.length === 2 && <path className="ov-draft dashed" d={d(tail, false)} vectorEffect="non-scaling-stroke" />}
      {draft.closed && pts.length >= 3 && cursor && <path className="ov-draft dashed faint" d={d([pts[pts.length - 1], pts[0]], false)} vectorEffect="non-scaling-stroke" />}
      {draft.nodes.map((n, i) =>
        n.curve ? (
          <circle key={i} className={`ov-node curve${i === 0 && draft.closed ? " sel" : ""}`} cx={n.p[0]} cy={n.p[1]} r={r} vectorEffect="non-scaling-stroke" />
        ) : (
          <rect key={i} className={`ov-node${i === 0 && draft.closed ? " sel" : ""}`} x={n.p[0] - r} y={n.p[1] - r} width={r * 2} height={r * 2} vectorEffect="non-scaling-stroke" />
        ),
      )}
    </g>
  );
}
