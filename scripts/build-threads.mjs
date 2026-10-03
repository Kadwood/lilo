#!/usr/bin/env node
// Build the thread catalogues in data/threads/*.json from the Ink/Stitch GIMP palettes.
//
//   node scripts/build-threads.mjs            # download (pinned commit) and write data/threads/
//   node scripts/build-threads.mjs --from DIR # parse already-downloaded .gpl files from DIR
//
// Ink/Stitch is GPL-3.0; so is Lilo. The generated JSON is committed so normal builds are offline.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Pinned Ink/Stitch commit, so the output is reproducible. */
const INKSTITCH_REF = "d59c9ab1e390285a6c67822436ffd9ba9843d8b4";
const RAW = `https://raw.githubusercontent.com/inkstitch/inkstitch/${INKSTITCH_REF}/palettes`;
const LICENCE = "GPL-3.0";

/** [palette file, output file, brand, line] */
const PALETTES = [
  ["InkStitch Brother Embroidery.gpl", "brother-embroidery.json", "Brother", "Embroidery"],
  ["InkStitch Brother Country.gpl", "brother-country.json", "Brother", "Country"],
  ["InkStitch Brothread 40.gpl", "brothread-40.json", "Brother", "Brothread 40"],
];

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

const hex = ([r, g, b]) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

/** Keep each `lab` triple on one line. */
const compactLab = (json) =>
  json.replace(/"lab": \[\s*([^\]]+?)\s*\]/g, (_, body) => `"lab": [${body.split(/,\s*/).join(", ")}]`);

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
  for (const [file, outFile, brand, line] of PALETTES) {
    const rows = parseGpl(await readPalette(file, fromDir));
    const seen = new Set();
    const threads = rows.map(({ rgb, name, code }) => {
      if (seen.has(code)) throw new Error(`${file}: duplicate code ${code}`);
      seen.add(code);
      return {
        brand,
        line,
        code,
        name,
        hex: hex(rgb),
        lab: rgbToLab(...rgb),
        source: `https://github.com/inkstitch/inkstitch/blob/${INKSTITCH_REF}/palettes/${encodeURIComponent(file)}`,
        licence: LICENCE,
      };
    });
    await writeFile(join(outDir, outFile), compactLab(JSON.stringify(threads, null, 2)) + "\n");
    console.log(`${outFile}: ${threads.length} threads`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
