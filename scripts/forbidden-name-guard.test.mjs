// Run with: pnpm test:scripts
// Tests scripts/check-no-ember.mjs. The word it hunts is assembled here so this file stays clean.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { scanFile, scanRepo } from "./check-no-ember.mjs";

const W = ["Em", "ber"].join("");
const SCRIPT = new URL("./check-no-ember.mjs", import.meta.url).pathname;

test("flags the word in any case, as a word start or camelCase, with its line number", () => {
  const hits = scanFile("a.ts", `fine\nconst x = "${W}Link";\n// ${W.toUpperCase()}_TOKEN\nlet useX = isLoggedIn${W};`);
  assert.deepEqual(hits.map((h) => h.line), [2, 3, 4]);
  assert.deepEqual(scanFile("b.rs", `// https://${W.toLowerCase()}.example`).map((h) => h.line), [1]);
});

test("ignores ordinary words that merely contain it", () => {
  const text = ["remember", "Remember", "members", "December", "September", "November", "dismember"].join(" ");
  assert.deepEqual(scanFile("c.md", text), []);
});

test("NOTICE.md is exempt, other markdown is not", () => {
  assert.deepEqual(scanFile("NOTICE.md", `${W} Bridge (MIT)`), []);
  assert.equal(scanFile("docs/x.md", `${W} Bridge (MIT)`).length, 1);
});

test("a file name that carries the word is reported at line 0", () => {
  assert.deepEqual(scanFile(`src/${W.toLowerCase()}connect/mod.rs`, "ok").map((h) => h.line), [0]);
});

test("vendor thread colour names in the palette data are allowed, nothing else in data/", () => {
  assert.deepEqual(scanFile("data/threads/x.json", `{"name": "${W}glow"}`), []);
  assert.equal(scanFile("data/threads/x.json", `{"name": "${W} Link"}`).length, 1);
  assert.equal(scanFile("src/x.ts", `{"name": "${W}glow"}`).length, 1);
});

test("scanRepo only looks at tracked files", () => {
  const dir = mkdtempSync(join(tmpdir(), "no-forbidden-"));
  try {
    const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
    git("init", "-q");
    writeFileSync(join(dir, "ok.txt"), "nothing to see\n");
    writeFileSync(join(dir, "untracked.txt"), `${W}\n`);
    git("add", "ok.txt");
    assert.deepEqual(scanRepo(dir), []);
    writeFileSync(join(dir, "bad.txt"), `line one\nuses ${W}\n`);
    git("add", "bad.txt");
    assert.deepEqual(scanRepo(dir).map((h) => `${h.file}:${h.line}`), ["bad.txt:2"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the CLI passes on this repo (what CI runs)", () => {
  const out = execFileSync("node", [SCRIPT], { stdio: "pipe" }).toString();
  assert.match(out, /No forbidden product name/);
});
