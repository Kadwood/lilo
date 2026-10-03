/**
 * Hoops: what a design is stitched in. Pure functions over the plain-JSON `Hoop` of the design model:
 * migrating old files, drawing sizes, "does it fit" and "smallest that fits", and the user's own hoops.
 * The real hoop data is in `library.ts`.
 */
import { DEFAULT_HOOP } from "../model";
import { findHoopSpec, hoopFromSpec, HOOP_LIBRARY, type HoopSpec } from "./library";
import type { Hoop, HoopClamp, HoopShape } from "../model/types";

export * from "./library";
export * from "./placement";

/** Smallest and largest sewing area side Lilo accepts (mm). */
export const HOOP_MIN_MM = 10;
export const HOOP_MAX_MM = 1000;
/** Space kept clear of the hoop edge: the presser foot and the frame need room. */
export const DEFAULT_SAFE_MARGIN_MM = 5;

export const CUSTOM_HOOPS_VERSION = 1;

export class HoopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HoopError";
  }
}

const SHAPES: readonly HoopShape[] = ["rect", "round", "oval", "cap"];
const CLAMPS: readonly HoopClamp[] = ["top", "right", "bottom", "left", "none"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const sane = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= HOOP_MIN_MM && n <= HOOP_MAX_MM;
const keepNum = (n: unknown, max: number): number | undefined => (typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= max ? n : undefined);

/** Does this stored hoop have a name and sane sizes? (Old files hold nothing else, and that is fine.) */
export const isUsableHoop = (h: unknown): h is Hoop => isObj(h) && typeof h.name === "string" && sane(h.widthMm) && sane(h.heightMm);

/**
 * Bring any stored hoop up to date. Files from before the hoop library hold only `{name, widthMm,
 * heightMm}`: those load as rectangles, and a name + size that matches a library hoop (the NV2700 pair)
 * picks up that hoop's id and look. Nonsense sizes fall back to the default hoop rather than failing
 * the open. Idempotent.
 */
export function normalizeHoop(input: unknown): Hoop {
  const o = isObj(input) ? input : {};
  if (!sane(o.widthMm) || !sane(o.heightMm)) return { ...DEFAULT_HOOP, shape: "rect" };
  const name = typeof o.name === "string" && o.name.trim() ? o.name : `${o.widthMm} x ${o.heightMm}`;
  const hoop: Hoop = { name, widthMm: o.widthMm, heightMm: o.heightMm };
  if (typeof o.id === "string" && o.id) hoop.id = o.id;
  if (typeof o.brand === "string" && o.brand) hoop.brand = o.brand;
  hoop.shape = SHAPES.includes(o.shape as HoopShape) ? (o.shape as HoopShape) : "rect";
  const r = keepNum(o.cornerRadiusMm, Math.min(o.widthMm, o.heightMm) / 2);
  if (r !== undefined) hoop.cornerRadiusMm = r;
  if (CLAMPS.includes(o.clamp as HoopClamp)) hoop.clamp = o.clamp as HoopClamp;
  const ow = keepNum(o.outerWidthMm, HOOP_MAX_MM * 2);
  const oh = keepNum(o.outerHeightMm, HOOP_MAX_MM * 2);
  if (ow !== undefined && oh !== undefined && ow >= o.widthMm && oh >= o.heightMm) {
    hoop.outerWidthMm = ow;
    hoop.outerHeightMm = oh;
  }
  if (hoop.shape === "round") hoop.heightMm = hoop.widthMm;
  if (!hoop.id) {
    // an old file: same name and size as a library hoop = that hoop
    const spec = HOOP_LIBRARY.find((s) => s.name === hoop.name && s.widthMm === hoop.widthMm && s.heightMm === hoop.heightMm);
    if (spec) return { ...hoopFromSpec(spec), ...hoop, id: spec.id, brand: spec.brand };
  }
  return hoop;
}

/** The sewing area drawn as the user sees it: `rotated` swaps width and height. */
export const rotateHoop = (h: Hoop): Hoop => ({
  ...h,
  widthMm: h.heightMm,
  heightMm: h.widthMm,
  ...(h.outerWidthMm !== undefined && h.outerHeightMm !== undefined ? { outerWidthMm: h.outerHeightMm, outerHeightMm: h.outerWidthMm } : {}),
  ...(h.clamp && h.clamp !== "none" ? { clamp: ({ top: "right", right: "bottom", bottom: "left", left: "top" } as const)[h.clamp] } : {}),
});

/** Width of the frame ring around the sewing area when the real outer size is not known. */
export const ringMm = (h: Hoop): number => (h.shape === "cap" ? 8 : Math.max(9, Math.min(20, 0.16 * Math.min(h.widthMm, h.heightMm))));

/** Outer size of the frame (known, or the sewing area plus a ring all round). */
export function outerSize(h: Hoop): { w: number; h: number } {
  if (h.outerWidthMm !== undefined && h.outerHeightMm !== undefined) return { w: h.outerWidthMm, h: h.outerHeightMm };
  const r = ringMm(h);
  return { w: h.widthMm + 2 * r, h: h.heightMm + 2 * r };
}

/** Sewing area in mm². */
export const hoopArea = (h: Hoop): number => (h.shape === "round" || h.shape === "oval" ? (Math.PI / 4) * h.widthMm * h.heightMm : h.widthMm * h.heightMm);

export interface Size {
  w: number;
  h: number;
}

/**
 * Overflow of a design of `size` (centred in the hoop) past the sewing area, in mm along each axis,
 * keeping `marginMm` clear of the edge. 0 and 0 = it fits.
 */
export function hoopOverflow(size: Size, hoop: Hoop, marginMm = 0): { x: number; y: number } {
  const aw = Math.max(0.1, hoop.widthMm - 2 * marginMm);
  const ah = Math.max(0.1, hoop.heightMm - 2 * marginMm);
  if (hoop.shape === "round" || hoop.shape === "oval") {
    const s = Math.hypot(size.w / aw, size.h / ah);
    return s <= 1 ? { x: 0, y: 0 } : { x: size.w - size.w / s, y: size.h - size.h / s };
  }
  const r = Math.max(0, (hoop.cornerRadiusMm ?? 0) - marginMm);
  let x = Math.max(0, size.w - aw);
  let y = Math.max(0, size.h - ah);
  if (x === 0 && y === 0 && r > 0) {
    // the box corner must also clear the rounded corner
    const cx = aw / 2 - r;
    const cy = ah / 2 - r;
    const px = size.w / 2 - cx;
    const py = size.h / 2 - cy;
    if (px > 0 && py > 0) {
      const d = Math.hypot(px, py);
      if (d > r) {
        x = (d - r) * (px / d) * 2;
        y = (d - r) * (py / d) * 2;
      }
    }
  }
  return { x, y };
}

export const fitsInHoop = (size: Size, hoop: Hoop, marginMm = 0): boolean => {
  const o = hoopOverflow(size, hoop, marginMm);
  return o.x <= 1e-9 && o.y <= 1e-9;
};

export type AutoPick =
  | { kind: "fit"; hoop: Hoop; spec?: HoopSpec; /** The hoop is turned a quarter to fit. */ rotated: boolean }
  | { kind: "none"; /** The biggest candidate, which came closest. */ closest: Hoop | null; /** How far the design overshoots it, mm. */ overflowMm: { x: number; y: number } };

export interface AutoPickOptions {
  marginMm?: number;
  /** Also try each hoop turned a quarter (default true). */
  allowRotate?: boolean;
}

/**
 * The smallest hoop of `candidates` the design fits in (by sewing area; verified library entries win a
 * tie). Cap frames are left out: they only suit a cap. When nothing fits, `closest` is the largest hoop
 * and `overflowMm` how far the design overshoots it, so the caller can say "needs re-hooping".
 */
export function smallestFittingHoop(size: Size, candidates: readonly Hoop[], opts: AutoPickOptions = {}): AutoPick {
  const margin = opts.marginMm ?? 0;
  const pool = candidates.filter((c) => c.shape !== "cap");
  let best: { hoop: Hoop; rotated: boolean; area: number } | null = null;
  for (const c of pool) {
    const tries: [Hoop, boolean][] = [[c, false]];
    if (opts.allowRotate !== false && c.widthMm !== c.heightMm) tries.push([rotateHoop(c), true]);
    for (const [h, rotated] of tries) {
      if (!fitsInHoop(size, h, margin)) continue;
      const area = hoopArea(h);
      const verifiedOf = (x: Hoop) => findHoopSpec(x.id)?.verified === true;
      const better =
        !best || area < best.area - 1e-6 || (Math.abs(area - best.area) <= 1e-6 && ((verifiedOf(h) && !verifiedOf(best.hoop)) || (rotated === false && best.rotated)));
      if (better) best = { hoop: h, rotated, area };
    }
  }
  if (best) return { kind: "fit", hoop: best.hoop, spec: findHoopSpec(best.hoop.id), rotated: best.rotated };
  if (pool.length === 0) return { kind: "none", closest: null, overflowMm: { x: size.w, y: size.h } };
  // the candidate with the least overshoot (either way round)
  let closest = pool[0];
  let least = Infinity;
  let over = { x: size.w, y: size.h };
  for (const c of pool) {
    for (const h of opts.allowRotate !== false ? [c, rotateHoop(c)] : [c]) {
      const o = hoopOverflow(size, h, margin);
      const total = o.x + o.y;
      if (total < least) {
        least = total;
        closest = h;
        over = o;
      }
    }
  }
  return { kind: "none", closest, overflowMm: over };
}

// ---- the user's own hoops ----------------------------------------------------------------------

/** What `~/Documents/Lilo/hoops.json` holds. */
export interface CustomHoops {
  version: typeof CUSTOM_HOOPS_VERSION;
  hoops: Hoop[];
}

export const emptyCustomHoops = (): CustomHoops => ({ version: CUSTOM_HOOPS_VERSION, hoops: [] });

export interface CustomHoopInput {
  name: string;
  widthMm: number;
  heightMm: number;
  shape: Exclude<HoopShape, "cap"> | "cap";
  cornerRadiusMm?: number;
}

/** Problems with a custom-hoop form (empty = fine). */
export function validateCustomHoop(input: CustomHoopInput, existing: readonly Hoop[] = [], editingId?: string): string[] {
  const problems: string[] = [];
  const name = input.name.trim();
  if (!name) problems.push("Give the hoop a name.");
  else if (name.length > 60) problems.push("Keep the name under 60 characters.");
  else if (existing.some((h) => h.id !== editingId && h.name.toLowerCase() === name.toLowerCase())) problems.push("You already have a hoop with that name.");
  if (!sane(input.widthMm)) problems.push(`Width must be between ${HOOP_MIN_MM} and ${HOOP_MAX_MM} mm.`);
  if (!sane(input.heightMm)) problems.push(`Height must be between ${HOOP_MIN_MM} and ${HOOP_MAX_MM} mm.`);
  if (input.shape === "round" && sane(input.widthMm) && sane(input.heightMm) && input.widthMm !== input.heightMm) problems.push("A round hoop has the same width and height. Choose oval for an ellipse.");
  if (!SHAPES.includes(input.shape)) problems.push("Choose a shape.");
  const r = input.cornerRadiusMm ?? 0;
  if (!Number.isFinite(r) || r < 0) problems.push("The corner radius can't be negative.");
  else if (sane(input.widthMm) && sane(input.heightMm) && r > Math.min(input.widthMm, input.heightMm) / 2) problems.push("The corner radius can be at most half the smaller side.");
  return problems;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "hoop";

/** A new custom hoop from the form. Throws `HoopError` listing what is wrong. */
export function makeCustomHoop(input: CustomHoopInput, existing: readonly Hoop[] = [], editingId?: string): Hoop {
  const problems = validateCustomHoop(input, existing, editingId);
  if (problems.length) throw new HoopError(problems.join(" "));
  let id = editingId;
  if (!id) {
    const taken = new Set(existing.map((h) => h.id));
    const base = `custom-${slug(input.name)}`;
    id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  }
  const hoop: Hoop = { id, name: input.name.trim(), widthMm: input.widthMm, heightMm: input.shape === "round" ? input.widthMm : input.heightMm, shape: input.shape, brand: "My custom hoops", clamp: "right" };
  if (input.shape === "rect" || input.shape === "cap") hoop.cornerRadiusMm = input.cornerRadiusMm ?? 6;
  return hoop;
}

/** Add, replace (same id) or remove a custom hoop. Returns a new list. */
export function upsertCustomHoop(list: readonly Hoop[], hoop: Hoop): Hoop[] {
  return list.some((h) => h.id === hoop.id) ? list.map((h) => (h.id === hoop.id ? hoop : h)) : [...list, hoop];
}
export const removeCustomHoop = (list: readonly Hoop[], id: string): Hoop[] => list.filter((h) => h.id !== id);

export const exportCustomHoops = (hoops: readonly Hoop[]): string => JSON.stringify({ version: CUSTOM_HOOPS_VERSION, hoops }, null, 2);

/** Read `hoops.json`. Throws `HoopError` for text that is not a hoops file; skips entries that are unusable. */
export function importCustomHoops(text: string): CustomHoops {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HoopError("The hoops file is not valid JSON.");
  }
  if (!isObj(raw) || !Array.isArray(raw.hoops)) throw new HoopError("The hoops file has no list of hoops.");
  if (typeof raw.version !== "number" || raw.version > CUSTOM_HOOPS_VERSION) throw new HoopError("The hoops file was saved by a newer Lilo.");
  const seen = new Set<string>();
  const hoops: Hoop[] = [];
  for (const item of raw.hoops) {
    if (!isObj(item) || typeof item.id !== "string" || !item.id.startsWith("custom-") || seen.has(item.id)) continue;
    if (!sane(item.widthMm) || !sane(item.heightMm)) continue;
    seen.add(item.id);
    hoops.push({ ...normalizeHoop(item), brand: "My custom hoops" });
  }
  return { version: CUSTOM_HOOPS_VERSION, hoops };
}
