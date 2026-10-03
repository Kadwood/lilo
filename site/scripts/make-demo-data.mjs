// Runs Lilo's real auto-digitize engine (in Node) on the hibiscus mark and saves the stitches as a
// tiny JSON the homepage animates (public/demo/demo.json). Re-run when the engine changes:
//   pnpm --dir site demo-data
// Why not run the engine in the visitor's browser? It bundles to ~2 MB gzipped (the straight-skeleton
// WASM), so the page plays real engine output instead and "Download Lilo" does the live thing.
import { build } from "esbuild";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
// The engine is TypeScript with JSON data imports: bundle it for Node first (esbuild handles both).
mkdirSync(join(here, "../.gen"), { recursive: true });
const outfile = join(here, "../.gen/engine-node.mjs");
await build({
  stdin: {
    contents: `export * from "${root}/engine/src/autodigitize/index.ts"; export * from "${root}/engine/src/stitch/index.ts";`,
    resolveDir: root,
  },
  bundle: true, format: "esm", platform: "node", outfile, logLevel: "error",
  external: ["node:*"],
  alias: { "@stitchables/stitchjs": join(root, "engine/node_modules/@stitchables/stitchjs/dist/stitch.mjs") },
  nodePaths: [join(root, "engine/node_modules"), join(root, "editor/node_modules"), join(root, "node_modules")],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const { autoDigitize, initVtracer, designToStitchPlan, validatePlan, planStats } = await import(pathToFileURL(outfile).href);
const initVtracerNode = () => initVtracer(readFileSync(join(root, "editor/node_modules/vtracer-wasm/vtracer.wasm")));

await initVtracerNode();
const SIZE = 480;
// the app icon without its cream tile: just the black hibiscus on a transparent background
const svg = Buffer.from(readFileSync(join(root, "editor/src/assets/brand/lilo-icon.svg"), "utf8").replace(/<rect [^>]*\/>/, ""));
const { data, info } = await sharp(svg, { density: 300 })
  .resize(SIZE, SIZE, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const result = await autoDigitize({ width: info.width, height: info.height, data: new Uint8ClampedArray(data) }, { colors: 4, widthMm: 70 });
const { plan } = validatePlan(designToStitchPlan(result.design), result.design.hoop);
const stats = planStats(plan);

const TYPE = { stitch: 0, jump: 1, trim: 2, colorChange: 3 };
const pts = [];
for (const s of plan.stitches) pts.push(Math.round(s.x * 10), Math.round(s.y * 10), TYPE[s.type], s.threadIndex);

mkdirSync(join(root, "site/public/demo"), { recursive: true });
writeFileSync(
  join(root, "site/public/demo/demo.json"),
  JSON.stringify({
    // x, y in tenths of a millimetre, then type (0 stitch, 1 jump, 2 trim, 3 colour change) and thread index
    unit: 0.1,
    threads: plan.threads.map((t) => t.hex),
    stats: { stitches: stats.stitchCount, colourChanges: stats.colorChanges, widthMm: +stats.widthMm.toFixed(1), heightMm: +stats.heightMm.toFixed(1) },
    pts,
  }),
);
await sharp(svg, { density: 200 }).resize(480, 480, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 85 }).toFile(join(root, "site/public/demo/source.webp"));
console.log("stitches", stats.stitchCount, "threads", plan.threads.length, "colour changes", stats.colorChanges, "size", stats.widthMm.toFixed(1), "x", stats.heightMm.toFixed(1));
