// Usage: node scripts/changelog-section.mjs <x.y.z>
// Prints the CHANGELOG.md notes for that version (used as the release body). Exits 1 if the section
// is missing, empty, or still holds the placeholder `bump-version.mjs` writes.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { changelogPath } from "./versions.mjs";

/** Pure: the body of "## [version] ..." up to the next "## [" heading, or null. */
export function sectionFor(text, version) {
  const m = text.match(new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\][^\\n]*\\n`, "m"));
  if (!m || m.index === undefined) return null;
  const start = m.index + m[0].length;
  const next = text.slice(start).search(/^## \[/m);
  return text.slice(start, next === -1 ? text.length : start + next).trim();
}

function main() {
  const version = process.argv[2]?.replace(/^v/, "");
  if (!version) {
    console.error("Usage: node scripts/changelog-section.mjs <x.y.z>");
    process.exit(1);
  }
  const body = sectionFor(readFileSync(changelogPath(), "utf8"), version);
  if (!body) {
    console.error(`CHANGELOG.md has no (or an empty) section for ${version}.`);
    process.exit(1);
  }
  if (/TODO/.test(body)) {
    console.error(`CHANGELOG.md section for ${version} still has a TODO placeholder. Write the notes first.`);
    process.exit(1);
  }
  process.stdout.write(body + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
