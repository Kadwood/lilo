// Shared by make-demo-data.mjs: bundles the engine for Node (esbuild handles its TypeScript + JSON) and
// exposes the pieces the demo needs.
import { build } from "esbuild";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
export const root = join(here, "..", "..");

export async function loadEngine() {
  mkdirSync(join(here, "../.gen"), { recursive: true });
  const outfile = join(here, "../.gen/engine-node.mjs");
  await build({
    stdin: {
      contents: [
        `export * from "${root}/engine/src/autodigitize/index.ts";`,
        `export * from "${root}/engine/src/stitch/index.ts";`,
        `export * from "${root}/engine/src/lettering/index.ts";`,
        `export { emptyDesign, DEFAULT_HOOP } from "${root}/engine/src/model/index.ts";`,
        `export { getCatalogue, toDesignThread } from "${root}/engine/src/threads.ts";`,
        `export { renderRealistic } from "${root}/engine/test/render-realistic.ts";`,
        `export { encodePng } from "${root}/engine/test/fixtures/png.ts";`,
      ].join("\n"),
      resolveDir: root,
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    logLevel: "error",
    external: ["node:*"],
    alias: { "@stitchables/stitchjs": join(root, "engine/node_modules/@stitchables/stitchjs/dist/stitch.mjs") },
    nodePaths: [join(root, "engine/node_modules"), join(root, "editor/node_modules"), join(root, "node_modules")],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  const eng = { ...(await import(pathToFileURL(outfile).href)) };
  eng.initVtracerNode = () => eng.initVtracer(readFileSync(join(root, "editor/node_modules/vtracer-wasm/vtracer.wasm")));
  return eng;
}

export function loadFont(eng, id) {
  return eng.parseFont(JSON.parse(readFileSync(join(root, "data/fonts", id, "font.json"), "utf8")));
}
