import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DEFAULT_HOOP, designBounds } from "@lilo/engine/light";
import { useStore } from "zustand";
import { useHoop } from "../hoops/autoPick";
import { currentScale, loadScreen } from "../hoops/CalibrationDialog";
import { ACTUAL_SIZE_EVENT } from "../panels/DesignSection";
import { APPEARANCE_EVENT } from "../shell/useAppearance";
import { hoopViewStore, setHoopView } from "../state/hoopViewStore";
import { shouldAskCalibration } from "./actualSize";
import { GuidesLayer, Rulers } from "./HoopOverlays";
import { SAFE_MARGIN_MM } from "../hoops/autoPick";
import { useEditor } from "../state/store";
import { CanvasController, type PointerInput } from "./controller";
import { MapDialog } from "./MapDialog";
import { stackLayout } from "./layerStack";
import { Overlay } from "./Overlay";
import type { Scene, Placement } from "./scene";
import { ShapeBar } from "./ShapeBar";
import { readTheme } from "./theme";
import { buildTimeline, phaseAt, prefersReducedMotion, type AnimPhase, type Timeline } from "./timeline";
import { TraceOutlines } from "./TraceOutlines";
import { Hint } from "../guide/Hint";
import { markPreviewed } from "../guide/guideStore";
import { useShortcuts } from "./useShortcuts";
import { classifyWheel, fitRect, fitView, wheelZoomFactor, zoomAt, panBy, type View } from "./viewport";

const STAGE_LABEL: Record<AnimPhase, string> = {
  quantize: "Matching thread colours",
  trace: "Tracing outlines",
  stitch: "Laying stitches",
  done: "",
};

const FALLBACK_VIEW: View = { x: 0, y: 0, zoom: 6 };

/** Heavier thread in the realistic view for the stitch types that are sewn thicker. */
const RUN_WIDTH_SCALE = { single: 1, triple: 1.5, satin: 1.15, estitch: 1.05, doublerope: 1.25, triplerope: 1.4, manual: 1 } as const;

/** Where an image of `w` x `h` source pixels sits in design space. */
function placementOf(
  p: { imageToMm: { scale: number; cx: number; cy: number }; origin: [number, number] },
): Placement {
  return { scale: p.imageToMm.scale, x: (p.origin[0] - p.imageToMm.cx) * p.imageToMm.scale, y: (p.origin[1] - p.imageToMm.cy) * p.imageToMm.scale };
}

/** One-line hint for what the current tool does next. */
function hintFor(tool: string, mode: string, drafting: boolean): string | null {
  if (mode === "knife") return "Drag a line across the shape to slice it. Esc to cancel.";
  if (mode === "hole") return "Click to outline the hole, Enter to cut. Esc to cancel.";
  if (mode === "setStart") return "Click where sewing should start.";
  if (mode === "setEnd") return "Click where sewing should end.";
  if (mode === "angle") return "Drag around the shape to turn the stitch angle. Ctrl snaps to 15°.";
  if (mode === "pickPath") return "Click points for the path, Enter to finish.";
  if (mode === "guide") return "Click points for the guide curve, Enter to finish.";
  if (mode === "reshape") return "Drag points. Click an edge to add one, Backspace deletes, double-click toggles curve.";
  if (drafting) return "Click to add a point · right-click or double-click for a curve · Enter to finish · Esc to cancel";
  switch (tool) {
    case "open":
    case "closed":
      return "Click to start. Right-click or double-click makes a curve point.";
    case "circle":
      return "Drag to draw. Hold Ctrl for a perfect circle.";
    case "rect":
      return "Drag to draw. Hold Ctrl for a square.";
    case "pen":
      return "Drag to draw freehand.";
    case "satin":
      return "Click the left edge, then the right edge, and repeat. Enter to finish.";
    case "manual":
      return "Click to place each stitch. Enter to finish.";
    case "text":
      return "Click where the text should go, then type it in the panel. Click a word to edit it.";
    case "measure":
      return "Drag to measure.";
    case "clickstitch":
      return "Click a region to stitch it · Shift-click to collect several, Enter to stitch them · Esc to leave";
    default:
      return null;
  }
}

/**
 * The PixiJS canvas: grid, hoop, reference images, stitches, selection and needle, plus the pan/zoom
 * controls and the tracing animation. WebGL is created lazily so tests and non-GL environments
 * fall back to a message instead of crashing. Pointer input goes to a `CanvasController`; the SVG
 * `Overlay` draws handles and drafts on top.
 */
export function CanvasView({ onOpen }: { onOpen: () => void }) {
  const { state, actions, player, api } = useEditor();
  const hostRef = useRef<HTMLDivElement>(null);
  const svgGroupRef = useRef<SVGGElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const viewRef = useRef<View>(FALLBACK_VIEW);
  const [view, setViewState] = useState<View>(FALLBACK_VIEW);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [ready, setReady] = useState(false);
  const [glError, setGlError] = useState<string | null>(null);
  const hoopLook = {
    frame: useStore(hoopViewStore, (s) => s.showFrame),
    safeArea: useStore(hoopViewStore, (s) => s.showSafeArea),
  };
  const hoopNow = useHoop();
  const [zoomPct, setZoomPct] = useState(100);
  const [dragOver, setDragOver] = useState(false);
  const [anim, setAnim] = useState<{ key: number; timeline: Timeline; phase: AnimPhase } | null>(null);

  // ---- scene lifecycle ------------------------------------------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let scene: Scene | null = null;
    (async () => {
      try {
        if (/jsdom/i.test(navigator.userAgent)) throw new Error("test environment");
        const { Scene } = await import("./scene");
        const s = await Scene.create(host, readTheme());
        if (cancelled) {
          s.destroy();
          return;
        }
        scene = s;
        sceneRef.current = s;
        s.setView(viewRef.current);
        setReady(true);
      } catch (e) {
        if (!cancelled) setGlError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      sceneRef.current = null;
      setReady(false);
      scene?.destroy();
    };
  }, []);

  const applyView = useCallback((v: View) => {
    viewRef.current = v;
    sceneRef.current?.setView(v);
    svgGroupRef.current?.setAttribute("transform", `translate(${v.x} ${v.y}) scale(${v.zoom})`);
    setZoomPct(Math.round((v.zoom / 6) * 100));
    setViewState(v);
  }, []);

  // track the stage size for the floating shape bar
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setSize({ w: host.clientWidth, h: host.clientHeight }));
    ro.observe(host);
    setSize({ w: host.clientWidth, h: host.clientHeight });
    return () => ro.disconnect();
  }, []);

  const design = state.design;
  const hasObjects = (design?.objects.length ?? 0) > 0;

  const fit = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const b = state.design && state.design.objects.length ? designBounds(state.design) : null;
    const rect = fitRect(b, state.design?.hoop, DEFAULT_HOOP);
    applyView(fitView(host.clientWidth, host.clientHeight, rect, 0.2));
  }, [applyView, state.design]);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  // the command palette asks for a fit by event (see shell/EditorShell.tsx)
  useEffect(() => {
    const on = () => fitRef.current();
    window.addEventListener("lilo:fit", on);
    return () => window.removeEventListener("lilo:fit", on);
  }, []);

  // Fit when the scene first appears and whenever a fresh result lands.
  useEffect(() => {
    if (ready) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, state.animationKey]);

  // ---- tools ----------------------------------------------------------------------------------
  const controller = useMemo(
    () =>
      new CanvasController({
        api,
        actions,
        getView: () => viewRef.current,
        setView: applyView,
        fit: () => fitRef.current(),
      }),
    [api, actions, applyView],
  );
  useShortcuts(controller);
  const model = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => controller.reset(), [controller, state.tool, state.mode]);
  useEffect(() => {
    // a changed selection ends reshape point selection; tool-specific gestures are left alone
    controller.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, state.selectedIds.join(",")]);

  // ---- theme ----------------------------------------------------------------------------------
  useEffect(() => {
    if (!ready) return;
    const on = () => sceneRef.current?.setTheme(readTheme());
    // the app's own light/dark choice (shell/useAppearance) fires an event; the system one a media query
    window.addEventListener(APPEARANCE_EVENT, on);
    if (typeof window.matchMedia !== "function") return () => window.removeEventListener(APPEARANCE_EVENT, on);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", on);
    return () => {
      window.removeEventListener(APPEARANCE_EVENT, on);
      mq.removeEventListener("change", on);
    };
  }, [ready]);

  // ---- scene <- state ------------------------------------------------------------------------
  const plan = state.planResult?.plan ?? null;
  const { realistic, jumps, grid, reference } = state.view;

  useEffect(() => {
    sceneRef.current?.setHoop(hoopNow);
  }, [ready, hoopNow]);

  useEffect(() => {
    sceneRef.current?.setHoopOptions({ frame: hoopLook.frame, safeArea: hoopLook.safeArea, safeMarginMm: SAFE_MARGIN_MM });
  }, [ready, hoopLook.frame, hoopLook.safeArea]);

  useEffect(() => {
    sceneRef.current?.setGridVisible(grid);
  }, [ready, grid]);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const src = state.source;
    // Until the first result lands, show the image where the engine will most likely put it.
    const pl =
      state.placement ??
      (src && src.width > 0 ? { imageToMm: { scale: 60 / Math.max(src.width, src.height), cx: src.width / 2, cy: src.height / 2 }, origin: [0, 0] as [number, number], width: src.width, height: src.height } : null);
    if (src?.reference && pl && reference) {
      s.setReference(src.reference, placementOf(pl), pl.width, pl.height);
      s.setReferenceAlpha(plan ? 0.3 : 0.7);
    } else {
      s.setReference(null, null, 0, 0);
    }
  }, [ready, state.source, state.placement, reference, plan]);

  // images the user placed behind the shapes
  // stitch bands and the pictures between them, in layer order (a picture layer above a stitch layer draws over it)
  const layout = useMemo(() => stackLayout(design, plan), [design, plan]);
  const splitsKey = layout.splits.join(",");
  useEffect(() => {
    sceneRef.current?.setRefImages(
      reference
        ? state.refImages
            .filter((r) => r.visible && r.layerVisible)
            .map((r) => ({
              src: r.src,
              x: r.x,
              y: r.y,
              widthMm: r.widthMm,
              heightMm: (r.widthMm * r.h) / Math.max(1, r.w),
              alpha: r.opacity * r.layerOpacity,
              band: r.layerId ? (layout.pictureBand[r.layerId] ?? 0) : 0,
            }))
        : [],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, state.refImages, reference, splitsKey, layout.pictureBand]);

  // thread thickness per object, so the realistic view shows triple, rope and satin as heavier thread
  const widthScale = useMemo(
    () =>
      (design?.objects ?? []).map((o) => {
        if (o.kind === "satin") return RUN_WIDTH_SCALE.satin;
        if (o.kind === "run") return RUN_WIDTH_SCALE[o.params.type ?? (o.params.repeats === 3 ? "triple" : "single")];
        return 1;
      }),
    [design?.objects],
  );

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.setPlan(plan, { realistic, jumps, widthScale }, layout.splits);
    s.setProgress(player.snapshot().index, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, plan, realistic, jumps, widthScale, player, splitsKey]);

  // Player -> scene (imperative: this runs at 60 fps and must not re-render React).
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const sync = () => {
      const p = player.snapshot();
      s.setProgress(p.index, p.playing || p.stop !== null || p.index < player.length);
    };
    sync();
    return player.subscribe(sync);
  }, [ready, player]);

  // ---- live preview while the pipeline runs --------------------------------------------------
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const q = state.stages.quantized;
    if (state.status.kind === "working" && q && state.source) {
      const t = state.stages.imageToMm ?? { scale: 60 / Math.max(q.width, q.height), cx: q.width / 2, cy: q.height / 2 };
      s.setQuantized(q, placementOf({ imageToMm: t, origin: [0, 0] }));
      s.setQuantizedAlpha(1);
    } else if (!anim) {
      s.setQuantizedAlpha(0);
    }
  }, [ready, state.stages.quantized, state.stages.imageToMm, state.status.kind, state.source, anim]);

  // ---- tracing animation ---------------------------------------------------------------------
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || state.animationKey === 0 || !state.design) return;
    const reduced = prefersReducedMotion();
    const timeline = buildTimeline(state.design.threads.length, reduced);
    if (reduced || timeline.total === 0) {
      s.setQuantizedAlpha(0);
      s.setStitchAlpha(1);
      setAnim(null);
      return;
    }
    const q = state.stages.quantized;
    const pl = state.placement;
    if (q && pl) {
      s.setQuantized(q, placementOf(pl));
      s.setQuantizedAlpha(1);
    }
    s.setStitchAlpha(0);
    setAnim({ key: state.animationKey, timeline, phase: "quantize" });
    const t0 = performance.now();
    let raf = 0;
    const frame = () => {
      const t = (performance.now() - t0) / 1000;
      const phase = phaseAt(timeline, t);
      setAnim((a) => (a && a.phase !== phase ? { ...a, phase } : a));
      // quantised image fades out as the outlines draw
      s.setQuantizedAlpha(t < timeline.quantizeEnd ? 1 : Math.max(0, 1 - (t - timeline.quantizeEnd) / (timeline.traceEnd - timeline.quantizeEnd)) * 0.55);
      s.setStitchAlpha(t < timeline.stitchStart ? 0 : Math.min(1, (t - timeline.stitchStart) / (timeline.stitchEnd - timeline.stitchStart)));
      if (phase === "done") {
        s.setQuantizedAlpha(0);
        s.setStitchAlpha(1);
        setAnim(null);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      s.setStitchAlpha(1);
      s.setQuantizedAlpha(0);
    };
    // The animation belongs to a result, not to every later edit of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.animationKey, ready]);

  const skip = () => setAnim(null);

  // ---- actual size ---------------------------------------------------------------------------
  useEffect(() => void loadScreen(), []);
  const actualSize = useCallback(async () => {
    const host = hostRef.current;
    if (!host) return;
    const scale = await currentScale();
    if (shouldAskCalibration(scale, hoopViewStore.getState().calibrationAsked)) setHoopView({ calibrationOpen: true });
    const v = viewRef.current;
    applyView(zoomAt(v, host.clientWidth / 2, host.clientHeight / 2, scale.pxPerMm / v.zoom));
  }, [applyView]);
  const actualRef = useRef(actualSize);
  actualRef.current = actualSize;
  useEffect(() => {
    const on = () => void actualRef.current();
    window.addEventListener(ACTUAL_SIZE_EVENT, on);
    return () => window.removeEventListener(ACTUAL_SIZE_EVENT, on);
  }, []);

  // ---- zoom ----------------------------------------------------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = host.getBoundingClientRect();
      if (classifyWheel(e) === "zoom") {
        applyView(zoomAt(viewRef.current, e.clientX - rect.left, e.clientY - rect.top, wheelZoomFactor(e)));
      } else {
        applyView(panBy(viewRef.current, -e.deltaX, -e.deltaY));
      }
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, [applyView]);

  // ---- pointer -> controller ------------------------------------------------------------------
  const input = (e: React.PointerEvent): PointerInput => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, detail: e.detail };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button > 2) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    controller.pointerDown(input(e));
  };
  const onPointerMove = (e: React.PointerEvent) => controller.pointerMove(input(e));
  const onPointerUp = (e: React.PointerEvent) => controller.pointerUp(input(e));

  const zoomBy = (f: number) => {
    const host = hostRef.current;
    if (host) applyView(zoomAt(viewRef.current, host.clientWidth / 2, host.clientHeight / 2, f));
  };

  // ---- drop / paste --------------------------------------------------------------------------
  const importFiles = async (files: FileList | File[] | null | undefined) => {
    const f = files && files[0];
    if (!f) return;
    await actions.importFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), type: f.type });
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      const file = [...(e.clipboardData?.files ?? [])][0];
      if (file) {
        e.preventDefault();
        void importFiles([file]);
        return;
      }
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (text && /^<\?xml|^<svg/i.test(text)) {
        e.preventDefault();
        void actions.importFile({ name: "pasted.svg", bytes: new TextEncoder().encode(text), type: "image/svg+xml" });
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions]);

  const working = state.status.kind === "working";
  const drawing = ["open", "closed", "circle", "rect", "pen", "satin", "manual", "text"].includes(state.tool);
  const empty = !hasObjects && !working && !drawing && !state.source;
  const phase = anim?.phase ?? "done";
  const hint = hintFor(state.tool, state.mode, model.draft !== null);
  const dragKind = model.drag?.kind;
  const cursor = dragKind === "pan" ? "grabbing" : model.spaceDown || state.tool === "pan" ? "grab" : state.tool === "clickstitch" ? (model.hoverRegion ? "pointer" : "crosshair") : drawing || state.tool === "measure" || state.mode === "knife" ? "crosshair" : "default";

  return (
    <div
      className={`canvas-stage${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void importFiles(e.dataTransfer.files);
      }}
    >
      <div
        ref={hostRef}
        className="canvas-host"
        data-testid="canvas-host"
        data-tool={state.tool}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      />
      <svg className="trace-overlay" aria-hidden="true">
        <g ref={svgGroupRef}>{anim && state.design && <TraceOutlines key={anim.key} design={state.design} timeline={anim.timeline} />}</g>
      </svg>
      <GuidesLayer view={view} width={size.w} height={size.h} units={state.units} />
      <Overlay controller={controller} view={view} />
      <Rulers view={view} width={size.w} height={size.h} units={state.units} onToggleUnits={() => actions.setUnits(state.units === "mm" ? "in" : "mm")} />
      <ShapeBar controller={controller} view={view} width={size.w} height={size.h} />
      <MapDialog />

      {glError && (
        <p className="canvas-message error" role="alert">
          The canvas needs WebGL, which isn&apos;t available here ({glError}).
        </p>
      )}
      {empty && !glError && (
        <div className="canvas-empty">
          <p className="canvas-empty-title">Drop an image to auto-digitize</p>
          <p className="muted">PNG, JPG, WEBP or SVG. Or pick a drawing tool below and sketch a shape.</p>
          <button className="primary" onClick={onOpen}>
            Open image…
          </button>
        </div>
      )}

      {hint && (
        <div className="canvas-hint" role="note">
          {hint}
        </div>
      )}

      <div className="canvas-status" role="status" aria-live="polite">
        {working && (
          <span className="status-pill">
            <span className="spinner" aria-hidden="true" />
            {state.status.kind === "working" ? state.status.stage : ""}…
          </span>
        )}
        {anim && (
          <span className="status-pill">
            {STAGE_LABEL[phase]}
            <button className="link-button" onClick={skip}>
              Skip
            </button>
          </span>
        )}
        {state.status.kind === "error" && <span className="status-pill error">{state.status.message}</span>}
        {state.planning && !working && !anim && hasObjects && <span className="status-pill subtle">Stitching…</span>}
      </div>

      <div className="canvas-hud">
        <div className="hud-group" role="group" aria-label="View options">
          <label>
            <input type="checkbox" checked={realistic} onChange={(e) => (actions.setView({ realistic: e.target.checked }), markPreviewed())} /> Realistic <Hint id="view.realistic" />
          </label>
          <label>
            <input type="checkbox" checked={grid} onChange={(e) => actions.setView({ grid: e.target.checked })} /> Grid <Hint id="view.grid" />
          </label>
          <label>
            <input type="checkbox" checked={reference} onChange={(e) => actions.setView({ reference: e.target.checked })} /> Reference <Hint id="view.reference" />
          </label>
          <label>
            <input type="checkbox" checked={jumps} onChange={(e) => actions.setView({ jumps: e.target.checked })} /> Jumps <Hint id="view.jumps" />
          </label>
        </div>
        <div className="hud-group" role="group" aria-label="Zoom">
          <button onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
            −
          </button>
          <span className="zoom-pct">{zoomPct}%</span>
          <button onClick={() => zoomBy(1.25)} aria-label="Zoom in">
            +
          </button>
          <button onClick={fit}>Fit</button>
          <button onClick={() => void actualSize()} title="Show the design at its real size on this screen (⌘0)" aria-label="Actual size">
            1:1
          </button>
        </div>
      </div>
    </div>
  );
}
