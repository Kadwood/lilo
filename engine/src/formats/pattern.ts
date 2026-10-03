import type { EmbCmd, EmbPattern, EmbStitch, EmbThread } from "./types";
import { pyRound } from "./io";

/** Placeholder colours for formats that carry none (DST, EXP, U01): distinct and legible on white. */
export const FILLER_COLORS = [
  "#1f3a93", "#c0392b", "#27ae60", "#f39c12", "#8e44ad", "#16a085", "#d35400", "#2c3e50",
  "#e84393", "#6ab04c", "#7f8c8d", "#2980b9",
];

export const fillerThread = (index: number): EmbThread => ({
  hex: FILLER_COLORS[index % FILLER_COLORS.length],
  name: `Colour ${index + 1}`,
});

export const threadOrFiller = (p: Pick<EmbPattern, "threads">, index: number): EmbThread =>
  p.threads[index] ?? fillerThread(index);

/** "#rrggbb" to a 24-bit integer. */
export const hexToInt = (hex: string): number => parseInt(hex.replace("#", ""), 16) & 0xffffff;
export const intToHex = (n: number): string => "#" + (n & 0xffffff).toString(16).padStart(6, "0");

export interface PatternBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounds over every command position (pyembroidery does the same; END and colour changes count). */
export function bounds(p: EmbPattern): PatternBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of p.stitches) {
    if (s.x > maxX) maxX = s.x;
    if (s.x < minX) minX = s.x;
    if (s.y > maxY) maxY = s.y;
    if (s.y < minY) minY = s.y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

export const countCmd = (p: EmbPattern, cmd: EmbCmd): number => p.stitches.filter((s) => s.cmd === cmd).length;

/** Accumulates a pattern the way the format readers describe it: relative moves from the last position. */
export class PatternBuilder {
  readonly stitches: EmbStitch[] = [];
  readonly threads: EmbThread[] = [];
  name?: string;
  x = 0;
  y = 0;

  private add(cmd: EmbCmd, x: number, y: number, needle?: number): void {
    this.x = x;
    this.y = y;
    this.stitches.push(needle === undefined ? { x, y, cmd } : { x, y, cmd, needle });
  }
  stitch(dx: number, dy: number): void {
    this.add("stitch", this.x + dx, this.y + dy);
  }
  /** A jump (needle moves without sewing). */
  move(dx: number, dy: number): void {
    this.add("jump", this.x + dx, this.y + dy);
  }
  moveAbs(x: number, y: number): void {
    this.add("jump", x, y);
  }
  trim(): void {
    this.add("trim", this.x, this.y);
  }
  colorChange(dx = 0, dy = 0): void {
    this.add("colorChange", this.x + dx, this.y + dy);
  }
  needleChange(needle: number): void {
    this.add("needleSet", this.x, this.y, needle);
  }
  stop(dx = 0, dy = 0): void {
    this.add("stop", this.x + dx, this.y + dy);
  }
  end(dx = 0, dy = 0): void {
    this.add("end", this.x + dx, this.y + dy);
  }
  addThread(t: EmbThread): void {
    this.threads.push(t);
  }
  build(): EmbPattern {
    return { stitches: this.stitches, threads: this.threads, ...(this.name ? { name: this.name } : {}) };
  }
}

/**
 * pyembroidery's `interpolate_trims`: formats with no trim command (DST, JEF) mark a trim as a run
 * of jumps. After `jumpsToRequireTrim` consecutive jumps, or once the run has travelled further than
 * `distanceToRequireTrim` (0.1 mm units), a TRIM is inserted before the run. With `clipping`, a run
 * of jumps that nets out to no movement (the trim "wiggle") is deleted.
 */
export function interpolateTrims(
  stitches: EmbStitch[],
  jumpsToRequireTrim: number | null,
  distanceToRequireTrim: number | null,
  clipping = true,
): EmbStitch[] {
  const out = stitches.map((s) => ({ ...s }));
  let i = -1;
  let ie = out.length - 1;
  let x = 0;
  let y = 0;
  let jumpCount = 0;
  let jumpStart = 0;
  let jumpDx = 0;
  let jumpDy = 0;
  let jumping = false;
  let trimmed = true;
  while (i < ie) {
    i++;
    const s = out[i];
    const dx = s.x - x;
    const dy = s.y - y;
    x = s.x;
    y = s.y;
    if (s.cmd === "stitch") {
      trimmed = false;
      jumping = false;
    } else if (s.cmd === "colorChange" || s.cmd === "needleSet" || s.cmd === "trim") {
      trimmed = true;
      jumping = false;
    }
    if (s.cmd === "jump") {
      if (!jumping) {
        jumpDx = 0;
        jumpDy = 0;
        jumpCount = 0;
        jumpStart = i;
        jumping = true;
      }
      jumpCount++;
      jumpDx += dx;
      jumpDy += dy;
      if (!trimmed) {
        if (
          jumpCount === jumpsToRequireTrim ||
          (distanceToRequireTrim !== null && (Math.abs(jumpDy) > distanceToRequireTrim || Math.abs(jumpDx) > distanceToRequireTrim))
        ) {
          // The trim happens where the needle was before the jump run began.
          const before = jumpStart > 0 ? out[jumpStart - 1] : { x: 0, y: 0 };
          out.splice(jumpStart, 0, { x: before.x, y: before.y, cmd: "trim" });
          jumpStart++;
          i++;
          ie++;
          trimmed = true;
        }
      }
      if (clipping && jumpDx === 0 && jumpDy === 0) {
        out.splice(jumpStart, i + 1 - jumpStart);
        i = jumpStart - 1;
        ie = out.length - 1;
      }
    }
  }
  return out;
}

/** Snap every position to the integer 0.1 mm grid with Python rounding. */
export const roundPattern = (p: EmbPattern): EmbPattern => ({
  ...p,
  stitches: p.stitches.map((s) => ({ ...s, x: pyRound(s.x), y: pyRound(s.y) })),
});
