/** Cells under a line or rectangle on a pixel grid. Pure, so the live preview and the commit agree. */

export type Cell = readonly [number, number];

/** Bresenham: every cell from (x0, y0) to (x1, y1), both ends included. */
export function lineCells(x0: number, y0: number, x1: number, y1: number): Cell[] {
  const out: Cell[] = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/** The cells of the rectangle with opposite corners (x0, y0) and (x1, y1): its edge, or all of it. */
export function rectCells(x0: number, y0: number, x1: number, y1: number, filled: boolean): Cell[] {
  const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0];
  const out: Cell[] = [];
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) {
      if (filled || x === ax || x === bx || y === ay || y === by) out.push([x, y]);
    }
  }
  return out;
}
