import { useCallback, useEffect, useRef, useState } from "react";
import { designBounds } from "@lilo/engine/light";
import { useEditor } from "../state/store";
import type { Scene, Placement } from "./scene";
import { readTheme } from "./theme";
import { buildTimeline, phaseAt, prefersReducedMotion, type AnimPhase, type Timeline } from "./timeline";
import { TraceOutlines } from "./TraceOutlines";
import { classifyWheel, fitView, panBy, wheelZoomFactor, zoomAt, type View } from "./viewport";

const STAGE_LABEL: Record<AnimPhase, string> = {
  quantize: "Matching thread colours",
  trace: "Tracing outlines",
  stitch: "Laying stitches",
  done: "",
};

const FALLBACK_VIEW: View = { x: 0, y: 0, zoom: 6 };

/** Where an image of `w` x `h` source pixels sits in design space. */
function placementOf(
  p: { imageToMm: { scale: number; cx: number; cy: number }; origin: [number, number] },
): Placement {
  return { scale: p.imageToMm.scale, x: (p.origin[0] - p.imageToMm.cx) * p.imageToMm.scale, y: (p.origin[1] - p.imageToMm.cy) * p.imageToMm.scale };
}

/**
 * The PixiJS canvas: grid, hoop, reference image, stitches, selection and needle, plus the pan/zoom
 * controls and the tracing animation. WebGL is created lazily so tests and non-GL environments
 * fall back to a message instead of crashing.
 */
export function CanvasView({ onOpen }: { onOpen: () => void }) {
  const { state, actions, player } = useEditor();
  const hostRef = useRef<HTMLDivElement>(null);
  const svgGroupRef = useRef<SVGGElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const viewRef = useRef<View>(FALLBACK_VIEW);
  const [ready, setReady] = useState(false);
  const [glError, setGlError] = useState<string | null>(null);
  const [zoomPct, setZoomPct] = useState(100);
  const [dragOver, setDragOver] = useState(false);
  const [anim, setAnim] = useState<{ key: number; timeline: Timeline; phase: AnimPhase } | null>(null);
  const spaceDown = useRef(false);

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
  }, []);

  const fit = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const b = state.design ? designBounds(state.design) : null;
    const rect = b ?? { minX: -40, minY: -40, maxX: 40, maxY: 40 };
    applyView(fitView(host.clientWidth, host.clientHeight, rect, 0.2));
  }, [applyView, state.design]);

  // Fit when the scene first appears and whenever a fresh result lands.
  useEffect(() => {
    if (ready) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, state.animationKey]);

  // ---- theme ----------------------------------------------------------------------------------
  useEffect(() => {
    if (!ready || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => sceneRef.current?.setTheme(readTheme());
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [ready]);

  // ---- scene <- state ------------------------------------------------------------------------
  const design = state.design;
  const plan = state.planResult?.plan ?? null;
  const { realistic, jumps, grid, reference } = state.view;

  useEffect(() => {
    sceneRef.current?.setHoop(design?.hoop ?? null);
  }, [ready, design?.hoop]);

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

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.setPlan(plan, { realistic, jumps });
    s.setProgress(player.snapshot().index, false);
  }, [ready, plan, realistic, jumps, player]);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const o = design?.objects.find((x) => x.id === state.selectedId) ?? null;
    s.setHighlight(o);
  }, [ready, design, state.selectedId]);

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

  // ---- pan / zoom ----------------------------------------------------------------------------
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

  useEffect(() => {
    const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e.target)) {
        spaceDown.current = true;
        hostRef.current?.classList.add("grab");
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceDown.current = false;
        hostRef.current?.classList.remove("grab");
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const drag = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 0 || e.button === 1) {
      drag.current = { x: e.clientX, y: e.clientY };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      hostRef.current?.classList.add("panning");
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    applyView(panBy(viewRef.current, e.clientX - drag.current.x, e.clientY - drag.current.y));
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = () => {
    drag.current = null;
    hostRef.current?.classList.remove("panning");
  };

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
  const empty = !state.design && !working;
  const phase = anim?.phase ?? "done";

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
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={fit}
      />
      <svg className="trace-overlay" aria-hidden="true">
        <g ref={svgGroupRef}>{anim && state.design && <TraceOutlines key={anim.key} design={state.design} timeline={anim.timeline} />}</g>
      </svg>

      {glError && (
        <p className="canvas-message error" role="alert">
          The canvas needs WebGL, which isn&apos;t available here ({glError}).
        </p>
      )}
      {empty && !glError && (
        <div className="canvas-empty">
          <p className="canvas-empty-title">Drop an image to auto-digitize</p>
          <p className="muted">PNG, JPG, WEBP or SVG. You can also paste one.</p>
          <button className="primary" onClick={onOpen}>
            Open image…
          </button>
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
      </div>

      <div className="canvas-hud">
        <div className="hud-group" role="group" aria-label="View options">
          <label>
            <input type="checkbox" checked={realistic} onChange={(e) => actions.setView({ realistic: e.target.checked })} /> Realistic
          </label>
          <label>
            <input type="checkbox" checked={grid} onChange={(e) => actions.setView({ grid: e.target.checked })} /> Grid
          </label>
          <label>
            <input type="checkbox" checked={reference} onChange={(e) => actions.setView({ reference: e.target.checked })} /> Reference
          </label>
          <label>
            <input type="checkbox" checked={jumps} onChange={(e) => actions.setView({ jumps: e.target.checked })} /> Jumps
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
        </div>
      </div>

    </div>
  );
}
