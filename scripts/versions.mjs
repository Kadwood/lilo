// Shared helpers for the release scripts: where Lilo's version lives and how to read/write it.
//
// The root package.json "version" is the single source of truth. `scripts/bump-version.mjs` copies it
// into every other place, and `scripts/check-versions.mjs` (run in CI) fails if any copy drifts.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const p = (...parts) => join(ROOT, ...parts);

/** package.json files whose top-level "version" is kept in step. */
const PACKAGE_JSONS = ["package.json", "editor/package.json", "engine/package.json"];

const CARGO_TOML = "app/src-tauri/Cargo.toml";
const CARGO_LOCK = "app/src-tauri/Cargo.lock";
const TAURI_CONF = "app/src-tauri/tauri.conf.json";

const read = (rel) => readFileSync(p(rel), "utf8");

/** The `version = "x"` line of the [package] table (the first one in the file). */
const CARGO_TOML_RE = /^(version\s*=\s*")([^"]+)(")/m;
/** The lockfile entry for this crate: `name = "lilo"` followed by its version line. */
const CARGO_LOCK_RE = /(\[\[package\]\]\nname = "lilo"\nversion = ")([^"]+)(")/;
/** JSON files are edited as text so their formatting survives. */
const JSON_VERSION_RE = /^(\s*"version"\s*:\s*")([^"]+)(")/m;

/** Every place a version is recorded: { file, version } (version null if the file has none). */
export function readVersions() {
  const out = [];
  for (const f of PACKAGE_JSONS) out.push({ file: f, version: JSON.parse(read(f)).version ?? null });
  out.push({ file: CARGO_TOML, version: read(CARGO_TOML).match(CARGO_TOML_RE)?.[2] ?? null });
  out.push({ file: CARGO_LOCK, version: read(CARGO_LOCK).match(CARGO_LOCK_RE)?.[2] ?? null });
  out.push({ file: TAURI_CONF, version: JSON.parse(read(TAURI_CONF)).version ?? null });
  return out;
}

export const sourceVersion = () => JSON.parse(read("package.json")).version;

/** Write `version` everywhere. Throws if a file does not have the line we expect to rewrite. */
export function writeVersions(version) {
  const edits = [
    ...PACKAGE_JSONS.map((f) => [f, JSON_VERSION_RE]),
    [CARGO_TOML, CARGO_TOML_RE],
    [CARGO_LOCK, CARGO_LOCK_RE],
    [TAURI_CONF, JSON_VERSION_RE],
  ];
  for (const [file, re] of edits) {
    const text = read(file);
    if (!re.test(text)) throw new Error(`${file}: no version line to update`);
    writeFileSync(p(file), text.replace(re, `$1${version}$3`));
  }
}

export const changelogPath = () => p("CHANGELOG.md");
