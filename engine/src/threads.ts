import { deltaE2000, hexToRgb, rgbToLab, type Lab, type RGB } from "./color";
import type { Thread } from "./model";
import brotherCountry from "../../data/threads/brother-country.json";
import brotherEmbroidery from "../../data/threads/brother-embroidery.json";
import brothread40 from "../../data/threads/brothread-40.json";

/** One catalogue row, as written by `scripts/build-threads.mjs`. */
export interface ThreadEntry {
  brand: string;
  line: string;
  code: string;
  name: string;
  hex: string;
  /** CIE L*a*b* (D65) of `hex`. */
  lab: [number, number, number];
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

const make = (id: string, label: string, threads: ThreadEntry[]): Catalogue => ({ id, label, threads });

/** Bundled catalogues (Ink/Stitch palettes, GPL-3.0). The first is the default. */
export const CATALOGUES: readonly Catalogue[] = [
  make("brother-embroidery", "Brother Embroidery", brotherEmbroidery as ThreadEntry[]),
  make("brother-country", "Brother Country", brotherCountry as ThreadEntry[]),
  make("brothread-40", "Brothread 40", brothread40 as ThreadEntry[]),
];

export const DEFAULT_CATALOGUE_ID = "brother-embroidery";

export function getCatalogue(id: string = DEFAULT_CATALOGUE_ID): Catalogue {
  const c = CATALOGUES.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown thread catalogue: ${id}`);
  return c;
}

export function threadId(e: Pick<ThreadEntry, "brand" | "line" | "code">): string {
  return `${e.brand}-${e.line}-${e.code}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** A catalogue row as a design `Thread`. */
export function toDesignThread(e: ThreadEntry): Thread {
  return { id: threadId(e), brand: e.brand, line: e.line, code: e.code, name: e.name, hex: e.hex };
}

/**
 * The palette entry closest to `rgb`, by CIEDE2000 (the perceptual standard; plain CIE76 mismatches
 * saturated blues and purples, which is exactly where threads cluster). A palette of ~60 entries
 * makes the cost irrelevant.
 */
export function nearestThread(
  rgb: RGB,
  palette: readonly ThreadEntry[],
): { thread: ThreadEntry; deltaE: number } {
  if (palette.length === 0) throw new Error("nearestThread: empty palette");
  const lab: Lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
  let best = palette[0];
  let bestD = Infinity;
  for (const t of palette) {
    const d = deltaE2000(lab, t.lab);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return { thread: best, deltaE: bestD };
}

export const entryRgb = (e: ThreadEntry): [number, number, number] => hexToRgb(e.hex);
