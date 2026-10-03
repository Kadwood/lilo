// Builds the updater manifest `latest.json` for a release from the signed bundles in a directory.
//
//   node scripts/make-latest-json.mjs --dir release-assets --version 1.0.1 --repo Kadwood/lilo \
//        --notes-file notes.md > latest.json
//
// Format: https://v2.tauri.app/plugin/updater/#static-json-file
//   { version, notes, pub_date, platforms: { "<os>-<arch>": { signature, url } } }
// "signature" must be the CONTENT of the .sig file (not a path or URL). Every platform below must be
// present or this exits 1: the updater validates the whole file before it looks at `version`, so a
// manifest with a missing or broken platform would hurt every user. Releases are drafts until Jins
// publishes them, and `releases/latest/download/latest.json` only exists once one is published.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * How to find each platform's updater bundle. macOS ships one universal archive, so both Mac
 * architectures point at it.
 */
export const PLATFORMS = [
  { keys: ["darwin-aarch64", "darwin-x86_64"], match: (n) => n.endsWith(".app.tar.gz"), label: "macOS universal (.app.tar.gz)" },
  { keys: ["windows-x86_64"], match: (n) => n.endsWith("-setup.exe"), label: "Windows NSIS (-setup.exe)" },
  { keys: ["linux-x86_64"], match: (n) => n.endsWith(".AppImage"), label: "Linux AppImage" },
];

/** Pure: build the manifest from file names and a way to read a signature. */
export function buildManifest({ files, readSig, version, repo, tag, notes, pubDate }) {
  const platforms = {};
  const problems = [];
  for (const p of PLATFORMS) {
    const bundles = files.filter(p.match);
    if (bundles.length !== 1) {
      problems.push(`${p.label}: expected exactly one bundle, found ${bundles.length}`);
      continue;
    }
    const name = bundles[0];
    if (!files.includes(`${name}.sig`)) {
      problems.push(`${p.label}: ${name}.sig is missing (was TAURI_SIGNING_PRIVATE_KEY set?)`);
      continue;
    }
    const signature = readSig(`${name}.sig`).trim();
    if (!signature) {
      problems.push(`${p.label}: ${name}.sig is empty`);
      continue;
    }
    const url = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
    for (const key of p.keys) platforms[key] = { signature, url };
  }
  if (problems.length) throw new Error(problems.join("\n"));
  return { version, notes, pub_date: pubDate, platforms };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function main() {
  const dir = arg("dir");
  const version = arg("version")?.replace(/^v/, "");
  const repo = arg("repo");
  const notesFile = arg("notes-file");
  if (!dir || !version || !repo) {
    console.error("Usage: make-latest-json.mjs --dir <assets> --version <x.y.z> --repo <owner/name> [--notes-file <file>]");
    process.exit(1);
  }
  try {
    const manifest = buildManifest({
      files: readdirSync(dir),
      readSig: (f) => readFileSync(join(dir, f), "utf8"),
      version,
      repo,
      tag: arg("tag") ?? `v${version}`,
      notes: notesFile ? readFileSync(notesFile, "utf8").trim() : "",
      pubDate: new Date().toISOString(),
    });
    process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
  } catch (e) {
    console.error(`latest.json: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
