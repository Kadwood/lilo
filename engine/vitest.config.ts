import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig } from "vitest/config";

// stitchjs ships a CJS `main` that `require()`s an ESM-only dependency (str8), which Node
// rejects. Point at its ESM build instead.
const stitchEsm = join(
  dirname(createRequire(import.meta.url).resolve("@stitchables/stitchjs/package.json")),
  "dist/stitch.mjs",
);

export default defineConfig({
  resolve: { alias: { "@stitchables/stitchjs": stitchEsm } },
  test: {
    server: { deps: { inline: [/@stitchables\/stitchjs/] } },
  },
});
