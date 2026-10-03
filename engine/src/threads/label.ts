/**
 * Turn OCR text from a photo of a thread spool into ranked (brand, code) guesses for the My Threads
 * shelf. The OCR itself is `platform.ocrImage` (Apple Vision, see `app/src-tauri/src/ocr.rs`); this
 * file is pure text logic so it is unit-tested without a camera.
 *
 * What a label usually says: the brand ("MADEIRA"), the product ("POLYNEON No. 40"), a colour code
 * of 3 to 5 characters (the biggest number on it), and noise (length "5000 m", weight "40", batch,
 * barcode). The user always confirms, so the job is a short, well-ordered list.
 */
import { listBrands, loadBrand, matchCode, normalizeCode, search, type ThreadEntry } from "../threads";

/** The shape `platform.ocrImage` returns. */
export interface OcrLine {
  text: string;
  /** 0..1. */
  confidence: number;
  /** Fractions of the image, origin top-left. */
  bbox?: { x: number; y: number; width: number; height: number };
}

export interface SpoolCandidate {
  /** Empty when the label named no brand and the code matches nothing: ask the user. */
  brand: string;
  code: string;
  /** Product line ("Rayon") when the catalogue knows it. */
  line?: string;
  /** The catalogue row, when the code was found (gives name, colour, lab). */
  entry?: ThreadEntry;
  /** Higher is better; only the order is meaningful. */
  score: number;
  /** `score` squashed to 0..1 for display. */
  confidence: number;
  /** Why it ranked: for the UI tooltip and for debugging. */
  reasons: string[];
}

export interface ParseOptions {
  /** How many candidates to return. Default 8. */
  limit?: number;
}

/** Words on labels that mean one of our brands (catalogue brand names are matched automatically). */
const BRAND_ALIASES: Record<string, string> = {
  brothread: "Brother",
  "brother embroidery": "Brother",
  robison: "Robison-Anton",
  "robison anton": "Robison-Anton",
  anton: "Robison-Anton",
  amann: "Isacord",
  "poly sheen": "Mettler",
  polysheen: "Mettler",
  "sim thread": "Simthread",
  "king star": "King Star",
  kingstar: "King Star",
  "fil tec": "Fil-Tec",
  filtec: "Fil-Tec",
  "royal viscose": "Royal",
};

/** Product words that point at a catalogue line. */
const LINE_WORDS: [RegExp, RegExp][] = [
  [/polyneon/, /polyneon/i],
  [/burmilana/, /burmilana/i],
  [/\bmatt\b/, /matt/i],
  [/rayon|viscose/, /rayon/i],
  [/polyester|\bpoly\b/, /polyester|polyneon/i],
  [/cotton|mako/, /mako|cotton/i],
];

const KEYWORD = /\b(COLOR|COLOUR|COL|COULEUR|FARBE|COLORE|SHADE|NO|NR|NUM|NUMBER|ART|#)\b|NO\.|NR\.|№/;
const UNIT_AFTER = /^(M|MT|MTR|MTRS|METER|METERS|METRES|YD|YDS|YARD|YARDS|FT|G|GR|GRAM|GRAMS|WT|DEN|TEX|NM|PLY|CM|MM|PCS|COLORS|COLOURS)$/;
const NOISE_LINE = /COPYRIGHT|©|\(C\)|\bLOT\b|\bBATCH\b|\bEXP\b|\bDATE\b|MADE IN|\bTEL\b|WWW\.|HTTP|@/;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Brands the label mentions, in order of first mention. Pass the brand names to look for. */
export function detectBrands(lines: readonly (OcrLine | string)[], brands: readonly string[] = listBrands().map((b) => b.brand)): string[] {
  const text = ` ${lines.map((l) => norm(typeof l === "string" ? l : l.text)).join(" ")} `;
  const squashed = text.replace(/ /g, "");
  const found: { brand: string; at: number }[] = [];
  /** Position of `phrase` in the label text, or -1. Short names ("DMC") must be whole words. */
  const find = (phrase: string): number => {
    const whole = text.indexOf(` ${phrase} `);
    if (whole >= 0 || phrase.length < 5) return whole;
    const inside = text.indexOf(phrase); // "MADEIRAPOLYNEON" style run-ons
    if (inside >= 0) return inside;
    return squashed.includes(phrase.replace(/ /g, "")) ? 0 : -1; // spaced-out "R O B I S O N"
  };
  const add = (brand: string, at: number) => {
    if (at >= 0 && !found.some((f) => f.brand === brand)) found.push({ brand, at });
  };
  for (const brand of brands) add(brand, find(norm(brand)));
  for (const [alias, brand] of Object.entries(BRAND_ALIASES)) if (brands.includes(brand)) add(brand, find(alias));
  return found.sort((a, b) => a.at - b.at).map((f) => f.brand);
}

/** Repair digit look-alikes in a token that is mostly digits ("1l47" -> "1147", "O20" -> "020"). */
function fixDigits(tok: string): string {
  const digits = (tok.match(/[0-9]/g) ?? []).length;
  if (tok.length < 3 || digits < tok.length / 2) return tok;
  return tok.replace(/[OQD]/g, "0").replace(/[IL|]/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2");
}

interface RawCode {
  code: string;
  base: number;
  keyword: boolean;
  size: number;
  confidence: number;
  reasons: string[];
}

function extractCodes(lines: readonly OcrLine[]): RawCode[] {
  const out: RawCode[] = [];
  const maxH = Math.max(1e-6, ...lines.map((l) => l.bbox?.height ?? 0));
  lines.forEach((line, li) => {
    const upper = line.text.toUpperCase();
    if (NOISE_LINE.test(upper)) return;
    const tokens = upper.split(/[^A-Z0-9#]+/).filter(Boolean);
    const nearKeyword = KEYWORD.test(upper) || (li > 0 && KEYWORD.test(lines[li - 1].text.toUpperCase()));
    tokens.forEach((raw, ti) => {
      const tok = fixDigits(raw.replace(/^#/, ""));
      const m = /^([A-Z]{1,2})?(\d{3,5})$/.exec(tok);
      if (!m) return;
      const next = tokens[ti + 1];
      if (next && UNIT_AFTER.test(next)) return; // "5000 m", "40 wt"
      // "40/2" style weights split into short tokens and never reach here; 4-digit years do
      if (!m[1] && /^(19[89]\d|20[0-3]\d)$/.test(tok) && /\b(C|COPY|EXP|LOT|DATE)\b/.test(upper)) return;
      const shape = m[1] ? 0.85 : m[2].length === 4 ? 1 : m[2].length === 3 ? 0.9 : 0.6;
      const reasons = [m[1] ? "letter prefix" : `${m[2].length}-digit number`];
      if (nearKeyword) reasons.push("near a colour/No. keyword");
      const size = line.bbox ? line.bbox.height / maxH : 0;
      if (size > 0.7) reasons.push("largest print");
      out.push({ code: tok, base: shape, keyword: nearKeyword, size, confidence: line.confidence, reasons });
    });
  });
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.code) ? false : (seen.add(c.code), true)));
}

const squash = (score: number) => 1 - Math.exp(-Math.max(0, score) / 3);

/**
 * Rank (brand, code) guesses for the label text. `catalogue` is every thread row to search (load
 * the brands you expect, or use `identifySpool` which does that for you). A guess backed by a
 * catalogue row beats one that is not; a brand named on the label beats one that is not.
 */
export function parseSpoolLabel(
  input: readonly (OcrLine | string)[],
  catalogue: readonly ThreadEntry[],
  options: ParseOptions = {},
): SpoolCandidate[] {
  const lines: OcrLine[] = input.map((l) => (typeof l === "string" ? { text: l, confidence: 1 } : l));
  const codes = extractCodes(lines);
  if (codes.length === 0) return [];
  const brandNames = [...new Set(catalogue.map((e) => e.brand))];
  const detected = detectBrands(lines, [...new Set([...brandNames, ...listBrands().map((b) => b.brand)])]);
  const text = lines.map((l) => l.text.toLowerCase()).join(" ");
  const lineHints = LINE_WORDS.filter(([w]) => w.test(text)).map(([, m]) => m);

  const out: SpoolCandidate[] = [];
  for (const c of codes) {
    const textScore = c.base + (c.keyword ? 0.6 : 0) + c.size * 0.5 + c.confidence * 0.4;
    const matches = matchCode(catalogue, c.code);
    for (const entry of matches) {
      let score = textScore + 2;
      const reasons = [...c.reasons, "found in the catalogue"];
      const bi = detected.indexOf(entry.brand);
      if (bi >= 0) {
        score += 1.5 - Math.min(bi, 3) * 0.2;
        reasons.push(`label says ${entry.brand}`);
      }
      const named = entry.line !== "Standard" && ` ${norm(text)} `.includes(` ${norm(entry.line)} `);
      if (named || lineHints.some((h) => h.test(`${entry.line} ${entry.material ?? ""}`))) {
        score += 0.7;
        reasons.push(`matches the ${entry.line} line`);
      }
      out.push({ brand: entry.brand, code: entry.code, line: entry.line, entry, score, confidence: squash(score), reasons });
    }
    // Brands the label names whose catalogue has no such code: still offer them, the user may know better.
    for (const brand of detected) {
      if (matches.some((m) => m.brand === brand)) continue;
      const score = textScore + 0.5;
      out.push({ brand, code: c.code, score, confidence: squash(score), reasons: [...c.reasons, `label says ${brand}`, "not in the catalogue"] });
    }
    if (matches.length === 0 && detected.length === 0) {
      const score = textScore * 0.6;
      out.push({ brand: "", code: c.code, score, confidence: squash(score), reasons: [...c.reasons, "no brand on the label"] });
    }
  }
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
    .filter((c) => {
      const k = `${c.brand}|${c.line ?? ""}|${normalizeCode(c.code)}`;
      return seen.has(k) ? false : (seen.add(k), true);
    })
    .slice(0, options.limit ?? 8);
}

/**
 * OCR lines to candidates, loading what's needed: the brands the label names (all their lines), or
 * the whole catalogue when it names none.
 */
export async function identifySpool(input: readonly (OcrLine | string)[], options: ParseOptions = {}): Promise<SpoolCandidate[]> {
  const lines = input.map((l) => (typeof l === "string" ? { text: l, confidence: 1 } : l));
  const brands = detectBrands(lines);
  let catalogue: ThreadEntry[];
  if (brands.length > 0) catalogue = (await Promise.all(brands.map((b) => loadBrand(b)))).flat();
  else {
    // no brand named: search every code the label contains
    const codes = extractCodes(lines).map((c) => c.code);
    const hits = await Promise.all(codes.map((c) => search(c, { limit: 200 })));
    catalogue = hits.flat();
  }
  return parseSpoolLabel(lines, catalogue, options);
}
