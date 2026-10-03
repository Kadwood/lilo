import { useEffect, useRef, useState } from "react";
import type { StitchPlan } from "@lilo/engine";
import { readTheme } from "../canvas/theme";
import { fitView, type View } from "../canvas/viewport";
import type { Scene } from "../canvas/scene";
import type { PlayerController } from "../state/player";

/**
 * A small read-only view of a stitch plan (thread shading, playback from a `PlayerController`), for
 * screens that show stitches without being the editor: the pixel-art preview. Same renderer as the
 * editor canvas; WebGL is created lazily so tests fall back to a message.
 */
export function PlanPreview({ plan, player, label }: { plan: StitchPlan | null; player: PlayerController; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    let scene: Scene | null = null;
    (async () => {
      try {
        if (/jsdom/i.test(navigator.userAgent)) throw new Error("test environment");
        const { Scene } = await import("../canvas/scene");
        const s = await Scene.create(el, readTheme());
        if (cancelled) {
          s.destroy();
          return;
        }
        scene = s;
        sceneRef.current = s;
        s.setGridVisible(false);
        setReady(true);
      } catch (e) {
        if (!cancelled) setProblem(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      sceneRef.current = null;
      setReady(false);
      scene?.destroy();
    };
  }, []);

  // the plan, fitted to the box
  useEffect(() => {
    const s = sceneRef.current;
    const el = host.current;
    if (!s || !el) return;
    s.setPlan(plan, { realistic: true, jumps: false });
    s.setProgress(player.snapshot().index, false);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const st of plan?.stitches ?? []) {
      if (st.type === "colorChange") continue;
      minX = Math.min(minX, st.x);
      minY = Math.min(minY, st.y);
      maxX = Math.max(maxX, st.x);
      maxY = Math.max(maxY, st.y);
    }
    const rect = Number.isFinite(minX) ? { minX, minY, maxX, maxY } : { minX: -20, minY: -20, maxX: 20, maxY: 20 };
    const v: View = fitView(el.clientWidth || 400, el.clientHeight || 400, rect, 0.12);
    s.setView(v);
  }, [ready, plan, player]);

  // playback -> scene
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

  return (
    <div className="plan-preview" ref={host} role="img" aria-label={label}>
      {problem && <p className="canvas-message muted">The stitch preview needs WebGL, which isn&apos;t available here.</p>}
    </div>
  );
}
