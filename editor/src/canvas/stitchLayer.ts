import { Container, Graphics } from "pixi.js";
import type { PlanStitch, StitchPlan } from "@lilo/engine";

/** Stitch (thread) thickness in mm. */
export const THREAD_WIDTH_MM = 0.35;
const CHUNK = 3000;

export interface StitchStyle {
  realistic: boolean;
  jumps: boolean;
}

interface Chunk {
  start: number;
  end: number;
  hex: string;
  edge: Graphics | null;
  core: Graphics;
  jump: Graphics | null;
  /** How many entries are currently drawn (start..drawnTo). */
  drawnTo: number;
}

const hexToNum = (hex: string) => parseInt(hex.slice(1), 16);

/** Mix a colour with black (f < 1) or white (f > 1), returned as a 0xRRGGBB number. */
export function shade(hex: string, f: number): number {
  const n = hexToNum(hex);
  const ch = (v: number) => {
    const out = f <= 1 ? v * f : v + (255 - v) * (f - 1);
    return Math.max(0, Math.min(255, Math.round(out)));
  };
  return (ch((n >> 16) & 255) << 16) | (ch((n >> 8) & 255) << 8) | ch(n & 255);
}

/**
 * Draws a stitch plan as thread-coloured line segments. The plan is cut into chunks (a chunk is
 * one colour block, at most CHUNK entries) so playback can reveal stitches by redrawing only the
 * chunk that is mid-way. Realistic mode paints each stitch twice, a darker wide line under a
 * lighter narrow one, which reads as a rounded, lit thread.
 */
export class StitchLayer {
  readonly container = new Container();
  private chunks: Chunk[] = [];
  private plan: StitchPlan | null = null;
  private style: StitchStyle = { realistic: true, jumps: true };
  private progress = 0;

  clear(): void {
    for (const c of this.chunks) {
      c.edge?.destroy();
      c.core.destroy();
      c.jump?.destroy();
    }
    this.chunks = [];
    this.container.removeChildren();
  }

  setPlan(plan: StitchPlan | null, style: StitchStyle): void {
    this.clear();
    this.plan = plan;
    this.style = style;
    if (!plan) return;
    const list = plan.stitches;
    let start = 0;
    for (let i = 1; i <= list.length; i++) {
      const boundary = i === list.length || i - start >= CHUNK || list[i].threadIndex !== list[start].threadIndex;
      if (!boundary) continue;
      const hex = plan.threads[list[start].threadIndex]?.hex ?? "#000000";
      const jump = style.jumps ? new Graphics() : null;
      const edge = style.realistic ? new Graphics() : null;
      const core = new Graphics();
      for (const g of [jump, edge, core]) if (g) this.container.addChild(g);
      this.chunks.push({ start, end: i, hex, edge, core, jump, drawnTo: -1 });
      start = i;
    }
    this.setProgress(this.progress || list.length);
  }

  private draw(c: Chunk, upTo: number): void {
    const list = this.plan!.stitches;
    c.edge?.clear();
    c.core.clear();
    c.jump?.clear();
    let any = false;
    let anyJump = false;
    for (let i = c.start; i < upTo; i++) {
      const s: PlanStitch = list[i];
      const prev = i > 0 ? list[i - 1] : null;
      if (!prev || prev.type === "colorChange" || s.type === "colorChange") continue;
      const dx = s.x - prev.x;
      const dy = s.y - prev.y;
      if (dx * dx + dy * dy < 1e-8) continue;
      if (s.type === "stitch") {
        c.edge?.moveTo(prev.x, prev.y).lineTo(s.x, s.y);
        c.core.moveTo(prev.x, prev.y).lineTo(s.x, s.y);
        any = true;
      } else if (c.jump) {
        c.jump.moveTo(prev.x, prev.y).lineTo(s.x, s.y);
        anyJump = true;
      }
    }
    if (this.style.realistic) {
      if (any) c.edge?.stroke({ width: THREAD_WIDTH_MM * 1.4, color: shade(c.hex, 0.7), cap: "round", join: "round" });
      if (any) c.core.stroke({ width: THREAD_WIDTH_MM * 0.6, color: shade(c.hex, 1.2), cap: "round", join: "round" });
    } else if (any) {
      c.core.stroke({ width: THREAD_WIDTH_MM, color: hexToNum(c.hex), cap: "round", join: "round" });
    }
    if (anyJump) c.jump?.stroke({ width: 0.1, color: 0x8a8a8a, alpha: 0.55 });
    c.drawnTo = upTo;
  }

  /** Reveal the first `count` plan entries. */
  setProgress(count: number): void {
    this.progress = count;
    for (const c of this.chunks) {
      const visible = count > c.start;
      for (const g of [c.edge, c.core, c.jump]) if (g) g.visible = visible;
      if (!visible) continue;
      const upTo = Math.min(c.end, Math.floor(count));
      if (c.drawnTo !== upTo) this.draw(c, upTo);
    }
  }
}
