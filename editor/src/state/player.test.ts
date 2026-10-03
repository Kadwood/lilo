import { describe, expect, it, vi } from "vitest";
import type { StitchPlan } from "@lilo/engine/light";
import { BLUE, RED } from "../test/helpers";
import { AUTO_CONTINUE_SECONDS, BASE_STITCHES_PER_SEC, PlayerController, formatDuration } from "./player";

/** 100 blue needle drops, a colour change, 100 red needle drops. */
function plan(): StitchPlan {
  const s = (i: number, t: number, type: "stitch" | "colorChange" = "stitch") => ({ x: i, y: 0, type, threadIndex: t, objectIndex: 0 });
  return {
    threads: [BLUE, RED],
    warnings: [],
    stitches: [...Array.from({ length: 100 }, (_, i) => s(i, 0)), s(100, 1, "colorChange"), ...Array.from({ length: 100 }, (_, i) => s(101 + i, 1))],
  };
}

describe("PlayerController", () => {
  it("starts finished and rewinds on play", () => {
    const p = new PlayerController();
    p.setPlan(plan());
    expect(p.snapshot().index).toBe(201);
    p.play();
    expect(p.snapshot()).toMatchObject({ index: 0, playing: true });
  });

  it("advances at 850 spm x speed", () => {
    const p = new PlayerController();
    p.setPlan(plan());
    p.seek(0);
    p.setSpeed(2);
    p.play();
    p.tick(1);
    expect(p.snapshot().index).toBeCloseTo(BASE_STITCHES_PER_SEC * 2, 6);
  });

  it("clamps speed to 1-50x", () => {
    const p = new PlayerController();
    p.setSpeed(500);
    expect(p.snapshot().speed).toBe(50);
    p.setSpeed(0);
    expect(p.snapshot().speed).toBe(1);
  });

  it("stops at a colour change with the thread to swap to, then continues past it", () => {
    const p = new PlayerController();
    p.setPlan(plan());
    p.seek(90);
    p.setSpeed(50);
    p.play();
    p.tick(1); // far more than the 11 entries left before the change
    let s = p.snapshot();
    expect(s.playing).toBe(false);
    expect(s.stop).toEqual({ entryIndex: 100, threadIndex: 1 });
    expect(s.index).toBe(100); // the change itself is not yet shown

    p.tick(5); // nothing moves while stopped
    expect(p.snapshot().index).toBe(100);

    p.continue();
    s = p.snapshot();
    expect(s).toMatchObject({ index: 101, playing: true, stop: null });
    p.tick(1);
    expect(p.snapshot().index).toBe(201); // ran to the end
    expect(p.snapshot().playing).toBe(false);
  });

  it("auto-continues after a short wait when enabled", () => {
    const p = new PlayerController();
    p.setPlan(plan());
    p.seek(95);
    p.setSpeed(50);
    p.setAutoContinue(true);
    p.play();
    p.tick(1);
    expect(p.snapshot().stop).not.toBeNull();
    p.tick(AUTO_CONTINUE_SECONDS - 0.1);
    expect(p.snapshot().stop).not.toBeNull();
    p.tick(0.2);
    expect(p.snapshot().stop).toBeNull();
    expect(p.snapshot().playing).toBe(true);
  });

  it("scrubbing clears a stop, and toggle() resumes from one", () => {
    const p = new PlayerController();
    p.setPlan(plan());
    p.seek(95);
    p.setSpeed(50);
    p.play();
    p.tick(1);
    expect(p.snapshot().stop).not.toBeNull();
    p.toggle(); // continue
    expect(p.snapshot()).toMatchObject({ stop: null, playing: true });
    p.pause();
    p.seek(10);
    expect(p.snapshot()).toMatchObject({ index: 10, stop: null });
  });

  it("notifies subscribers and hands out stable snapshots between changes", () => {
    const p = new PlayerController();
    const fn = vi.fn();
    const off = p.subscribe(fn);
    p.setPlan(plan());
    expect(fn).toHaveBeenCalledTimes(1);
    const a = p.snapshot();
    expect(p.snapshot()).toBe(a);
    off();
    p.seek(5);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a plan", () => {
    const p = new PlayerController();
    p.play();
    p.tick(1);
    expect(p.snapshot()).toMatchObject({ index: 0, playing: false });
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(750)).toBe("12 min 30 s");
    expect(formatDuration(3900)).toBe("1 h 05 min");
    expect(formatDuration(-3)).toBe("0 s");
  });
});
