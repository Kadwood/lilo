import { nearestPecIndex } from "./pec-palette";
import { colorBlocks, type PlanStitch, type StitchPlan } from "../stitch/plan";

/** Which point of the design's bounding box lands on the machine origin (the hoop centre). */
export interface Origin {
  h: "left" | "center" | "right";
  v: "top" | "center" | "bottom";
}
export const CENTER_ORIGIN: Origin = { h: "center", v: "center" };

/** Shift a plan so the chosen anchor of its needle bounding box is at (0, 0). Returns a copy. */
export function applyOrigin(plan: StitchPlan, origin: Origin = CENTER_ORIGIN): StitchPlan {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of plan.stitches) {
    if (s.type !== "stitch") continue;
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minY = Math.min(minY, s.y);
    maxY = Math.max(maxY, s.y);
  }
  if (!Number.isFinite(minX)) return plan;
  const ax = origin.h === "left" ? minX : origin.h === "right" ? maxX : (minX + maxX) / 2;
  const ay = origin.v === "top" ? minY : origin.v === "bottom" ? maxY : (minY + maxY) / 2;
  return { ...plan, stitches: plan.stitches.map((s) => ({ ...s, x: s.x - ax, y: s.y - ay })) };
}

const ICON_W = 48;
const ICON_H = 38;
const ICON_STRIDE = ICON_W / 8;

/** The blank 48x38 PEC thumbnail: an empty rounded frame (same bytes pyembroidery/stitchjs write). */
function blankIcon(): Uint8Array {
  const g = new Uint8Array(ICON_STRIDE * ICON_H);
  const set = (x: number, y: number) => {
    g[y * ICON_STRIDE + (x >> 3)] |= 1 << (x & 7);
  };
  // top/bottom edges x 4..43 at rows 1 and 36; chamfers at rows 2-3 / 34-35; straight sides x=1 and x=46.
  for (let x = 4; x <= 43; x++) {
    set(x, 1);
    set(x, 36);
  }
  const chamfer: [number, number, number][] = [
    [2, 3, 44],
    [3, 2, 45],
    [34, 2, 45],
    [35, 3, 44],
  ];
  for (const [y, l, r] of chamfer) {
    set(l, y);
    set(r, y);
  }
  for (let y = 4; y <= 33; y++) {
    set(1, y);
    set(46, y);
  }
  return g;
}

function drawIcon(points: readonly [number, number][], bounds: { minX: number; minY: number; maxX: number; maxY: number }, buffer: number): Uint8Array {
  const g = blankIcon();
  const w = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const h = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const scale = Math.min((ICON_W - buffer) / w, (ICON_H - buffer) / h);
  const tx = ICON_W / 2 - ((bounds.minX + bounds.maxX) / 2) * scale;
  const ty = ICON_H / 2 - ((bounds.minY + bounds.maxY) / 2) * scale;
  const mark = (x: number, y: number) => {
    const ix = Math.floor(x * scale + tx);
    const iy = Math.floor(y * scale + ty);
    if (ix < 2 || ix > 45 || iy < 4 || iy > 33) return; // stay inside the frame
    g[iy * ICON_STRIDE + (ix >> 3)] |= 1 << (ix & 7);
  };
  let prev: [number, number] | null = null;
  for (const p of points) {
    if (prev) {
      const steps = Math.max(1, Math.ceil(Math.hypot(p[0] - prev[0], p[1] - prev[1]) * scale));
      for (let i = 1; i <= steps; i++) mark(prev[0] + ((p[0] - prev[0]) * i) / steps, prev[1] + ((p[1] - prev[1]) * i) / steps);
    } else mark(p[0], p[1]);
    prev = p;
  }
  return g;
}

export interface WritePesOptions {
  /** Name shown on the machine (first 8 chars are used; the rest is dropped). */
  label?: string;
}

const MASK7 = 0b01111111;
const FLAG_LONG = 0x8000;
const JUMP_FLAG = 0x1000;
const TRIM_FLAG = 0x2000;

class Bytes {
  readonly data: number[] = [];
  byte(...b: number[]) {
    for (const v of b) this.data.push(v & 0xff);
  }
  str(s: string) {
    for (const c of s) this.data.push(c.charCodeAt(0) & 0xff);
  }
  i16le(v: number) {
    this.byte(v, v >> 8);
  }
  fill(v: number, n: number) {
    for (let i = 0; i < n; i++) this.data.push(v);
  }
}

function writeShort(out: Bytes, v: number) {
  out.byte(v & MASK7);
}
function writeLong(out: Bytes, v: number, flag: number) {
  const word = (v & 0x0fff) | FLAG_LONG | flag;
  out.byte(word >> 8, word);
}

/**
 * Write a PES (version 1, truncated header: PEC block only) file with the design's real colours.
 *
 * Layout: `#PES0001`, PEC offset (22), then a PEC block: label, the per-block palette indices
 * (nearest of the 64 Brother PEC colours, by CIEDE2000), stitch stream, then one 48x38 thumbnail
 * for the whole design plus one per colour block.
 *
 * The plan's coordinates are written as-is (0.1 mm units), so call `applyOrigin` first. Stitch
 * deltas up to +-204.7 mm are representable; `validatePlan` keeps jumps below that.
 */
export function writePes(plan: StitchPlan, options: WritePesOptions = {}): Uint8Array {
  const blocks = colorBlocks(plan);
  if (blocks.length === 0 || plan.stitches.every((s) => s.type !== "stitch")) {
    throw new Error("Nothing to export: the design has no stitches.");
  }
  if (blocks.length > 255) throw new Error("Too many colour changes for PES (max 255 colours).");

  // The colour list: one PEC slot per colour block (blocks are in thread-index order of appearance).
  const pecIndices = blocks.map((b) => nearestPecIndex(plan.threads[b.threadIndex].hex));

  const out = new Bytes();
  out.str("#PES0001");
  out.byte(0x16, 0, 0, 0); // PEC block offset
  out.fill(0, 10);

  // ---- PEC header (512 bytes) ----
  const label = (options.label ?? "Lilo").replace(/\.[^.]*$/, "").replace(/[^\x20-\x7e]/g, "_").slice(0, 8);
  out.str("LA:" + label.padEnd(16, " ") + "\r");
  out.fill(0x20, 12);
  out.byte(0xff, 0x00, ICON_STRIDE, ICON_H);
  out.fill(0x20, 12);
  out.byte(pecIndices.length - 1, ...pecIndices);
  out.fill(0x20, 463 - pecIndices.length);

  // ---- stitch block ----
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of plan.stitches) {
    if (s.type !== "stitch") continue;
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minY = Math.min(minY, s.y);
    maxY = Math.max(maxY, s.y);
  }
  const blockStart = out.data.length;
  out.byte(0, 0);
  out.byte(0, 0, 0); // graphics offset, patched below
  out.byte(0x31, 0xff, 0xf0);
  out.i16le(Math.round((maxX - minX) * 10));
  out.i16le(Math.round((maxY - minY) * 10));
  out.i16le(0x1e0);
  out.i16le(0x1b0);

  let colorTwo = true;
  let xx = 0;
  let yy = 0;
  for (const s of plan.stitches) {
    if (s.type === "colorChange") {
      out.byte(0xfe, 0xb0, colorTwo ? 2 : 1);
      colorTwo = !colorTwo;
      continue;
    }
    const dx = Math.round(s.x * 10) - xx;
    const dy = Math.round(s.y * 10) - yy;
    if (Math.abs(dx) > 2047 || Math.abs(dy) > 2047) {
      throw new Error(`Move of ${(Math.max(Math.abs(dx), Math.abs(dy)) / 10).toFixed(1)} mm exceeds the PES limit; run validatePlan first.`);
    }
    xx += dx;
    yy += dy;
    if (s.type === "stitch") {
      if (dx > -64 && dx < 63 && dy > -64 && dy < 63) {
        writeShort(out, dx);
        writeShort(out, dy);
      } else {
        writeLong(out, dx, 0);
        writeLong(out, dy, 0);
      }
    } else {
      const flag = s.type === "trim" ? TRIM_FLAG : JUMP_FLAG;
      writeLong(out, dx, flag);
      writeLong(out, dy, flag);
    }
  }
  out.byte(0xff);
  const blockLength = out.data.length - blockStart;
  out.data[blockStart + 2] = blockLength & 0xff;
  out.data[blockStart + 3] = (blockLength >> 8) & 0xff;
  out.data[blockStart + 4] = (blockLength >> 16) & 0xff;

  // ---- thumbnails: whole design, then one per colour block ----
  const bounds = { minX, minY, maxX, maxY };
  const needle = (list: readonly PlanStitch[]): [number, number][] =>
    list.filter((s) => s.type === "stitch").map((s) => [s.x, s.y]);
  out.data.push(...drawIcon(needle(plan.stitches), bounds, 4));
  for (const b of blocks) out.data.push(...drawIcon(needle(plan.stitches.slice(b.start, b.end)), bounds, 5));

  return Uint8Array.from(out.data);
}
