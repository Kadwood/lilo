import type { ImageDataLike } from "../src/autodigitize/types";
import { DEFAULT_RUN_PARAMS, DEFAULT_SATIN_PARAMS, emptyDesign, makeFill, makeRun, makeSatin, type Design, type DesignObject, type Pt } from "../src/model";
import { ellipseNodes, nodesFromPolyline, rectNodes } from "../src/model";
import { getCatalogue, toDesignThread } from "../src/threads";

/** Deterministic pseudo-random numbers, so every run measures the same artwork. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type RGB = [number, number, number];

/** 1200 px logo, 6 flat colours on white: a roundel, a crest bar, big letter-like strokes and a star ring. */
export function logo1200(): ImageDataLike {
  const W = 1200;
  const data = new Uint8ClampedArray(W * W * 4);
  const cols: RGB[] = [
    [255, 255, 255],
    [27, 58, 138],
    [237, 23, 31],
    [232, 169, 0],
    [12, 12, 12],
    [30, 140, 70],
    [140, 60, 160],
  ];
  const at = (x: number, y: number): number => {
    const dx = x - 600;
    const dy = y - 600;
    const r = Math.hypot(dx, dy);
    if (r < 120) return 2;
    if (r < 200) return 3;
    if (r < 300) return 1;
    if (r < 330) return 4;
    if (r < 420) {
      // ring of 12 "stars"
      const a = Math.atan2(dy, dx);
      const k = Math.round((a / (2 * Math.PI)) * 12);
      const ca = (k / 12) * 2 * Math.PI;
      const sx = 600 + Math.cos(ca) * 370;
      const sy = 600 + Math.sin(ca) * 370;
      return Math.hypot(x - sx, y - sy) < 36 ? 5 : r > 400 ? 6 : 0;
    }
    // crest bars and letters in the corners
    if (y > 1080 && y < 1130 && x > 200 && x < 1000) return 2;
    if (x > 90 && x < 150 && y > 90 && y < 400) return 4;
    if (x > 90 && x < 330 && y > 90 && y < 140) return 4;
    return 0;
  };
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const c = cols[at(x, y)];
      const i = (y * W + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return { width: W, height: W, data };
}

/** 1200 px photo-like image: smooth gradients, soft blobs and noise (hundreds of colours). */
export function photo1200(): ImageDataLike {
  const W = 1200;
  const data = new Uint8ClampedArray(W * W * 4);
  const rand = rng(7);
  const blobs = Array.from({ length: 14 }, () => ({ x: rand() * W, y: rand() * W, r: 90 + rand() * 260, c: [rand() * 255, rand() * 255, rand() * 255] as RGB }));
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      let r = 40 + (x / W) * 120;
      let g = 60 + (y / W) * 110;
      let b = 150 - (x / W) * 60;
      for (const o of blobs) {
        const d = Math.hypot(x - o.x, y - o.y) / o.r;
        if (d < 1) {
          const w = (1 - d) * (1 - d) * 0.85;
          r += (o.c[0] - r) * w;
          g += (o.c[1] - g) * w;
          b += (o.c[2] - b) * w;
        }
      }
      const n = (rand() - 0.5) * 18;
      const i = (y * W + x) * 4;
      data[i] = Math.max(0, Math.min(255, r + n));
      data[i + 1] = Math.max(0, Math.min(255, g + n));
      data[i + 2] = Math.max(0, Math.min(255, b + n));
      data[i + 3] = 255;
    }
  }
  return { width: W, height: W, data };
}

/**
 * The stress design: 300 objects (fills, satin columns, runs), laid out over a 600 x 400 mm field
 * so the whole design is big, with 60k+ stitches. Same recipe every call.
 */
export function stressDesign(count = 300): Design {
  const cat = getCatalogue().threads;
  const threads = [0, 1, 2, 3, 4, 5].map((i) => toDesignThread(cat[Math.floor((i * cat.length) / 6)]));
  const d = emptyDesign();
  d.threads = threads;
  d.hoop = { ...d.hoop, widthMm: 300, heightMm: 200, name: "Stress" };
  const rand = rng(11);
  const objs: DesignObject[] = [];
  const cols = 20;
  for (let i = 0; i < count; i++) {
    const cx = -140 + (i % cols) * 14.5;
    const cy = -90 + Math.floor(i / cols) * 12.5;
    const th = threads[i % threads.length].id;
    const kind = i % 3;
    if (kind === 0) {
      const f = makeFill(`f${i}`, `Fill ${i}`, th, ellipseNodes(cx, cy, 5.8 + rand() * 1.2, 5.4 + rand() * 1.2));
      objs.push({ ...f, params: { ...f.params, rowSpacingMm: 0.2, stitchLengthMm: 2 } });
    } else if (kind === 1) {
      const strip: Pt[] = [];
      for (let k = 0; k <= 8; k++) {
        const x = cx - 5 + k * 1.25;
        const y = cy + Math.sin(k * 0.8 + i) * 2.5;
        strip.push([x, y - 2.2], [x, y + 2.2]);
      }
      const sa = makeSatin(`s${i}`, `Satin ${i}`, th, strip);
      objs.push({ ...sa, params: { ...sa.params, densityMm: 0.3 } });
    } else {
      const pts: Pt[] = [];
      for (let k = 0; k <= 14; k++) pts.push([cx - 6 + k * 0.85, cy + Math.cos(k * 0.9 + i) * 4]);
      objs.push(makeRun(`r${i}`, `Run ${i}`, th, nodesFromPolyline(pts), false, { ...DEFAULT_RUN_PARAMS, stitchLengthMm: 0.8, repeats: 1, type: "triple" }));
    }
  }
  d.objects = objs;
  void DEFAULT_SATIN_PARAMS;
  void rectNodes;
  return d;
}
