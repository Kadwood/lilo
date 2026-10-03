import { deltaE2000, hexToRgb, rgbToLab, type Lab, type RGB } from "./color";
import type { Thread } from "./model";
import threadIndex from "../../data/threads/index.json";
import brotherCountry from "../../data/threads/brother-country.json";
import brotherEmbroidery from "../../data/threads/brother-embroidery.json";
import brothread40 from "../../data/threads/brothread-40.json";

/** One catalogue row. On disk a row is `{code, name, hex, lab}`; the loader adds the rest from the index. */
export interface ThreadEntry {
  brand: string;
  line: string;
  code: string;
  name: string;
  hex: string;
  /** CIE L*a*b* (D65) of `hex`. */
  lab: [number, number, number];
  /** Thread weight (e.g. 40), when the palette name says. */
  weight?: number;
  /** "polyester", "rayon", ... when the palette name says. */
  material?: string;
  source: string;
  licence: string;
}

/** One product line (one .gpl palette): a row of `data/threads/index.json`. */
export interface ThreadLine {
  /** File stem under `data/threads/`, e.g. "madeira-rayon". */
  id: string;
  brand: string;
  line: string;
  /** "Madeira Rayon". */
  label: string;
  count: number;
  weight?: number;
  material?: string;
  source: string;
  licence: string;
}

export interface Catalogue {
  /** Stable key, e.g. "brother-embroidery". */
  id: string;
  /** Label for UI, e.g. "Brother Embroidery". */
  label: string;
  threads: ThreadEntry[];
}

interface RawRow {
  code: string;
  name: string;
  hex: string;
  lab: [number, number, number];
}

const LINES = threadIndex as ThreadLine[];

/** Copy the per-palette facts onto each raw row. */
function hydrate(info: ThreadLine, rows: readonly RawRow[]): Catalogue {
  const threads = rows.map(
    (r): ThreadEntry => ({
      brand: info.brand,
      line: info.line,
      code: r.code,
      name: r.name,
      hex: r.hex,
      lab: r.lab,
      ...(info.weight !== undefined ? { weight: info.weight } : {}),
      ...(info.material !== undefined ? { material: info.material } : {}),
      source: info.source,
      licence: info.licence,
    }),
  );
  return { id: info.id, label: info.label, threads };
}

const lineInfo = (id: string): ThreadLine => {
  const i = LINES.find((l) => l.id === id);
  if (!i) throw new Error(`Unknown thread catalogue: ${id}`);
  return i;
};

const eager = (id: string, rows: unknown): Catalogue => hydrate(lineInfo(id), rows as RawRow[]);

/** Bundled catalogues the app needs synchronously (the Brother lines). The first is the default. */
export const CATALOGUES: readonly Catalogue[] = [
  eager("brother-embroidery", brotherEmbroidery),
  eager("brother-country", brotherCountry),
  eager("brothread-40", brothread40),
];

export const DEFAULT_CATALOGUE_ID = "brother-embroidery";

export function getCatalogue(id: string = DEFAULT_CATALOGUE_ID): Catalogue {
  const c = CATALOGUES.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown thread catalogue: ${id}. Use loadLine() for non-Brother lines.`);
  return c;
}

export interface BrandInfo {
  brand: string;
  lines: ThreadLine[];
  /** Threads across all lines. */
  count: number;
}

/** Every brand in the full catalogue, A-Z, with its lines. Synchronous: reads only the small index. */
export function listBrands(): BrandInfo[] {
  const byBrand = new Map<string, ThreadLine[]>();
  for (const l of LINES) byBrand.set(l.brand, [...(byBrand.get(l.brand) ?? []), l]);
  return [...byBrand.entries()]
    .map(([brand, lines]) => ({ brand, lines, count: lines.reduce((n, l) => n + l.count, 0) }))
    .sort((a, b) => a.brand.localeCompare(b.brand));
}

/** Every line (palette) of the full catalogue. */
export const listLines = (): readonly ThreadLine[] => LINES;

const loaded = new Map<string, Promise<Catalogue>>();

/**
 * Load one product line on demand (its JSON is a separate chunk in the web build, so brands nobody
 * opens never download). Results are cached.
 */
export function loadLine(id: string): Promise<Catalogue> {
  const hit = loaded.get(id);
  if (hit) return hit;
  const info = LINES.find((l) => l.id === id);
  if (!info) return Promise.reject(new Error(`Unknown thread catalogue: ${id}`));
  const eagerHit = CATALOGUES.find((c) => c.id === id);
  const p: Promise<Catalogue> = eagerHit
    ? Promise.resolve(eagerHit)
    : import(`../../data/threads/${id}.json`).then((m: { default: RawRow[] }) => hydrate(info, m.default));
  loaded.set(id, p);
  p.catch(() => loaded.delete(id));
  return p;
}

const brandKey = (b: string) => b.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Lines of a brand, matched case- and punctuation-insensitively ("robison anton" = "Robison-Anton"). */
export const linesOfBrand = (brand: string): ThreadLine[] => LINES.filter((l) => brandKey(l.brand) === brandKey(brand));

/** Every thread of a brand, loading its lines. */
export async function loadBrand(brand: string): Promise<ThreadEntry[]> {
  const cats = await Promise.all(linesOfBrand(brand).map((l) => loadLine(l.id)));
  return cats.flatMap((c) => c.threads);
}

/**
 * Canonical form of a spool code for comparing what a human typed with what the catalogue holds:
 * lower case, whitespace and `#` dropped, leading zeros after any letter prefix dropped
 * ("001" = "1" = " 001 ", "P 025" = "p25"; "0000" = "0").
 */
export function normalizeCode(code: string): string {
  return code
    .toLowerCase()
    .replace(/[\s#]+/g, "")
    .replace(/^([a-z-]*)0+(?=\d)/, "$1");
}

/** Entries of `entries` whose code equals `code` after `normalizeCode`. */
export const matchCode = <T extends { code: string }>(entries: readonly T[], code: string): T[] => {
  const k = normalizeCode(code);
  return k ? entries.filter((e) => normalizeCode(e.code) === k) : [];
};

/**
 * Find a spool by brand and code across all of the brand's lines (the same code can exist in several:
 * Madeira Rayon 1000 and Polyneon 1000 are different threads). Tolerates leading zeros and spaces.
 * Pass `line` to narrow to one product line. Empty array when nothing matches.
 */
export async function findByCode(brand: string, code: string, line?: string): Promise<ThreadEntry[]> {
  const lines = linesOfBrand(brand).filter((l) => line === undefined || brandKey(l.line) === brandKey(line));
  const cats = await Promise.all(lines.map((l) => loadLine(l.id)));
  return cats.flatMap((c) => matchCode(c.threads, code));
}

export interface SearchOptions {
  /** Maximum rows returned. Default 50. */
  limit?: number;
  /** Restrict to these brands (case-insensitive). */
  brands?: readonly string[];
}

/**
 * Search the full catalogue by code or name ("513", "madeira 1000", "navy"). Every query word must
 * hit the brand, line, code or name. Ranked: exact code, code prefix, name word, substring. This
 * loads every line, so call it from a worker or accept a one-off cost (about 2 MB of JSON).
 */
export async function search(query: string, options: SearchOptions = {}): Promise<ThreadEntry[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const limit = options.limit ?? 50;
  const only = options.brands?.map(brandKey);
  const lines = LINES.filter((l) => !only || only.includes(brandKey(l.brand)));
  const cats = await Promise.all(lines.map((l) => loadLine(l.id)));
  const scored: { e: ThreadEntry; score: number }[] = [];
  for (const c of cats) {
    for (const e of c.threads) {
      const name = e.name.toLowerCase();
      const meta = `${e.brand} ${e.line}`.toLowerCase();
      const code = normalizeCode(e.code);
      let score = 0;
      let ok = true;
      for (const w of words) {
        const wc = normalizeCode(w);
        if (wc && code === wc) score += 100;
        else if (wc && code.startsWith(wc)) score += 60;
        else if (name.split(/[^a-z0-9]+/).includes(w)) score += 40;
        else if (name.includes(w)) score += 20;
        else if (meta.includes(w)) score += 5;
        else {
          ok = false;
          break;
        }
      }
      if (ok) scored.push({ e, score: score - e.name.length / 100 });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.e);
}

export function threadId(e: Pick<ThreadEntry, "brand" | "line" | "code">): string {
  return `${e.brand}-${e.line}-${e.code}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** A catalogue row (or shelf entry) as a design `Thread`. */
export function toDesignThread(e: Pick<ThreadEntry, "brand" | "line" | "code" | "name" | "hex">): Thread {
  return { id: threadId(e), brand: e.brand, line: e.line, code: e.code, name: e.name, hex: e.hex };
}

/**
 * The palette entry closest to `rgb`, by CIEDE2000 (the perceptual standard; plain CIE76 mismatches
 * saturated blues and purples, which is exactly where threads cluster). Works on any set that carries
 * a `lab` (a catalogue line, the My Threads shelf, a hand-picked list).
 */
export function nearestThread<T extends { lab: readonly [number, number, number] } = ThreadEntry>(
  rgb: RGB,
  palette: readonly T[],
): { thread: T; deltaE: number } {
  if (palette.length === 0) throw new Error("nearestThread: empty palette");
  const lab: Lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
  let best = palette[0];
  let bestD = Infinity;
  for (const t of palette) {
    const d = deltaE2000(lab, t.lab as Lab);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return { thread: best, deltaE: bestD };
}

export const entryRgb = (e: { hex: string }): [number, number, number] => hexToRgb(e.hex);
