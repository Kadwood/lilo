import { rotation, scaling, translation, type Affine, type Box, type Pt } from "@lilo/engine/light";

/** Pure maths for the selection handles: where they sit and what a drag on each one means. */

/** Handle order: clockwise from the top-left corner. */
export const HANDLE_NAMES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type HandleName = (typeof HANDLE_NAMES)[number];

/** Position of a handle on a box (mm). */
export function handlePoint(b: Box, h: HandleName): Pt {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  switch (h) {
    case "nw":
      return [b.minX, b.minY];
    case "n":
      return [cx, b.minY];
    case "ne":
      return [b.maxX, b.minY];
    case "e":
      return [b.maxX, cy];
    case "se":
      return [b.maxX, b.maxY];
    case "s":
      return [cx, b.maxY];
    case "sw":
      return [b.minX, b.maxY];
    case "w":
      return [b.minX, cy];
  }
}

export const oppositeHandle = (h: HandleName): HandleName => HANDLE_NAMES[(HANDLE_NAMES.indexOf(h) + 4) % 8];

export const isCorner = (h: HandleName): boolean => h.length === 2;

/** Rotate handle: above the top edge by `offsetMm`. */
export const rotateHandlePoint = (b: Box, offsetMm: number): Pt => [(b.minX + b.maxX) / 2, b.minY - offsetMm];

const MIN_SCALE = 0.02;

/**
 * The transform for dragging `handle` of `box` to `to`.
 *
 * Corners scale both ways about the opposite corner. Edges scale one way about the opposite edge;
 * with `lock` the other direction follows proportionally about the box centre line. `lock` keeps the
 * aspect ratio (corner drags use the larger of the two ratios, so the box always reaches the cursor).
 */
export function resizeTransform(box: Box, handle: HandleName, to: Pt, lock: boolean): Affine {
  const w = box.maxX - box.minX || 1e-6;
  const h = box.maxY - box.minY || 1e-6;
  const anchorName = oppositeHandle(handle);
  const anchor = handlePoint(box, anchorName);
  const from = handlePoint(box, handle);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  let sx = 1;
  let sy = 1;
  const rx = (to[0] - anchor[0]) / (from[0] - anchor[0] || 1e-6);
  const ry = (to[1] - anchor[1]) / (from[1] - anchor[1] || 1e-6);
  const movesX = handle.includes("e") || handle.includes("w");
  const movesY = handle.includes("n") || handle.includes("s");
  if (movesX) sx = rx;
  if (movesY) sy = ry;
  if (lock) {
    if (movesX && movesY) {
      const k = Math.abs(sx - 1) * w >= Math.abs(sy - 1) * h ? sx : sy;
      sx = sy = k;
    } else if (movesX) sy = sx;
    else sx = sy;
  }
  sx = Math.max(MIN_SCALE, sx);
  sy = Math.max(MIN_SCALE, sy);
  // Edge handles scale about the opposite edge; the free axis (locked) scales about the centre line.
  const ax = movesX ? anchor[0] : cx;
  const ay = movesY ? anchor[1] : cy;
  return scaling(sx, sy, ax, ay);
}

/** Rotation about `centre` taking the pointer from `start` to `to`; `snapDeg` rounds the angle. */
export function rotateTransform(centre: Pt, start: Pt, to: Pt, snapDeg?: number): { m: Affine; deg: number } {
  const a0 = Math.atan2(start[1] - centre[1], start[0] - centre[0]);
  const a1 = Math.atan2(to[1] - centre[1], to[0] - centre[0]);
  let d = a1 - a0;
  if (snapDeg) {
    const step = (snapDeg * Math.PI) / 180;
    d = Math.round(d / step) * step;
  }
  let deg = (d * 180) / Math.PI;
  deg = ((((deg + 180) % 360) + 360) % 360) - 180;
  return { m: rotation(d, centre[0], centre[1]), deg };
}

/** Translation of a drag, optionally locked to its dominant axis. */
export function moveTransform(from: Pt, to: Pt, constrain: boolean): Affine {
  let dx = to[0] - from[0];
  let dy = to[1] - from[1];
  if (constrain) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  return translation(dx, dy);
}

/** Snap `to` so the line from `from` points at a multiple of `stepDeg` (the Ctrl constraint). */
export function snapAngle(from: Pt, to: Pt, stepDeg = 15): Pt {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const r = Math.hypot(dx, dy);
  const step = (stepDeg * Math.PI) / 180;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return [from[0] + r * Math.cos(a), from[1] + r * Math.sin(a)];
}

/** Axis-aligned box from two corners; `square` makes it square (grows from the first corner). */
export function boxFromDrag(a: Pt, b: Pt, square: boolean): Box {
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  if (square) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * m;
    dy = Math.sign(dy || 1) * m;
  }
  const x1 = a[0] + dx;
  const y1 = a[1] + dy;
  return { minX: Math.min(a[0], x1), minY: Math.min(a[1], y1), maxX: Math.max(a[0], x1), maxY: Math.max(a[1], y1) };
}
