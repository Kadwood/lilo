/**
 * Pan/zoom maths for the canvas. A `View` maps world millimetres to screen pixels:
 * `screen = world * zoom + (x, y)`. Pure functions, no DOM.
 */
export interface View {
  x: number;
  y: number;
  /** Pixels per millimetre. */
  zoom: number;
}

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 300;

export const clampZoom = (z: number): number => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

/** Zoom by `factor` keeping the world point under screen (sx, sy) fixed. */
export function zoomAt(v: View, sx: number, sy: number, factor: number): View {
  const zoom = clampZoom(v.zoom * factor);
  const k = zoom / v.zoom;
  return { zoom, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k };
}

export const panBy = (v: View, dx: number, dy: number): View => ({ ...v, x: v.x + dx, y: v.y + dy });

export const screenToWorld = (v: View, sx: number, sy: number): [number, number] => [(sx - v.x) / v.zoom, (sy - v.y) / v.zoom];

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A view that centres `rect` (mm) in a `width` x `height` px canvas with `margin` (fraction) spare. */
export function fitView(width: number, height: number, rect: Rect, margin = 0.15): View {
  const w = Math.max(rect.maxX - rect.minX, 1);
  const h = Math.max(rect.maxY - rect.minY, 1);
  const zoom = clampZoom(Math.min(width / (w * (1 + 2 * margin)), height / (h * (1 + 2 * margin))));
  const cx = (rect.minX + rect.maxX) / 2;
  const cy = (rect.minY + rect.maxY) / 2;
  return { zoom, x: width / 2 - cx * zoom, y: height / 2 - cy * zoom };
}

/** The world rectangle currently visible. */
export function visibleRect(v: View, width: number, height: number): Rect {
  const [minX, minY] = screenToWorld(v, 0, 0);
  const [maxX, maxY] = screenToWorld(v, width, height);
  return { minX, minY, maxX, maxY };
}

/**
 * Wheel events mean different things per device: a pinch on a trackpad arrives with ctrlKey and
 * should zoom; a two-finger scroll (fractional or horizontal deltas) should pan; a mouse wheel
 * (integer line/pixel steps, vertical only) should zoom.
 */
export function classifyWheel(e: { ctrlKey: boolean; deltaX: number; deltaY: number; deltaMode: number }): "zoom" | "pan" {
  if (e.ctrlKey) return "zoom";
  if (e.deltaMode !== 0) return "zoom"; // line/page mode is a mouse wheel
  if (e.deltaX !== 0 || !Number.isInteger(e.deltaY)) return "pan";
  return "zoom";
}

/** Zoom factor for a wheel delta (pinch events carry small deltas, mouse wheels big ones). */
export function wheelZoomFactor(e: { ctrlKey: boolean; deltaY: number; deltaMode: number }): number {
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  const k = e.ctrlKey ? 0.01 : 0.0018;
  return Math.exp(-dy * k);
}
