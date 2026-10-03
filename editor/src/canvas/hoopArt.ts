import type { Graphics } from "pixi.js";
import { outerSize, ringMm, type Hoop } from "@lilo/engine/light";

/** The colours hoop drawing needs (from the CSS variables, see theme.ts). */
export interface HoopColours {
  /** Sewing-area outline and crosshair. */
  hoop: number;
  /** The frame ring. */
  frame: number;
  /** Frame outlines and the clamp. */
  frameEdge: number;
}

export interface HoopDrawOptions {
  /** Draw the frame ring, clamp and bevel around the sewing area. */
  frame: boolean;
  /** Draw the dashed safe margin inside the sewing area. */
  safeArea: boolean;
  safeMarginMm: number;
}

type Pt = [number, number];

const isEllipse = (h: Hoop) => h.shape === "round" || h.shape === "oval";

/** Points along a rounded rectangle centred on the origin (so a dashed line can follow it). */
export function roundRectPoints(hw: number, hh: number, r: number, perCorner = 8): Pt[] {
  const rr = Math.max(0, Math.min(r, hw, hh));
  if (rr === 0) return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  const pts: Pt[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= perCorner; i++) {
      const a = a0 + (i / perCorner) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  };
  corner(hw - rr, hh - rr, 0);
  corner(-hw + rr, hh - rr, Math.PI / 2);
  corner(-hw + rr, -hh + rr, Math.PI);
  corner(hw - rr, -hh + rr, Math.PI * 1.5);
  return pts;
}

export function ellipsePoints(rx: number, ry: number, n = 96): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [Math.cos(a) * rx, Math.sin(a) * ry] as Pt;
  });
}

/** The outline of a hoop's sewing area inset by `inset` mm, as a closed polyline. */
export function sewingOutline(h: Hoop, inset = 0): Pt[] {
  const hw = Math.max(0.1, h.widthMm / 2 - inset);
  const hh = Math.max(0.1, h.heightMm / 2 - inset);
  return isEllipse(h) ? ellipsePoints(hw, hh) : roundRectPoints(hw, hh, Math.max(0, (h.cornerRadiusMm ?? 0) - inset));
}

/** Draw a dashed line along a closed polyline. Does not stroke: call `g.stroke` after. */
export function dashClosed(g: Graphics, pts: Pt[], dash: number, gap: number): void {
  if (pts.length < 2) return;
  const loop = [...pts, pts[0]];
  let on = true;
  let left = dash;
  let [px, py] = loop[0];
  g.moveTo(px, py);
  for (let i = 1; i < loop.length; i++) {
    const [x, y] = loop[i];
    let dx = x - px;
    let dy = y - py;
    let len = Math.hypot(dx, dy);
    while (len > 1e-9) {
      const step = Math.min(left, len);
      const t = step / len;
      px += dx * t;
      py += dy * t;
      if (on) g.lineTo(px, py);
      else g.moveTo(px, py);
      dx *= 1 - t;
      dy *= 1 - t;
      len -= step;
      left -= step;
      if (left <= 1e-9) {
        on = !on;
        left = on ? dash : gap;
      }
    }
  }
}

function pathShape(g: Graphics, h: Hoop, hw: number, hh: number, r: number): void {
  if (isEllipse(h)) g.ellipse(0, 0, hw, hh);
  else g.roundRect(-hw, -hh, hw * 2, hh * 2, Math.min(r, hw, hh));
}

/**
 * Draw the hoop as it looks on the table: the frame ring (matt plastic/wood look, a soft inner bevel), the
 * clamp on its side, the sewing area outline, the centre crosshair with quarter marks and the dashed safe
 * margin. Everything is in mm in the canvas world; line widths are divided by the zoom `z` so they stay
 * the same size on screen.
 */
export function drawHoop(g: Graphics, hoop: Hoop, z: number, c: HoopColours, o: HoopDrawOptions): void {
  g.clear();
  const hw = hoop.widthMm / 2;
  const hh = hoop.heightMm / 2;
  const r = hoop.cornerRadiusMm ?? (isEllipse(hoop) ? 0 : 6);
  const px = 1 / z;

  if (o.frame) {
    const out = outerSize(hoop);
    const ring = ringMm(hoop);
    const ohw = out.w / 2;
    const ohh = out.h / 2;
    const or = r + ring * 0.9;
    // the ring: outer shape with the sewing area cut out
    pathShape(g, hoop, ohw, ohh, or);
    g.fill({ color: c.frame, alpha: 0.9 });
    pathShape(g, hoop, hw, hh, r);
    g.cut();
    // soft bevel just outside the sewing area, and the ring's outer edge
    pathShape(g, hoop, hw + px * 1.5, hh + px * 1.5, r + px * 1.5);
    g.stroke({ width: px * 3, color: c.frameEdge, alpha: 0.35 });
    pathShape(g, hoop, ohw, ohh, or);
    g.stroke({ width: px * 1.25, color: c.frameEdge, alpha: 0.95 });
    // a lighter inner rim line: the edge of the inner ring catching the light
    pathShape(g, hoop, hw + ring * 0.45, hh + ring * 0.45, r + ring * 0.45);
    g.stroke({ width: px, color: 0xffffff, alpha: 0.22 });

    // the clamp: a block on the chosen side with a screw head
    const side = hoop.clamp ?? "none";
    if (side !== "none") {
      const horizontal = side === "top" || side === "bottom";
      const along = Math.max(10, Math.min(28, (horizontal ? hoop.widthMm : hoop.heightMm) * 0.18));
      const thick = ring * 1.25;
      const sign = side === "top" || side === "left" ? -1 : 1;
      const edge = (horizontal ? ohh : ohw) - ring * 0.5;
      const cx = horizontal ? 0 : sign * edge;
      const cy = horizontal ? sign * edge : 0;
      const bw = horizontal ? along : thick;
      const bh = horizontal ? thick : along;
      g.roundRect(cx - bw / 2, cy - bh / 2, bw, bh, Math.min(bw, bh) * 0.3);
      g.fill({ color: c.frameEdge, alpha: 0.95 });
      g.roundRect(cx - bw / 2, cy - bh / 2, bw, bh, Math.min(bw, bh) * 0.3);
      g.stroke({ width: px, color: 0x000000, alpha: 0.25 });
      g.circle(cx, cy, Math.min(bw, bh) * 0.28);
      g.fill({ color: 0xffffff, alpha: 0.4 });
      g.circle(cx, cy, Math.min(bw, bh) * 0.28);
      g.stroke({ width: px, color: 0x000000, alpha: 0.35 });
      // the screw's slot
      const s = Math.min(bw, bh) * 0.28;
      g.moveTo(cx - s * 0.7, cy - s * 0.7).lineTo(cx + s * 0.7, cy + s * 0.7);
      g.stroke({ width: px, color: 0x000000, alpha: 0.4 });
    }
  }

  // the sewing area
  pathShape(g, hoop, hw, hh, r);
  g.stroke({ width: px * 1.75, color: c.hoop, alpha: 0.95 });

  // centre crosshair, with marks at the quarters and the edges
  g.moveTo(-hw, 0).lineTo(hw, 0);
  g.moveTo(0, -hh).lineTo(0, hh);
  g.stroke({ width: px, color: c.hoop, alpha: 0.4 });
  const tick = px * 5;
  for (const f of [-1, -0.5, 0.5, 1]) {
    g.moveTo(f * hw, -tick).lineTo(f * hw, tick);
    g.moveTo(-tick, f * hh).lineTo(tick, f * hh);
  }
  g.stroke({ width: px * 1.25, color: c.hoop, alpha: 0.75 });
  g.circle(0, 0, px * 3.5);
  g.stroke({ width: px * 1.25, color: c.hoop, alpha: 0.9 });

  if (o.safeArea && o.safeMarginMm > 0 && hoop.widthMm > o.safeMarginMm * 4 && hoop.heightMm > o.safeMarginMm * 4) {
    dashClosed(g, sewingOutline(hoop, o.safeMarginMm), px * 5, px * 4);
    g.stroke({ width: px, color: c.hoop, alpha: 0.55 });
  }
}
