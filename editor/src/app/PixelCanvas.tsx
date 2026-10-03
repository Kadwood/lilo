import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { PixelArt } from "@lilo/engine/light";
import type { Cell } from "../state/pixelShapes";

export interface PixelCanvasProps {
  art: PixelArt;
  /** Cells drawn faintly on top: the line or rectangle being dragged. */
  preview: readonly Cell[];
  /** Colour of the preview cells, or null to show them as erasing. */
  previewHex: string | null;
  /** The cell the keyboard is on. */
  cursor: Cell;
  /** Pixels per cell on screen. */
  cellPx: number;
  onDown(cell: Cell, e: PointerEvent): void;
  onMove(cell: Cell, e: PointerEvent): void;
  onUp(cell: Cell, e: PointerEvent): void;
  onCursor(cell: Cell): void;
  /** Space or Enter on the focused grid: act on the cursor cell like a click. */
  onActivate(cell: Cell): void;
}

const css = (name: string, fb: string) => (typeof document === "undefined" ? fb : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb);

/**
 * The editable grid. Pointer: press, drag and release report the cell under the pointer. Keyboard:
 * the grid takes focus, arrows move a cursor cell, Space or Enter acts there. Drawn on a 2D canvas.
 */
export function PixelCanvas({ art, preview, previewHex, cursor, cellPx, onDown, onMove, onUp, onCursor, onActivate }: PixelCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = art.width * cellPx;
  const h = art.height * cellPx;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || /jsdom/i.test(navigator.userAgent)) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // empty cells: a quiet checkerboard, so "no stitches" reads differently from white thread
    const a = css("--surface", "#ffffff");
    const b = css("--surface-2", "#eeece8");
    for (let y = 0; y < art.height; y++) {
      for (let x = 0; x < art.width; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? a : b;
        ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
      }
    }
    const hex = new Map(art.threads.map((t) => [t.id, t.hex]));
    for (let y = 0; y < art.height; y++) {
      for (let x = 0; x < art.width; x++) {
        const id = art.cells[y * art.width + x];
        if (!id) continue;
        ctx.fillStyle = hex.get(id) ?? "#000";
        ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
      }
    }
    if (cellPx >= 6) {
      ctx.strokeStyle = css("--canvas-grid-major", "#cbc7be");
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= art.width; x++) {
        ctx.moveTo(x * cellPx + 0.5, 0);
        ctx.lineTo(x * cellPx + 0.5, h);
      }
      for (let y = 0; y <= art.height; y++) {
        ctx.moveTo(0, y * cellPx + 0.5);
        ctx.lineTo(w, y * cellPx + 0.5);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (const [x, y] of preview) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = previewHex ?? css("--danger", "#c0392b");
      ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = css("--accent", "#2f5fd0");
    ctx.lineWidth = 2;
    ctx.strokeRect(cursor[0] * cellPx + 1, cursor[1] * cellPx + 1, cellPx - 2, cellPx - 2);
  }, [art, preview, previewHex, cursor, cellPx, w, h]);

  const cellAt = (e: PointerEvent): Cell => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / (r.width || w)) * art.width);
    const y = Math.floor(((e.clientY - r.top) / (r.height || h)) * art.height);
    return [Math.max(0, Math.min(art.width - 1, x)), Math.max(0, Math.min(art.height - 1, y))];
  };

  const key = (e: KeyboardEvent) => {
    const step: Record<string, Cell> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = step[e.key];
    if (d) {
      e.preventDefault();
      onCursor([Math.max(0, Math.min(art.width - 1, cursor[0] + d[0])), Math.max(0, Math.min(art.height - 1, cursor[1] + d[1]))]);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      onActivate(cursor);
    }
  };

  const id = art.cells[cursor[1] * art.width + cursor[0]];
  const here = id ? art.threads.find((t) => t.id === id) : null;

  return (
    <canvas
      ref={ref}
      className="pixel-canvas"
      data-testid="pixel-canvas"
      style={{ width: w, height: h }}
      width={w}
      height={h}
      tabIndex={0}
      role="application"
      aria-label={`Pixel grid, ${art.width} by ${art.height}. Arrow keys move, Space paints with the current tool.`}
      aria-description={`Cell ${cursor[0] + 1}, ${cursor[1] + 1}: ${here ? `${here.brand} ${here.code} ${here.name}` : "empty"}`}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        (e.currentTarget as HTMLElement).focus();
        onDown(cellAt(e), e);
      }}
      onPointerMove={(e) => onMove(cellAt(e), e)}
      onPointerUp={(e) => onUp(cellAt(e), e)}
      onPointerCancel={(e) => onUp(cellAt(e), e)}
      onKeyDown={key}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
