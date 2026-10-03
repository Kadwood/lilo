// Usage: node scripts/bump-version.mjs <x.y.z>
//
// Sets the version everywhere (root + editor + engine package.json, Cargo.toml, Cargo.lock,
// tauri.conf.json) and turns CHANGELOG.md's "Unreleased" notes into a dated section for it.
// It never commits, tags or pushes.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SEMVER, changelogPath, sourceVersion, writeVersions } from "./versions.mjs";

export const TODO = "TODO: describe what changed in this release.";

const escapeDots = (v) => v.replace(/\./g, "\\.");

/**
 * Pure: move the notes under "## [Unreleased]" into a new "## [version] - date" section.
 * The Unreleased heading stays, empty, for the next release.
 */
export function addChangelogSection(text, version, date) {
  if (new RegExp(`^## \\[${escapeDots(version)}\\]`, "m").test(text)) {
    throw new Error(`CHANGELOG.md already has a section for ${version}`);
  }
  const m = text.match(/^## \[Unreleased\][^\n]*\n/m);
  if (!m || m.index === undefined) throw new Error('CHANGELOG.md has no "## [Unreleased]" heading');
  const bodyStart = m.index + m[0].length;
  const next = text.slice(bodyStart).search(/^## \[/m);
  const bodyEnd = next === -1 ? text.length : bodyStart + next;
  const notes = text.slice(bodyStart, bodyEnd).trim() || `- ${TODO}`;
  return `${text.slice(0, bodyStart)}\n## [${version}] - ${date}\n\n${notes}\n\n${text.slice(bodyEnd)}`.replace(/\n{3,}/g, "\n\n");
}

function main() {
  const version = process.argv[2]?.replace(/^v/, "");
  if (!version || !SEMVER.test(version)) {
    console.error("Usage: node scripts/bump-version.mjs <x.y.z>");
    process.exit(1);
  }
  const path = changelogPath();
  if (!existsSync(path)) throw new Error("CHANGELOG.md is missing");
  const before = sourceVersion();
  // Do the changelog first (it can fail) so a refusal leaves every file untouched.
  const next = addChangelogSection(readFileSync(path, "utf8"), version, new Date().toISOString().slice(0, 10));
  writeVersions(version);
  writeFileSync(path, next);
  console.log(`Version ${before} -> ${version}.`);
  console.log("Next: edit the new CHANGELOG.md section, review the diff, commit, then tag (docs/RELEASING.md).");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
