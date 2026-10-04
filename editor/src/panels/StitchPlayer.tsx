import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { PlanResult } from "../engine/client";
import { MAX_SPEED, MIN_SPEED, formatDuration, type PlayerController } from "../state/player";
import { Hint } from "../guide/Hint";
import { markPlayed } from "../guide/guideStore";
import { useEditor } from "../state/store";

/** The thread name as it appears on the spool: "Brother 513 — Blue". */
export function threadLabel(t: { brand: string; code: string; name: string }): string {
  return `${t.brand} ${t.code} — ${t.name}`;
}

/** Bottom bar above the toolbar: play/pause, scrubber, speed, colour-change card and totals. */
export function StitchPlayer() {
  const { state, player } = useEditor();
  return <StitchPlayerBar player={player} planResult={state.planResult} emptyText="Stitch player: digitize an image to preview it stitch by stitch." />;
}

/** The player for any plan and any `PlayerController` (the editor's, or the pixel-art preview's). */
export function StitchPlayerBar({ player, planResult, emptyText }: { player: PlayerController; planResult: PlanResult | null; emptyText: string }) {
  const snap = useSyncExternalStore(player.subscribe, player.snapshot);
  const plan = planResult?.plan ?? null;
  const total = plan?.stitches.length ?? 0;
  // cumulative[i] = needle drops among the first i entries (jumps and colour changes don't count)
  const cumulative = useMemo(() => {
    const c = new Uint32Array(total + 1);
    plan?.stitches.forEach((s, i) => (c[i + 1] = c[i] + (s.type === "stitch" ? 1 : 0)));
    return c;
  }, [plan, total]);

  // playing the stitches ticks the workflow strip
  useEffect(() => {
    if (snap.playing) markPlayed();
  }, [snap.playing]);

  // Drive the controller from the display clock while it has work to do.
  const active = snap.playing || (snap.stop !== null && snap.autoContinue);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      player.tick(Math.max(0, Math.min(0.1, (now - last) / 1000))); // never negative: a frame stamp can predate `last` // clamp so a background tab doesn't leap ahead
      last = now;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active, player]);

  if (!plan || !planResult || total === 0) {
    return (
      <div className="player player-empty" role="group" aria-label="Stitch player">
        <span className="muted">{emptyText}</span>
      </div>
    );
  }

  const { stats } = planResult;
  const stopThread = snap.stop ? plan.threads[snap.stop.threadIndex] : null;
  const shown = Math.max(0, Math.min(total, Math.floor(snap.index)));

  return (
    <div className="player" role="group" aria-label="Stitch player">
      {snap.stop && stopThread && (
        <div className="swap-card" role="alertdialog" aria-label="Colour change">
          <span className="swatch large" style={{ background: stopThread.hex }} aria-hidden="true" />
          <div className="swap-text">
            <strong>Swap to {threadLabel(stopThread)}</strong>
            <span className="muted small">Colour change {snap.stop.threadIndex} of {stats.colorChanges}</span>
          </div>
          <label className="check">
            <input type="checkbox" checked={snap.autoContinue} onChange={(e) => player.setAutoContinue(e.target.checked)} /> Auto-continue
          </label>
          <button className="primary" onClick={() => player.continue()} autoFocus>
            Continue
          </button>
        </div>
      )}
      <div className="player-controls">
        <button onClick={() => player.toggle()} aria-label={snap.playing ? "Pause" : "Play"} className="play" data-tour="player-play">
          {snap.playing ? "❚❚" : "▶"}
        </button>
        <Hint id="player.play" />
        <input
          className="scrub"
          type="range"
          min={0}
          max={total}
          step={1}
          value={shown}
          aria-label="Scrub stitches"
          onChange={(e) => player.seek(Number(e.target.value))}
        />
        <Hint id="player.scrub" />
        <label className="speed">
          Speed
          <input
            type="range"
            min={MIN_SPEED}
            max={MAX_SPEED}
            step={1}
            value={snap.speed}
            aria-label="Playback speed"
            onChange={(e) => player.setSpeed(Number(e.target.value))}
          />
          <output>{snap.speed}×</output>
          <Hint id="player.speed" />
        </label>
        <label className="check">
          <input type="checkbox" checked={snap.autoContinue} onChange={(e) => player.setAutoContinue(e.target.checked)} /> Auto-continue
        </label>
        <Hint id="player.auto-continue" />
      </div>
      <div className="player-stats" aria-label="Design totals" data-tour="player-totals">
        <span>
          <strong>{cumulative[shown].toLocaleString()}</strong> / {stats.stitchCount.toLocaleString()} stitches
        </span>
        <span>
          <strong>{stats.colorChanges}</strong> colour change{stats.colorChanges === 1 ? "" : "s"}
        </span>
        <span>
          {stats.widthMm.toFixed(1)} × {stats.heightMm.toFixed(1)} mm
        </span>
        <span title="at 850 stitches a minute, with stops to swap and cut thread">≈ {formatDuration(stats.estimatedSeconds)}</span>
        <Hint id="player.totals" />
      </div>
    </div>
  );
}
