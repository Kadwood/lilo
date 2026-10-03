// Fails (exit 1) if the word we dropped from the product still appears in any tracked file, printing
// every `file:line`. Used in CI. The only places allowed to name it:
//   - NOTICE.md (the upstream licence text we must keep), and
//   - this script, on lines that end with the marker below, and
//   - references to this script by its own file name (CI config, tests).
// It matches the word at the start of a word (so "remember", "member" and "December" are fine) and
// inside camelCase identifiers. Real thread colour names from the vendor palettes in data/threads/
// are the one data exception (see THREAD_NAMES).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MARK = "check-no-ember: allow";
const SELF = "scripts/check-no-ember.mjs"; // check-no-ember: allow
const NOTICE = "NOTICE.md";
const START = /(?<![A-Za-z])ember/i; // check-no-ember: allow
const CAMEL = /[a-z]Ember/; // check-no-ember: allow
const SELF_NAME = /check-no-ember/g; // check-no-ember: allow
const THREAD_NAMES = /\bEmber(glow|lite)\b/g; // check-no-ember: allow

/** Offending `{file, line, text}` entries for one file's text. `line` 0 means the file name itself. */
export function scanFile(file, text) {
  if (file === NOTICE) return [];
  const found = [];
  if (file !== SELF && (START.test(file) || CAMEL.test(file))) found.push({ file, line: 0, text: file });
  text.split("\n").forEach((raw, i) => {
    if (file === SELF && raw.includes(MARK)) return;
    let line = raw.replace(SELF_NAME, "");
    if (file.startsWith("data/threads/")) line = line.replace(THREAD_NAMES, "");
    if (START.test(line) || CAMEL.test(line)) found.push({ file, line: i + 1, text: raw.trim().slice(0, 160) });
  });
  return found;
}

/** Scan tracked files in the git repo at `cwd`. */
export function scanRepo(cwd) {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd, maxBuffer: 64 * 1024 * 1024 })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const found = [];
  for (const file of files) {
    let buf;
    try {
      buf = readFileSync(`${cwd}/${file}`);
    } catch {
      continue; // listed but deleted in the working tree
    }
    if (buf.includes(0)) {
      found.push(...scanFile(file, "")); // binary: only the name can offend
      continue;
    }
    found.push(...scanFile(file, buf.toString("utf8")));
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const found = scanRepo(root);
  if (found.length) {
    console.error("Found the dropped product name in tracked files (only NOTICE.md may mention it):");
    for (const f of found) console.error(`  ${f.file}:${f.line}  ${f.text}`);
    process.exit(1);
  }
  console.log("No forbidden product name outside NOTICE.md.");
}
