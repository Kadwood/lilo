/**
 * "My Threads": the spools the user actually owns. A plain-JSON model with pure functions (every
 * edit returns a new shelf), so it drops into Zustand/Immer, the project file and a Web Worker.
 *
 * Identity is (brand, line, code), compared loosely (case, spaces, leading zeros), so scanning
 * "Madeira 1000" twice, or adding it by hand after the catalogue, is one entry with a higher `qty`.
 */
import { hexToRgb, rgbToLab, type RGB } from "../color";
import { matchCode, nearestThread, normalizeCode, type ThreadEntry } from "../threads";

export const SHELF_VERSION = 1;

export type ShelfSource = "catalogue" | "ocr" | "manual";

export interface ShelfEntry {
  brand: string;
  line: string;
  code: string;
  name: string;
  /** "#rrggbb". */
  hex: string;
  /** CIE L*a*b* (D65) of `hex`. */
  lab: [number, number, number];
  weight?: number;
  material?: string;
  /** How many spools. */
  qty?: number;
  notes?: string;
  /** How the spool got on the shelf. */
  source: ShelfSource;
  /** ISO 8601 timestamp. */
  addedAt: string;
}

export interface Shelf {
  version: typeof SHELF_VERSION;
  entries: ShelfEntry[];
}

export class ShelfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShelfError";
  }
}

export const emptyShelf = (): Shelf => ({ version: SHELF_VERSION, entries: [] });

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The identity string of a spool: same key = same entry. */
export const shelfKey = (e: Pick<ShelfEntry, "brand" | "line" | "code">): string =>
  `${norm(e.brand)}|${norm(e.line)}|${normalizeCode(e.code)}`;

/** What `addEntry` accepts: everything but the derived fields. */
export interface NewShelfEntry {
  brand: string;
  line?: string;
  code: string;
  name?: string;
  hex: string;
  lab?: [number, number, number];
  weight?: number;
  material?: string;
  qty?: number;
  notes?: string;
  source?: ShelfSource;
  addedAt?: string;
}

function complete(input: NewShelfEntry, now: string): ShelfEntry {
  const brand = input.brand.trim();
  const code = input.code.trim();
  if (!brand) throw new ShelfError("A spool needs a brand.");
  if (!code) throw new ShelfError("A spool needs a code.");
  let rgb: RGB;
  try {
    rgb = hexToRgb(input.hex);
  } catch {
    throw new ShelfError(`Bad colour for ${brand} ${code}: ${input.hex}`);
  }
  const hex = "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
  if (input.qty !== undefined && !(Number.isFinite(input.qty) && input.qty >= 0)) {
    throw new ShelfError(`Bad quantity for ${brand} ${code}: ${input.qty}`);
  }
  const e: ShelfEntry = {
    brand,
    line: (input.line ?? "").trim(),
    code,
    name: (input.name ?? "").trim() || `${brand} ${code}`,
    hex,
    lab: input.lab ?? rgbToLab(rgb[0], rgb[1], rgb[2]),
    source: input.source ?? "manual",
    addedAt: input.addedAt ?? now,
  };
  if (input.weight !== undefined) e.weight = input.weight;
  if (input.material) e.material = input.material;
  if (input.qty !== undefined) e.qty = input.qty;
  if (input.notes?.trim()) e.notes = input.notes.trim();
  return e;
}

/** Fold `b` into `a` (same spool): quantities add, the earlier add date wins, gaps are filled. */
function mergeEntries(a: ShelfEntry, b: ShelfEntry): ShelfEntry {
  const out: ShelfEntry = { ...a };
  if (a.qty !== undefined || b.qty !== undefined) out.qty = (a.qty ?? 1) + (b.qty ?? 1);
  if (b.addedAt < a.addedAt) out.addedAt = b.addedAt;
  out.weight ??= b.weight;
  out.material ??= b.material;
  if (out.weight === undefined) delete out.weight;
  if (out.material === undefined) delete out.material;
  const notes = [a.notes, b.notes].filter((n): n is string => !!n);
  const uniq = [...new Set(notes)];
  if (uniq.length) out.notes = uniq.join("\n");
  if (!a.name || a.name === `${a.brand} ${a.code}`) out.name = b.name;
  return out;
}

/** Insert entries, merging any that share a key with an existing (or earlier) entry. */
function withEntries(shelf: Shelf, incoming: ShelfEntry[]): Shelf {
  const out = [...shelf.entries];
  const at = new Map(out.map((e, i) => [shelfKey(e), i]));
  for (const e of incoming) {
    const k = shelfKey(e);
    const i = at.get(k);
    if (i === undefined) {
      at.set(k, out.length);
      out.push(e);
    } else {
      out[i] = mergeEntries(out[i], e);
    }
  }
  return { version: SHELF_VERSION, entries: out };
}

/** Add a spool. A spool already on the shelf (same brand/line/code) gets its quantity bumped instead. */
export function addEntry(shelf: Shelf, input: NewShelfEntry, now: Date = new Date()): Shelf {
  return withEntries(shelf, [complete(input, now.toISOString())]);
}

/** Add a catalogue row to the shelf. */
export function addFromCatalogue(shelf: Shelf, t: ThreadEntry, extra: Pick<NewShelfEntry, "qty" | "notes"> = {}, now?: Date): Shelf {
  return addEntry(
    shelf,
    {
      brand: t.brand,
      line: t.line,
      code: t.code,
      name: t.name,
      hex: t.hex,
      lab: t.lab,
      weight: t.weight,
      material: t.material,
      ...extra,
      source: "catalogue",
    },
    now,
  );
}

export function findEntry(shelf: Shelf, key: string): ShelfEntry | undefined {
  return shelf.entries.find((e) => shelfKey(e) === key);
}

/** Remove the entry with this `shelfKey`. Unknown keys are a no-op. */
export function removeEntry(shelf: Shelf, key: string): Shelf {
  return { version: SHELF_VERSION, entries: shelf.entries.filter((e) => shelfKey(e) !== key) };
}

export type ShelfPatch = Partial<Omit<NewShelfEntry, "addedAt">>;

/**
 * Edit an entry. Changing brand/line/code (or the colour) is fine; if the new identity collides with
 * another entry the two merge. Unknown keys throw.
 */
export function updateEntry(shelf: Shelf, key: string, patch: ShelfPatch): Shelf {
  const i = shelf.entries.findIndex((e) => shelfKey(e) === key);
  if (i < 0) throw new ShelfError(`No shelf entry ${key}`);
  const cur = shelf.entries[i];
  const colourChanged = patch.hex !== undefined && patch.hex !== cur.hex;
  const next = complete(
    {
      ...cur,
      ...patch,
      lab: colourChanged && patch.lab === undefined ? undefined : (patch.lab ?? cur.lab),
      addedAt: cur.addedAt,
    },
    cur.addedAt,
  );
  const rest = shelf.entries.filter((_, j) => j !== i);
  const before = rest.slice(0, i);
  const after = rest.slice(i);
  // Rebuild in place so the entry keeps its position unless it merges into another one.
  const merged = withEntries({ version: SHELF_VERSION, entries: before }, [next]);
  return withEntries(merged, after);
}

/** Union of two shelves (duplicates merge). */
export function mergeShelves(a: Shelf, b: Shelf): Shelf {
  return withEntries(a, b.entries);
}

/** The shelf as `ThreadEntry` rows, so it can feed anything that takes a palette (`nearestThread`, autodigitize). */
export function shelfPalette(shelf: Shelf): ThreadEntry[] {
  return shelf.entries.map((e) => ({
    brand: e.brand,
    line: e.line,
    code: e.code,
    name: e.name,
    hex: e.hex,
    lab: e.lab,
    ...(e.weight !== undefined ? { weight: e.weight } : {}),
    ...(e.material ? { material: e.material } : {}),
    source: "my-threads",
    licence: "user",
  }));
}

/** Entries whose code matches `code` (loosely). Handy for "do I already own this?". */
export const shelfMatches = (shelf: Shelf, code: string): ShelfEntry[] => matchCode(shelf.entries, code);

// ---- import / export -----------------------------------------------------------------------

/** Pretty JSON, for a download or a backup. */
export function exportShelf(shelf: Shelf): string {
  return JSON.stringify({ version: SHELF_VERSION, entries: shelf.entries }, null, 2) + "\n";
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Parse an exported shelf (JSON text or an already-parsed value). Rows are validated one by one;
 * bad rows throw a `ShelfError` naming the row rather than being silently dropped. Duplicates inside
 * the file merge. Accepts a bare array of entries too.
 */
export function importShelf(input: string | unknown): Shelf {
  let data: unknown = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch {
      throw new ShelfError("That file is not valid JSON.");
    }
  }
  const rows = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.entries) ? data.entries : null;
  if (!rows) throw new ShelfError("That file is not a Lilo thread shelf.");
  if (isObj(data) && typeof data.version === "number" && data.version > SHELF_VERSION) {
    throw new ShelfError(`This shelf was saved by a newer Lilo (version ${data.version}).`);
  }
  const now = new Date().toISOString();
  const entries = rows.map((r, i): ShelfEntry => {
    if (!isObj(r) || typeof r.brand !== "string" || typeof r.code !== "string" || typeof r.hex !== "string") {
      throw new ShelfError(`Row ${i + 1} needs a brand, code and hex colour.`);
    }
    const src = r.source === "catalogue" || r.source === "ocr" || r.source === "manual" ? r.source : "manual";
    const lab =
      Array.isArray(r.lab) && r.lab.length === 3 && r.lab.every((n) => typeof n === "number")
        ? (r.lab as [number, number, number])
        : undefined;
    return complete(
      {
        brand: r.brand,
        line: typeof r.line === "string" ? r.line : undefined,
        code: r.code,
        name: typeof r.name === "string" ? r.name : undefined,
        hex: r.hex,
        lab,
        weight: typeof r.weight === "number" ? r.weight : undefined,
        material: typeof r.material === "string" ? r.material : undefined,
        qty: typeof r.qty === "number" ? r.qty : undefined,
        notes: typeof r.notes === "string" ? r.notes : undefined,
        source: src,
        addedAt: typeof r.addedAt === "string" ? r.addedAt : now,
      },
      now,
    );
  });
  return withEntries(emptyShelf(), entries);
}

// ---- snapping ------------------------------------------------------------------------------

export interface SnapOptions {
  /**
   * If the closest shelf thread is further than this (CIEDE2000), use the fallback brand instead.
   * Default: never (a non-empty shelf always wins, as the spec says "My Threads, else the brand").
   */
  maxDeltaE?: number;
}

export interface SnapResult {
  thread: ThreadEntry;
  deltaE: number;
  /** Where `thread` came from. */
  from: "shelf" | "fallback";
}

/** Snap one colour to the shelf first and the fallback brand palette when the shelf can't serve it. */
export function snapToShelf(rgb: RGB, shelf: Shelf, fallback: readonly ThreadEntry[], options: SnapOptions = {}): SnapResult {
  if (shelf.entries.length > 0) {
    const hit = nearestThread(rgb, shelfPalette(shelf));
    if (options.maxDeltaE === undefined || hit.deltaE <= options.maxDeltaE || fallback.length === 0) {
      return { ...hit, from: "shelf" };
    }
  }
  return { ...nearestThread(rgb, fallback), from: "fallback" };
}

/**
 * The palette autodigitize should snap to: the shelf (as catalogue rows) when it has any threads,
 * else the fallback brand. Pass the result straight to `quantize`.
 */
export function snapPalette(shelf: Shelf, fallback: readonly ThreadEntry[]): ThreadEntry[] {
  return shelf.entries.length > 0 ? shelfPalette(shelf) : [...fallback];
}
