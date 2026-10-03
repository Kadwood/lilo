import type { StitchPlan } from "@lilo/engine";

/** A real machine sews about 850 stitches a minute. */
export const MACHINE_SPM = 850;
export const BASE_STITCHES_PER_SEC = MACHINE_SPM / 60;
export const MIN_SPEED = 1;
export const MAX_SPEED = 50;
/** With "auto-continue" on, wait this long at each colour change. */
export const AUTO_CONTINUE_SECONDS = 0.8;

export interface ColourStop {
  /** Index of the `colorChange` entry in the plan. */
  entryIndex: number;
  /** Colour block to swap to. */
  threadIndex: number;
}

export interface PlayerSnapshot {
  /** Number of plan entries revealed, 0..plan length. */
  index: number;
  playing: boolean;
  speed: number;
  autoContinue: boolean;
  stop: ColourStop | null;
}

/**
 * Time-driven playback over a stitch plan. Plain TypeScript with no DOM so it can be unit tested:
 * the UI calls `tick(dt)` from requestAnimationFrame and re-renders from `snapshot()`.
 *
 * Playback pauses when it reaches a colour-change entry (`stop`) until `continue()` (or the
 * auto-continue timer) lets it go on.
 */
export class PlayerController {
  private plan: StitchPlan | null = null;
  private index = 0;
  private playing = false;
  private speed = 10;
  private autoContinue = false;
  private stop: ColourStop | null = null;
  private waited = 0;
  private listeners = new Set<() => void>();
  private snap: PlayerSnapshot = this.makeSnapshot();

  private makeSnapshot(): PlayerSnapshot {
    return { index: this.index, playing: this.playing, speed: this.speed, autoContinue: this.autoContinue, stop: this.stop };
  }

  private emit(): void {
    this.snap = this.makeSnapshot();
    for (const l of this.listeners) l();
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** Stable between changes, so it works with `useSyncExternalStore`. */
  snapshot = (): PlayerSnapshot => this.snap;

  get length(): number {
    return this.plan?.stitches.length ?? 0;
  }

  /** A new plan: stop and show the finished design. */
  setPlan(plan: StitchPlan | null): void {
    this.plan = plan;
    this.index = plan ? plan.stitches.length : 0;
    this.playing = false;
    this.stop = null;
    this.waited = 0;
    this.emit();
  }

  play(): void {
    if (!this.plan || this.length === 0) return;
    if (this.index >= this.length) this.index = 0;
    // Starting on a colour change (e.g. after scrubbing there) means "go on past it".
    if (this.plan?.stitches[Math.floor(this.index)]?.type === "colorChange") this.index = Math.floor(this.index) + 1;
    this.playing = true;
    this.stop = null;
    this.waited = 0;
    this.emit();
  }

  pause(): void {
    this.playing = false;
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else if (this.stop) this.continue();
    else this.play();
  }

  /** Jump to an entry count. Clears any colour stop. */
  seek(index: number): void {
    this.index = Math.max(0, Math.min(this.length, Math.round(index)));
    this.stop = null;
    this.waited = 0;
    this.emit();
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed));
    this.emit();
  }

  setAutoContinue(on: boolean): void {
    this.autoContinue = on;
    this.emit();
  }

  /** Leave the colour-change stop and keep playing. */
  continue(): void {
    if (!this.stop) return;
    this.index = this.stop.entryIndex + 1;
    this.stop = null;
    this.waited = 0;
    this.playing = this.index < this.length;
    this.emit();
  }

  /** Advance by `dt` seconds of wall time. */
  tick(dt: number): void {
    if (!this.plan) return;
    if (this.stop) {
      if (this.autoContinue) {
        this.waited += dt;
        if (this.waited >= AUTO_CONTINUE_SECONDS) this.continue();
      }
      return;
    }
    if (!this.playing) return;
    const target = Math.min(this.length, this.index + dt * BASE_STITCHES_PER_SEC * this.speed);
    const from = Math.floor(this.index);
    // Find the first colour change in the entries we are about to reveal.
    for (let i = from; i < Math.min(this.length, Math.ceil(target)); i++) {
      const s = this.plan.stitches[i];
      if (s.type === "colorChange" && i >= this.index) {
        this.index = i;
        this.stop = { entryIndex: i, threadIndex: s.threadIndex };
        this.playing = false;
        this.waited = 0;
        this.emit();
        return;
      }
    }
    this.index = target;
    if (this.index >= this.length) this.playing = false;
    this.emit();
  }
}

/** "1 h 05 min", "12 min 30 s", "45 s". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m > 0) return `${m} min ${String(r).padStart(2, "0")} s`;
  return `${r} s`;
}
