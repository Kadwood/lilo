/**
 * Image to pixel-art grid: area-average downsample (so a photo's detail becomes a cell's mean
 * colour), snap each cell to the nearest thread in the palette (CIEDE2000), then merge the rarest
 * colours into their nearest surviving neighbour until at most `maxColors` remain.
 */
import type { ImageDataLike } from "../autodigitize/types";
import { deltaE2000, rgbToLab, type Lab } from "../color";
import { toDesignThread, type ThreadEntry } from "../threads";
import { createPixelArt, DEFAULT_CELL_MM, DEFAULT_GRID_SIZE, type PixelArt, type PixelStyle } from "./grid";

export interface PixelImportOptions {
  /** Threads to snap to: pass `snapPalette(shelf, brand)` for "My Threads, else the brand". */
  palette: readonly ThreadEntry[];
  /** Longest side of the grid in cells. Default 32. The other side follows the aspect ratio. */
  maxCells?: number;
  /** Exact grid size (overrides `maxCells`; the image is stretched to it). */
  width?: number;
  height?: number;
  /** At most this many different threads. Default 8. */
  maxColors?: number;
  /** Cells whose pixels are mostly below this alpha stay empty. Default 128. */
  alphaCutoff?: number;
  /** Treat the dominant corner colour as background (cells close to it stay empty). Default false. */
  removeBackground?: boolean;
  cellMm?: number;
  style?: PixelStyle;
}

interface Cell {
  lab: Lab;
  opaque: boolean;
  rgb: [number, number, number];
}

export function pixelArtFromImage(image: ImageDataLike, options: PixelImportOptions): PixelArt {
  if (options.palette.length === 0) throw new Error("Pick some threads to snap the picture to.");
  if (image.width < 1 || image.height < 1) throw new Error("The image is empty.");
  const maxColors = Math.max(1, options.maxColors ?? 8);
  const cutoff = options.alphaCutoff ?? 128;
  let w: number;
  let h: number;
  if (options.width && options.height) {
    w = options.width;
    h = options.height;
  } else {
    const m = options.maxCells ?? DEFAULT_GRID_SIZE;
    const scale = m / Math.max(image.width, image.height);
    w = Math.max(1, Math.round(image.width * scale));
    h = Math.max(1, Math.round(image.height * scale));
  }
  const art = createPixelArt(w, h, options.cellMm ?? DEFAULT_CELL_MM, options.style ?? "tatami");

  // 1. area-average each cell (alpha-weighted)
  const cells: Cell[] = [];
  for (let cy = 0; cy < h; cy++) {
    const y0 = Math.floor((cy * image.height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * image.height) / h));
    for (let cx = 0; cx < w; cx++) {
      const x0 = Math.floor((cx * image.width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * image.width) / w));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * image.width + x) * 4;
          const al = image.data[i + 3];
          r += image.data[i] * al;
          g += image.data[i + 1] * al;
          b += image.data[i + 2] * al;
          a += al;
          n++;
        }
      }
      const rgb: [number, number, number] = a > 0 ? [r / a, g / a, b / a] : [0, 0, 0];
      cells.push({ rgb, lab: rgbToLab(...rgb), opaque: a / n >= cutoff });
    }
  }

  // 2. background: the most common corner colour (within a small distance), if asked
  if (options.removeBackground) {
    const corners = [0, w - 1, (h - 1) * w, h * w - 1].map((i) => cells[i]).filter((c) => c.opaque);
    let bg: Cell | null = null;
    let votes = 0;
    for (const c of corners) {
      const v = corners.filter((d) => deltaE2000(c.lab, d.lab) < 8).length;
      if (v > votes) {
        votes = v;
        bg = c;
      }
    }
    if (bg && votes >= 2) for (const c of cells) if (deltaE2000(c.lab, bg.lab) < 8) c.opaque = false;
  }

  // 3. snap to the palette
  const pal = options.palette;
  const snapped: number[] = cells.map((c) => {
    if (!c.opaque) return -1;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < pal.length; i++) {
      const d = deltaE2000(c.lab, pal[i].lab);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  });

  // 4. cap the colour count: fold the rarest colour into its nearest surviving one
  const counts = new Map<number, number>();
  for (const s of snapped) if (s >= 0) counts.set(s, (counts.get(s) ?? 0) + 1);
  const remap = new Map<number, number>([...counts.keys()].map((k) => [k, k]));
  while (counts.size > maxColors) {
    const [rare] = [...counts.entries()].sort((p, q) => p[1] - q[1] || q[0] - p[0])[0];
    let to = -1;
    let bd = Infinity;
    for (const k of counts.keys()) {
      if (k === rare) continue;
      const d = deltaE2000(pal[rare].lab, pal[k].lab);
      if (d < bd) {
        bd = d;
        to = k;
      }
    }
    counts.set(to, counts.get(to)! + counts.get(rare)!);
    counts.delete(rare);
    for (const [from, target] of remap) if (target === rare) remap.set(from, to);
  }

  // 5. write the grid
  const threads = new Map<number, ReturnType<typeof toDesignThread>>();
  const cellsOut = snapped.map((s) => {
    if (s < 0) return null;
    const idx = remap.get(s)!;
    if (!threads.has(idx)) threads.set(idx, toDesignThread(pal[idx]));
    return threads.get(idx)!.id;
  });
  return { ...art, cells: cellsOut, threads: [...threads.values()] };
}
