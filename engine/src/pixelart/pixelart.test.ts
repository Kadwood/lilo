import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_HOOP, type Thread } from "../model";
import { readPes } from "../pes";
import { planStats, validatePlan } from "../stitch";
import { getCatalogue, toDesignThread } from "../threads";
import { addEntry, emptyShelf, snapPalette } from "../threads/shelf";
import { renderPlanPng } from "../../test/render";
import { FIXTURES } from "../../test/fixtures/fixtures";
import {
  DEFAULT_CELL_MM,
  DEFAULT_GRID_SIZE,
  addPixelThread,
  createPixelArt,
  floodFillPixels,
  getPixel,
  pickPixelThread,
  pixelArtFromImage,
  pixelArtToPes,
  pixelArtToStitchPlan,
  pixelRuns,
  prunePixelThreads,
  resizePixelArt,
  setPixel,
  setPixels,
  usedPixelThreads,
  validatePixelArt,
  type PixelArt,
  type PixelStyle,
} from "./index";

const cat = getCatalogue().threads;
const t = (name: string): Thread => toDesignThread(cat.find((c) => c.name === name)!);
const red = t("Red");
const blue = t("Blue");
const black = t("Black");

/** A 16x16 heart (red) with a blue outline dot and black eyes, from ASCII. */
function heart(): PixelArt {
  const rows = [
    "................",
    "..RRRR....RRRR..",
    ".RRRRRR..RRRRRR.",
    "RRRRRRRRRRRRRRRR",
    "RRRKRRRRRRRRKRRR",
    "RRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRR",
    ".RRRRRRRRRRRRRR.",
    "..RRRRRRRRRRRR..",
    "...RRRRRRRRRR...",
    "....RRRRRRRR....",
    ".....RRRRRR.....",
    "......RRRR......",
    ".......BB.......",
    "................",
    "................",
  ];
  let a = createPixelArt(16, 16);
  for (const th of [red, blue, black]) a = addPixelThread(a, th);
  const id = { R: red.id, B: blue.id, K: black.id } as Record<string, string>;
  rows.forEach((row, y) => [...row].forEach((ch, x) => (a = ch === "." ? a : setPixel(a, x, y, id[ch]))));
  return a;
}

describe("pixel grid", () => {
  it("defaults to 32x32 cells of 2.5 mm", () => {
    const a = createPixelArt();
    expect([a.width, a.height, a.cellMm]).toEqual([DEFAULT_GRID_SIZE, DEFAULT_GRID_SIZE, DEFAULT_CELL_MM]);
    expect(a.cells).toHaveLength(1024);
    expect(a.cells.every((c) => c === null)).toBe(true);
  });

  it("pencil, erase, eyedropper and bucket fill work and are immutable", () => {
    let a = addPixelThread(addPixelThread(createPixelArt(4, 4), red), blue);
    const b = setPixel(a, 1, 1, red.id);
    expect(getPixel(a, 1, 1)).toBeNull();
    expect(getPixel(b, 1, 1)).toBe(red.id);
    expect(pickPixelThread(b, 1, 1)?.name).toBe("Red");
    expect(setPixel(b, 1, 1, red.id)).toBe(b); // no-op keeps identity
    expect(setPixel(b, 99, 99, red.id)).toBe(b); // out of range ignored
    expect(getPixel(setPixel(b, 1, 1, null), 1, 1)).toBeNull();
    expect(() => setPixel(a, 0, 0, "nope")).toThrow(/palette/);
    // fill a region bounded by a wall
    a = setPixels(a, [[2, 0], [2, 1], [2, 2], [2, 3]], blue.id);
    const f = floodFillPixels(a, 0, 0, red.id);
    expect(f.cells.filter((c) => c === red.id)).toHaveLength(8); // the left two columns only
    expect(f.cells.filter((c) => c === null)).toHaveLength(4); // right column untouched
    expect(floodFillPixels(f, 0, 0, null).cells.filter((c) => c === null)).toHaveLength(12);
  });

  it("resizes keeping content top-left, tracks used threads, prunes and validates", () => {
    const a = heart();
    const small = resizePixelArt(a, 8, 8);
    expect(small.cells).toHaveLength(64);
    expect(getPixel(small, 3, 4)).toBe(black.id);
    const big = resizePixelArt(a, 40, 20);
    expect(getPixel(big, 3, 4)).toBe(black.id);
    expect(getPixel(big, 30, 10)).toBeNull();
    const used = usedPixelThreads(a);
    expect(used[0].thread.name).toBe("Red");
    expect(used.map((u) => [u.thread.name, u.cells])).toEqual([["Red", 136], ["Blue", 2], ["Black", 2]]);
    const only = prunePixelThreads(resizePixelArt(a, 16, 10));
    expect(only.threads.map((x) => x.name)).toEqual(["Red", "Black"]);
    expect(() => validatePixelArt({ ...a, cells: a.cells.slice(1) })).toThrow(/wrong size/);
    expect(() => validatePixelArt({ ...a, threads: [] })).toThrow(/unknown thread/);
    expect(() => createPixelArt(0, 5)).toThrow();
    expect(() => createPixelArt(5, 5, 0.1)).toThrow();
  });

  it("merges horizontal runs per colour", () => {
    let a = addPixelThread(addPixelThread(createPixelArt(6, 2), red), blue);
    a = setPixels(a, [[0, 0], [1, 0], [2, 0], [4, 0], [5, 0]], red.id);
    a = setPixel(a, 3, 0, blue.id);
    a = setPixels(a, [[0, 1], [1, 1]], blue.id);
    expect(pixelRuns(a)).toEqual([
      { threadId: red.id, row: 0, col: 0, length: 3 },
      { threadId: blue.id, row: 0, col: 3, length: 1 },
      { threadId: red.id, row: 0, col: 4, length: 2 },
      { threadId: blue.id, row: 1, col: 0, length: 2 },
    ]);
  });
});

describe("pixel art stitches", () => {
  const styles: PixelStyle[] = ["tatami", "cross", "satin"];

  for (const style of styles) {
    it(`${style}: colour-ordered, in-bounds, valid, round-trips through PES`, () => {
      const art = heart();
      const raw = pixelArtToStitchPlan(art, { style });
      // each thread once, biggest first -> 2 colour changes for 3 colours
      expect(raw.threads.map((x) => x.name)).toEqual(["Red", "Black", "Blue"]);
      expect(raw.stitches.filter((s) => s.type === "colorChange")).toHaveLength(2);
      // all needles inside the grid (plus pull comp)
      const half = (16 * DEFAULT_CELL_MM) / 2 + 0.2;
      for (const s of raw.stitches) {
        expect(Math.abs(s.x)).toBeLessThanOrEqual(half);
        expect(Math.abs(s.y)).toBeLessThanOrEqual(half);
      }
      const { plan, warnings } = validatePlan(raw, DEFAULT_HOOP);
      expect(warnings.filter((w) => w.code === "outside-hoop" || w.code === "stitch-too-long")).toEqual([]);
      const res = pixelArtToPes(art, DEFAULT_HOOP, { style });
      const back = readPes(res.pes);
      expect(back.colors.length).toBe(3);
      expect(back.stitches.filter((s) => s.type === "stitch").length).toBe(planStats(res.plan).stitchCount);
      expect(planStats(plan).widthMm).toBeGreaterThan(30);
      expect(planStats(plan).widthMm).toBeLessThan(41);
    });
  }

  it("sews a colour in one block, however many runs it has", () => {
    const raw = pixelArtToStitchPlan(heart());
    const blocks = new Map<number, number>();
    for (const s of raw.stitches) if (s.type === "stitch") blocks.set(s.threadIndex, (blocks.get(s.threadIndex) ?? 0) + 1);
    expect([...blocks.keys()]).toEqual([0, 1, 2]);
  });

  it("tatami: rows follow the spacing and no stitch is longer than the stitch length", () => {
    let a = addPixelThread(createPixelArt(4, 1), red);
    a = setPixels(a, [[0, 0], [1, 0], [2, 0], [3, 0]], red.id);
    const raw = pixelArtToStitchPlan(a, { style: "tatami", rowSpacingMm: 0.5, stitchLengthMm: 3, pullCompMm: 0 });
    const ys = [...new Set(raw.stitches.map((s) => s.y.toFixed(3)))];
    expect(ys).toHaveLength(5); // 2.5 mm / 0.5 mm
    let prev = raw.stitches[0];
    for (const s of raw.stitches.slice(1)) {
      if (s.type === "stitch" && prev.type === "stitch" && s.y === prev.y) expect(Math.abs(s.x - prev.x)).toBeLessThanOrEqual(3 + 1e-9);
      prev = s;
    }
    // spans exactly the run width
    const xs = raw.stitches.map((s) => s.x);
    expect(Math.min(...xs)).toBeCloseTo(-5);
    expect(Math.max(...xs)).toBeCloseTo(5);
  });

  it("cross: four needle points per lone cell, an X across the cell", () => {
    let a = addPixelThread(createPixelArt(3, 3), red);
    a = setPixel(a, 1, 1, red.id);
    const raw = pixelArtToStitchPlan(a, { style: "cross" });
    const pts = raw.stitches.filter((s) => s.type === "stitch").map((s) => [s.x, s.y]);
    expect(pts).toHaveLength(4);
    const c = DEFAULT_CELL_MM;
    const x0 = -1.5 * c + c;
    const y0 = x0;
    // "/" then "\" : corners of the cell
    expect(pts[0]).toEqual([x0, y0 + c]);
    expect(pts[1]).toEqual([x0 + c, y0]);
    expect(pts[2]).toEqual([x0 + c, y0 + c]);
    expect(pts[3]).toEqual([x0, y0]);
  });

  it("satin: zig-zags between the cell's top and bottom edge at the density", () => {
    let a = addPixelThread(createPixelArt(2, 1), red);
    a = setPixels(a, [[0, 0], [1, 0]], red.id);
    const raw = pixelArtToStitchPlan(a, { style: "satin", underlay: false, pullCompMm: 0, satinDensityMm: 0.5 });
    const st = raw.stitches.filter((s) => s.type === "stitch");
    const ys = [...new Set(st.map((s) => s.y))].sort((p, q) => p - q);
    expect(ys[0]).toBeCloseTo(-1.25 - 0 + 0);
    // underlay-less: a first point on the centre line then the zigzag
    expect(st.slice(1).every((s, i) => i % 2 === 0 || s.y !== st[i].y)).toBe(true);
    expect(st.length).toBeGreaterThan(5 / 0.5);
  });

  it("routes nearest-first: total jump length stays small versus reading order", () => {
    // two far-apart islands of one colour, each of several rows: reading order would zig-zag between them
    let a = addPixelThread(createPixelArt(24, 6), red);
    for (let y = 0; y < 6; y++) for (const x of [0, 1, 2, 21, 22, 23]) a = setPixel(a, x, y, red.id);
    const raw = pixelArtToStitchPlan(a);
    const jumps = raw.stitches.filter((s) => s.type === "jump");
    // 12 runs: only one long crossing between islands, the rest are short hops
    const longHops = jumps.filter((j) => {
      const at = raw.stitches.indexOf(j);
      if (at === 0) return false; // the first jump is from the origin
      const prev = raw.stitches[at - 1];
      return Math.hypot(j.x - prev.x, j.y - prev.y) > 20;
    });
    expect(longHops).toHaveLength(1);
  });

  it("ties and trims come from validatePlan", () => {
    const art = heart();
    const raw = pixelArtToStitchPlan(art);
    const { plan } = validatePlan(raw, DEFAULT_HOOP);
    expect(plan.stitches.some((s) => s.lock)).toBe(true);
    expect(plan.stitches.some((s) => s.type === "trim")).toBe(true);
    expect(plan.stitches.filter((s) => s.type === "stitch").length).toBeGreaterThan(raw.stitches.filter((s) => s.type === "stitch").length);
  });

  it("an empty grid gives an empty plan with a warning; bad settings throw", () => {
    const p = pixelArtToStitchPlan(createPixelArt(4, 4));
    expect(p.stitches).toEqual([]);
    expect(p.warnings[0].code).toBe("empty");
    expect(() => pixelArtToStitchPlan(heart(), { rowSpacingMm: 0 })).toThrow();
    expect(() => pixelArtToStitchPlan({ ...heart(), threads: [] })).toThrow(/unknown thread/);
  });

  it("large grids stay fast (32x32 checkerboard, 2 colours)", () => {
    let a = addPixelThread(addPixelThread(createPixelArt(), red), blue);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) a = setPixel(a, x, y, (x + y) % 2 ? red.id : blue.id);
    const t0 = Date.now();
    const raw = pixelArtToStitchPlan(a, { style: "cross" });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(raw.stitches.filter((s) => s.type === "stitch").length).toBe(1024 * 4);
  });
});

describe("pixel art from an image", () => {
  const solid = (w: number, h: number, f: (x: number, y: number) => [number, number, number, number]) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
    return { width: w, height: h, data };
  };

  it("downsamples, snaps to the palette and keeps transparency empty", () => {
    const img = solid(64, 64, (x, y) => (x < 8 ? [0, 0, 0, 0] : x < 36 ? [237, 23, 31, 255] : [10, 85, 163, 255]));
    const art = pixelArtFromImage(img, { palette: cat, maxCells: 16 });
    expect([art.width, art.height]).toEqual([16, 16]);
    expect(getPixel(art, 0, 5)).toBeNull();
    expect(pickPixelThread(art, 6, 5)?.name).toBe("Red");
    expect(pickPixelThread(art, 15, 5)?.name).toBe("Blue");
    expect(art.threads.map((x) => x.name).sort()).toEqual(["Blue", "Red"]);
    validatePixelArt(art);
  });

  it("keeps the aspect ratio and honours an exact size", () => {
    const img = solid(100, 50, () => [255, 255, 255, 255]);
    const wide = pixelArtFromImage(img, { palette: cat });
    expect([wide.width, wide.height]).toEqual([32, 16]);
    const exact = pixelArtFromImage(img, { palette: cat, width: 10, height: 10 });
    expect([exact.width, exact.height]).toEqual([10, 10]);
  });

  it("caps the colour count by folding rare colours into near ones", () => {
    const img = solid(32, 32, (x) => [(x * 8) % 256, (x * 31) % 256, (x * 57) % 256, 255]);
    const free = pixelArtFromImage(img, { palette: cat, maxColors: 20 });
    const capped = pixelArtFromImage(img, { palette: cat, maxColors: 3 });
    expect(free.threads.length).toBeGreaterThan(3);
    expect(capped.threads.length).toBeLessThanOrEqual(3);
    expect(capped.cells.every((c) => c !== null)).toBe(true);
    validatePixelArt(capped);
  });

  it("snaps to the My Threads shelf first, and removes a corner background", () => {
    let shelf = emptyShelf();
    shelf = addEntry(shelf, { brand: "Madeira", line: "Rayon", code: "1147", name: "My crimson", hex: "#b01030" });
    shelf = addEntry(shelf, { brand: "Madeira", line: "Rayon", code: "1000", name: "My white", hex: "#ffffff" });
    const img = solid(32, 32, (x, y) => (x > 8 && x < 24 && y > 8 && y < 24 ? [200, 20, 50, 255] : [250, 250, 250, 255]));
    const art = pixelArtFromImage(img, { palette: snapPalette(shelf, cat), removeBackground: true });
    expect(art.threads.map((x) => x.name)).toEqual(["My crimson"]);
    expect(getPixel(art, 0, 0)).toBeNull();
    expect(getPixel(art, 16, 16)).not.toBeNull();
    expect(() => pixelArtFromImage(img, { palette: [] })).toThrow(/threads/);
  });

  it("imports the badge fixture end to end", () => {
    const badge = FIXTURES.find((f) => f.name === "badge")!.make();
    const art = pixelArtFromImage(badge, { palette: cat, maxCells: 32, maxColors: 5 });
    expect(art.threads.length).toBeGreaterThan(1);
    const { plan } = pixelArtToPes(art, DEFAULT_HOOP);
    expect(planStats(plan).stitchCount).toBeGreaterThan(1000);
  });
});

// Visual check: M5_SHOTS=<dir> writes a PNG per style plus the imported badge.
describe.skipIf(!process.env.M5_SHOTS)("pixel art renders", () => {
  it("writes plan renders", () => {
    const dir = process.env.M5_SHOTS!;
    mkdirSync(dir, { recursive: true });
    for (const style of ["tatami", "cross", "satin"] as const) {
      const { plan } = pixelArtToPes(heart(), DEFAULT_HOOP, { style });
      writeFileSync(join(dir, `pixelart-heart-${style}.png`), renderPlanPng(plan, 14));
    }
    const badge = FIXTURES.find((f) => f.name === "badge")!.make();
    const art = pixelArtFromImage(badge, { palette: cat, maxCells: 32, maxColors: 5 });
    for (const style of ["tatami", "cross"] as const) {
      const { plan } = pixelArtToPes(art, DEFAULT_HOOP, { style });
      writeFileSync(join(dir, `pixelart-badge-${style}.png`), renderPlanPng(plan, 8));
    }
  });
});
