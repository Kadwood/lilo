// Run with: pnpm test:scripts
import assert from "node:assert/strict";
import { test } from "node:test";
import { addChangelogSection, TODO } from "./bump-version.mjs";
import { sectionFor } from "./changelog-section.mjs";
import { buildManifest } from "./make-latest-json.mjs";
import { readVersions, sourceVersion } from "./versions.mjs";

const LOG = `# Changelog

intro

## [Unreleased]

- Added a thing

## [1.0.0] - 2026-01-01

- First release
`;

test("bump moves Unreleased notes into a dated section and keeps an empty Unreleased", () => {
  const out = addChangelogSection(LOG, "1.0.1", "2026-02-02");
  assert.match(out, /## \[Unreleased\]\n\n## \[1\.0\.1\] - 2026-02-02\n\n- Added a thing\n\n## \[1\.0\.0\]/);
  assert.equal(sectionFor(out, "1.0.1"), "- Added a thing");
  assert.equal(sectionFor(out, "1.0.0"), "- First release");
  assert.equal(sectionFor(out, "9.9.9"), null);
});

test("bump with nothing under Unreleased writes a TODO that the release refuses", () => {
  const out = addChangelogSection(LOG.replace("- Added a thing\n", ""), "1.0.1", "2026-02-02");
  assert.ok(sectionFor(out, "1.0.1")?.includes(TODO));
});

test("bump refuses a version that already has a section", () => {
  assert.throws(() => addChangelogSection(LOG, "1.0.0", "2026-02-02"), /already has a section/);
});

test("every recorded version matches the root package.json", () => {
  for (const { file, version } of readVersions()) assert.equal(version, sourceVersion(), file);
});

const files = [
  "Lilo.app.tar.gz",
  "Lilo.app.tar.gz.sig",
  "Lilo_1.0.1_x64-setup.exe",
  "Lilo_1.0.1_x64-setup.exe.sig",
  "Lilo_1.0.1_amd64.AppImage",
  "Lilo_1.0.1_amd64.AppImage.sig",
  "Lilo_1.0.1_universal.dmg",
];
const base = { files, readSig: (f) => `sig-of-${f}\n`, version: "1.0.1", repo: "Kadwood/lilo", tag: "v1.0.1", notes: "n", pubDate: "2026-02-02T00:00:00Z" };

test("latest.json covers every platform with the .sig content and tag URLs", () => {
  const m = buildManifest(base);
  assert.deepEqual(Object.keys(m.platforms).sort(), ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"]);
  assert.equal(m.platforms["darwin-aarch64"].signature, "sig-of-Lilo.app.tar.gz.sig");
  assert.equal(m.platforms["darwin-aarch64"].url, "https://github.com/Kadwood/lilo/releases/download/v1.0.1/Lilo.app.tar.gz");
  assert.equal(m.platforms["windows-x86_64"].url, "https://github.com/Kadwood/lilo/releases/download/v1.0.1/Lilo_1.0.1_x64-setup.exe");
  assert.equal(m.version, "1.0.1");
});

test("latest.json refuses a missing bundle or signature", () => {
  assert.throws(() => buildManifest({ ...base, files: files.filter((f) => !f.endsWith(".AppImage")) }), /Linux AppImage/);
  assert.throws(() => buildManifest({ ...base, files: files.filter((f) => f !== "Lilo.app.tar.gz.sig") }), /\.sig is missing/);
  assert.throws(() => buildManifest({ ...base, readSig: () => "  \n" }), /empty/);
});
