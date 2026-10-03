#!/usr/bin/env node
// Build the thread catalogues in data/threads/*.json from the Ink/Stitch GIMP palettes.
//
//   node scripts/build-threads.mjs            # download (pinned commit) and write data/threads/
//   node scripts/build-threads.mjs --from DIR # parse already-downloaded .gpl files from DIR
//
// Writes one data/threads/<brand>-<line>.json per palette plus data/threads/index.json (the list the
// UI shows without loading any catalogue). To keep the files small each row is just
// {code, name, hex, lab}; brand, line, weight, material, source and licence live once per palette in
// index.json and the engine's loader copies them onto every row (see engine/src/threads.ts). Ink/Stitch is GPL-3.0; so is Lilo. The generated JSON is
// committed so normal builds are offline.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Pinned Ink/Stitch commit, so the output is reproducible. */
const INKSTITCH_REF = "d59c9ab1e390285a6c67822436ffd9ba9843d8b4";
const REPO = "https://github.com/inkstitch/inkstitch";
const RAW = `https://raw.githubusercontent.com/inkstitch/inkstitch/${INKSTITCH_REF}/palettes`;
const TREE_API = `https://api.github.com/repos/inkstitch/inkstitch/${"gi" + "t"}/trees/${INKSTITCH_REF}?recursive=1`;
const LICENCE = "GPL-3.0";

/** Brands, longest first so "Coats Sylko USA" is brand "Coats", line "Sylko USA". */
const BRANDS = [
  "Robison-Anton", "Gutermann", "Hemingworth", "Wonderfil", "Threadart", "Simthread", "Marathon", "Floriani",
  "Embroidex", "Outback", "Aurifil", "Admelody", "Brildor", "Brother", "Isacord", "Isafil", "Isalon", "Janome",
  "Madeira", "Mettler", "Radiant", "Tristar", "Vyapar", "Fil-Tec", "King Star", "Magnifico", "Princess", "Poly X40",
  "Gunold", "Anchor", "Emmel", "Metro", "Royal", "Sigma", "Sulky", "Swist", "Viking", "Coats", "FuFu", "BFC", "ARC",
  "DMC", "MTB", "RAL",
];
/** Palettes whose output file name predates this script; keep them byte-stable. */
const LINE_OVERRIDES = {
  "Brothread 40": ["Brother", "Brothread 40"],
  "Brothread 80": ["Brother", "Brothread 80"],
};

/** Catalogue ids that predate the full import (the editor and saved designs refer to them). */
const LEGACY_IDS = { "brother-brothread-40": "brothread-40" };

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** sRGB (0-255) -> CIE L*a*b*, D65 white point. Rounded to 2 dp. */
export function rgbToLab(r, g, b) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  const round = (n) => Math.round(n * 100) / 100;
  return [round(116 * fy - 16), round(500 * (fx - fy)), round(200 * (fy - fz))];
}

/** Parse GIMP .gpl text. Rows: `R G B  Name  Number` (name may contain spaces; number is last). */
export function parseGpl(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^(GIMP Palette|Name:|Columns:)/.test(line)) continue;
    const m = /^(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s+(\S+)$/.exec(line);
    if (!m) throw new Error(`Unparseable palette row: ${JSON.stringify(raw)}`);
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    out.push({ rgb: [r, g, b], name: m[4].trim(), code: m[5] });
  }
  return out;
}

/** `InkStitch Madeira Rayon.gpl` -> { brand: "Madeira", line: "Rayon" } (line "Standard" when there is none). */
export function brandAndLine(file) {
  const stem = file.replace(/^InkStitch\s+/, "").replace(/\.gpl$/, "").trim();
  if (LINE_OVERRIDES[stem]) {
    const [brand, line] = LINE_OVERRIDES[stem];
    return { brand, line };
  }
  const brand = BRANDS.find((b) => stem === b || stem.startsWith(b + " "));
  if (!brand) throw new Error(`${file}: unknown brand (add it to BRANDS in scripts/build-threads.mjs)`);
  return { brand, line: stem.slice(brand.length).trim() || "Standard" };
}

/** Thread weight (e.g. 40 for "Brothread 40", "Poly X40") and fibre, read from the names only. */
export function weightAndMaterial(...names) {
  const text = names.join(" ");
  const out = {};
  const w = /(?:Brothread|\bX)\s*(\d{2})\b/i.exec(text);
  if (w) out.weight = Number(w[1]);
  if (/rayon|viscose/i.test(text)) out.material = "rayon";
  else if (/polyester|poly\b|poly x|brothread/i.test(text)) out.material = "polyester";
  else if (/mako/i.test(text)) out.material = "cotton";
  else if (/lana/i.test(text)) out.material = "wool";
  return out;
}

/** "Madeira Rayon"; "Brothread 40" (not "Brother Brothread 40"); just the brand when the line is "Standard". */
const label = (brand, line) =>
  line === "Standard" ? brand : /^Brothread/.test(line) ? line : `${brand} ${line}`;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const hex = ([r, g, b]) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

/** Keep each `lab` triple on one line. */
const compactLab = (json) =>
  json.replace(/"lab": \[\s*([^\]]+?)\s*\]/g, (_, body) => `"lab": [${body.split(/,\s*/).join(", ")}]`);

async function listPalettes(fromDir) {
  if (fromDir) return (await readdir(fromDir)).filter((f) => f.endsWith(".gpl")).sort();
  const res = await fetch(TREE_API);
  if (!res.ok) throw new Error(`palette listing: HTTP ${res.status}`);
  const tree = (await res.json()).tree;
  return tree
    .filter((n) => n.path.startsWith("palettes/") && n.path.endsWith(".gpl"))
    .map((n) => n.path.slice("palettes/".length))
    .sort();
}

async function readPalette(file, fromDir) {
  if (fromDir) return readFile(join(fromDir, file), "utf8");
  const res = await fetch(`${RAW}/${encodeURIComponent(file)}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const fromIdx = process.argv.indexOf("--from");
  const fromDir = fromIdx > 0 ? process.argv[fromIdx + 1] : null;
  const outDir = join(root, "data", "threads");
  await mkdir(outDir, { recursive: true });
  const index = [];
  for (const file of await listPalettes(fromDir)) {
    const text = await readPalette(file, fromDir);
    const header = /^Name:\s*(.+)$/m.exec(text)?.[1] ?? "";
    const { brand, line } = brandAndLine(file);
    const slugged = slug(`${brand}-${line}`);
    const id = LEGACY_IDS[slugged] ?? slugged;
    const extra = weightAndMaterial(line, header.replace(/colou?rs?/gi, ""));
    const source = `${REPO}/blob/${INKSTITCH_REF}/palettes/${encodeURIComponent(file)}`;
    const seen = new Set();
    const threads = [];
    for (const { rgb, name, code } of parseGpl(text)) {
      if (seen.has(code)) {
        console.warn(`${file}: duplicate code ${code} ("${name}") skipped`);
        continue;
      }
      seen.add(code);
      threads.push({ code, name, hex: hex(rgb), lab: rgbToLab(...rgb) });
    }
    await writeFile(join(outDir, `${id}.json`), compactLab(JSON.stringify(threads, null, 2)) + "\n");
    index.push({ id, brand, line, label: label(brand, line), count: threads.length, ...extra, source, licence: LICENCE });
  }
  index.sort((a, b) => a.brand.localeCompare(b.brand) || a.line.localeCompare(b.line));
  const ids = new Set(index.map((i) => i.id));
  if (ids.size !== index.length) throw new Error("two palettes map to the same output file");
  await writeFile(join(outDir, "index.json"), JSON.stringify(index, null, 1) + "\n");
  console.log(`${index.length} catalogues, ${index.reduce((n, i) => n + i.count, 0)} threads`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
