import { Container, Mesh, MeshGeometry, Texture } from "pixi.js";
import type { PlanStitch, StitchPlan } from "@lilo/engine";
import type { Rect } from "./viewport";

/** Stitch (thread) thickness in mm. */
export const THREAD_WIDTH_MM = 0.35;
/** Plan entries per chunk: small enough that panning culls whole chunks, large enough to keep draw calls few. */
const CHUNK = 2000;
const JUMP_COLOR = 0x8a8a8a;

export interface StitchStyle {
  realistic: boolean;
  jumps: boolean;
  /**
   * Thread thickness multiplier per `design.objects` index, so triple stitches, rope and satin
   * read as heavier thread in the realistic view. Missing entries mean 1.
   */
  widthScale?: readonly number[];
}

/** One drawable set of quads (all the stitches of a chunk at one thickness, or its jump lines). */
interface Layer {
  mesh: Mesh;
  geometry: MeshGeometry;
  /** Quads drawn when the chunk is shown up to plan entry `start + j`: `quadsUpTo[j]`. */
  quadsUpTo: Uint32Array;
  total: number;
  /** Indices per segment (6 for a rectangle, 12 with pointed ends). */
  indicesPer: number;
  /** When it is drawn: always, only zoomed in (the lit, two-layer thread) or only zoomed out (one flat layer). */
  lod: "both" | "near" | "far";
}

/** Below this zoom (screen px per mm) a thread is about a pixel wide: one flat layer says as much as two. */
export const NEAR_ZOOM = 4;

interface Chunk {
  start: number;
  end: number;
  layers: Layer[];
  /** Bounding box in mm, padded by the thickest thread. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** How many entries are currently shown (start..shownTo). */
  shownTo: number;
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
 * Draws a stitch plan as thread-coloured quads (two triangles per stitch). The plan is cut into chunks (a
 * chunk is part of one colour block, at most CHUNK entries). Each chunk is built once, as GPU geometry;
 * playback only changes how many triangles are drawn, and panning hides chunks that are off screen. The
 * realistic view paints each stitch twice, a darker wide one (pointed ends) under a lighter narrow one (square
 * ends), which reads as a rounded, lit thread with no gaps at the joins.
 */
export class StitchLayer {
  readonly container = new Container();
  private chunks: Chunk[] = [];
  private style: StitchStyle = { realistic: true, jumps: true };
  private progress = 0;
  private view: Rect | null = null;
  private zoom = 8;

  constructor() {
    this.container.eventMode = "none"; // thousands of meshes must never be hit-tested
    this.container.interactiveChildren = false;
  }

  clear(): void {
    for (const c of this.chunks) {
      for (const l of c.layers) {
        l.mesh.destroy();
        // a mesh does not own its geometry: without this the GPU buffers of every old plan stay allocated
        l.geometry.destroy(true);
      }
    }
    this.chunks = [];
    this.container.removeChildren();
  }

  setPlan(plan: StitchPlan | null, style: StitchStyle): void {
    this.clear();
    this.style = style;
    if (!plan) return;
    const list = plan.stitches;
    let start = 0;
    for (let i = 1; i <= list.length; i++) {
      const boundary = i === list.length || i - start >= CHUNK || list[i].threadIndex !== list[start].threadIndex;
      if (!boundary) continue;
      const chunk = this.build(plan, start, i);
      this.chunks.push(chunk);
      for (const l of chunk.layers) this.container.addChild(l.mesh);
      start = i;
    }
    this.setProgress(this.progress || list.length);
  }

  /** Build the geometry of plan entries start..end. */
  private build(plan: StitchPlan, start: number, end: number): Chunk {
    const list = plan.stitches;
    const n = end - start;
    const hex = plan.threads[list[start].threadIndex]?.hex ?? "#000000";
    const style = this.style;

    // Collect the drawable segments once: stitches with their thickness multiplier, and jump lines.
    const sx0: number[] = [];
    const sy0: number[] = [];
    const sx1: number[] = [];
    const sy1: number[] = [];
    const sk: number[] = [];
    const sIdx: number[] = []; // entry index (relative to start) each stitch segment belongs to
    const jx0: number[] = [];
    const jy0: number[] = [];
    const jx1: number[] = [];
    const jy1: number[] = [];
    const jIdx: number[] = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxK = 1;
    for (let i = start; i < end; i++) {
      const s: PlanStitch = list[i];
      const prev = i > 0 ? list[i - 1] : null;
      if (!prev || prev.type === "colorChange" || s.type === "colorChange") continue;
      const dx = s.x - prev.x;
      const dy = s.y - prev.y;
      if (dx * dx + dy * dy < 1e-8) continue;
      if (s.type === "stitch") {
        const k = style.widthScale?.[s.objectIndex] ?? 1;
        if (k > maxK) maxK = k;
        sx0.push(prev.x);
        sy0.push(prev.y);
        sx1.push(s.x);
        sy1.push(s.y);
        sk.push(k);
        sIdx.push(i - start);
      } else if (style.jumps) {
        jx0.push(prev.x);
        jy0.push(prev.y);
        jx1.push(s.x);
        jy1.push(s.y);
        jIdx.push(i - start);
      } else continue;
      minX = Math.min(minX, prev.x, s.x);
      minY = Math.min(minY, prev.y, s.y);
      maxX = Math.max(maxX, prev.x, s.x);
      maxY = Math.max(maxY, prev.y, s.y);
    }

    const layers: Layer[] = [];
    // cap "square": a rectangle longer by half the width at both ends; "point": a rectangle plus a triangle at each end
    // (reads as a rounded thread end at a third of the cost of a round cap); "none": a plain rectangle
    const layer = (x0: number[], y0: number[], x1: number[], y1: number[], idx: number[], width: (q: number) => number, cap: "square" | "point" | "none", color: number, alpha: number, lod: Layer["lod"] = "both"): void => {
      const q = idx.length;
      if (q === 0) return;
      const vPer = cap === "point" ? 6 : 4;
      const iPer = cap === "point" ? 12 : 6;
      const positions = new Float32Array(q * vPer * 2);
      const indices = new Uint32Array(q * iPer);
      const quadsUpTo = new Uint32Array(n + 1);
      let at = 0;
      for (let j = 0; j < q; j++) {
        const dx = x1[j] - x0[j];
        const dy = y1[j] - y0[j];
        const len = Math.hypot(dx, dy);
        const half = width(j) / 2;
        const ux = dx / len;
        const uy = dy / len;
        const e = cap === "square" ? half : 0;
        const nx = -uy * half;
        const ny = ux * half;
        const ax = x0[j] - ux * e;
        const ay = y0[j] - uy * e;
        const bx = x1[j] + ux * e;
        const by = y1[j] + uy * e;
        const p = j * vPer * 2;
        positions[p] = ax + nx;
        positions[p + 1] = ay + ny;
        positions[p + 2] = ax - nx;
        positions[p + 3] = ay - ny;
        positions[p + 4] = bx - nx;
        positions[p + 5] = by - ny;
        positions[p + 6] = bx + nx;
        positions[p + 7] = by + ny;
        const v = j * vPer;
        const ii = j * iPer;
        indices[ii] = v;
        indices[ii + 1] = v + 1;
        indices[ii + 2] = v + 2;
        indices[ii + 3] = v;
        indices[ii + 4] = v + 2;
        indices[ii + 5] = v + 3;
        if (cap === "point") {
          positions[p + 8] = ax - ux * half; // tail tip
          positions[p + 9] = ay - uy * half;
          positions[p + 10] = bx + ux * half; // head tip
          positions[p + 11] = by + uy * half;
          indices[ii + 6] = v + 4;
          indices[ii + 7] = v;
          indices[ii + 8] = v + 1;
          indices[ii + 9] = v + 3;
          indices[ii + 10] = v + 2;
          indices[ii + 11] = v + 5;
        }
      }
      // quadsUpTo[j] = segments belonging to entries before start + j
      for (let e = 0; e <= n; e++) {
        while (at < q && idx[at] < e) at++;
        quadsUpTo[e] = at;
      }
      const geometry = new MeshGeometry({ positions, indices });
      const mesh = new Mesh({ geometry, texture: Texture.WHITE });
      mesh.tint = color;
      mesh.alpha = alpha;
      mesh.eventMode = "none";
      layers.push({ mesh, geometry, quadsUpTo, total: q, indicesPer: iPer, lod });
    };

    const w = THREAD_WIDTH_MM;
    if (style.jumps) layer(jx0, jy0, jx1, jy1, jIdx, () => 0.1, "none", JUMP_COLOR, 0.55);
    if (style.realistic) {
      layer(sx0, sy0, sx1, sy1, sIdx, (j) => w * 1.4 * sk[j], "point", shade(hex, 0.7), 1, "near");
      layer(sx0, sy0, sx1, sy1, sIdx, (j) => w * 0.6 * sk[j], "square", shade(hex, 1.2), 1, "near");
      layer(sx0, sy0, sx1, sy1, sIdx, (j) => w * 1.1 * sk[j], "square", shade(hex, 0.95), 1, "far");
    } else {
      layer(sx0, sy0, sx1, sy1, sIdx, (j) => w * sk[j], "point", hexToNum(hex), 1);
    }
    const pad = w * 1.4 * maxK;
    return { start, end, layers, minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad, shownTo: -1 };
  }

  /** Reveal the first `count` plan entries. */
  setProgress(count: number): void {
    this.progress = count;
    for (const c of this.chunks) this.show(c);
  }

  /** Hide chunks that are off screen and pick the level of detail (call on every pan and zoom). */
  setViewRect(rect: Rect, zoom: number): void {
    this.view = rect;
    this.zoom = zoom;
    for (const c of this.chunks) this.show(c);
  }

  private show(c: Chunk): void {
    const count = this.progress;
    const revealed = count > c.start;
    const r = this.view;
    const inView = !r || (c.maxX >= r.minX && c.minX <= r.maxX && c.maxY >= r.minY && c.minY <= r.maxY);
    const upTo = Math.min(c.end, Math.floor(count));
    const near = this.zoom >= NEAR_ZOOM;
    for (const l of c.layers) {
      const quads = revealed ? l.quadsUpTo[Math.max(0, upTo - c.start)] : 0;
      const lodOk = l.lod === "both" || (l.lod === "near") === near;
      l.mesh.visible = quads > 0 && inView && lodOk;
      if (c.shownTo !== upTo && quads > 0) l.geometry.indexCount = quads === l.total ? 0 : quads * l.indicesPer; // 0 = all of them
    }
    c.shownTo = upTo;
  }
}
