// Fails (exit 1) if any copy of the version differs from the root package.json, or, given a tag
// (`node scripts/check-versions.mjs v1.2.3`), if the tag does not match that version. Used in CI.

import { readVersions, sourceVersion, SEMVER } from "./versions.mjs";

const source = sourceVersion();
const problems = [];

if (!SEMVER.test(source)) problems.push(`package.json: "${source}" is not a valid x.y.z version`);
for (const { file, version } of readVersions()) {
  if (version !== source) problems.push(`${file}: ${version ?? "(missing)"} (expected ${source})`);
}

const tag = process.argv[2];
if (tag && tag.replace(/^v/, "") !== source) problems.push(`tag ${tag} does not match package.json version ${source}`);

if (problems.length) {
  console.error("Version mismatch. Run `node scripts/bump-version.mjs <x.y.z>` to fix:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`All versions are ${source}${tag ? ` and match tag ${tag}` : ""}.`);
