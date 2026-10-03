import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

// stitchjs ships a CJS `main` that `require()`s an ESM-only dependency; use its ESM build.
// It is a dependency of ../engine (not of this package), so resolve from there.
const stitchEsm = join(
  dirname(
    createRequire(join(import.meta.dirname, "../engine/package.json")).resolve(
      "@stitchables/stitchjs/package.json",
    ),
  ),
  "dist/stitch.mjs",
);

// https://vite.dev/config/
export default defineConfig({
  build: { chunkSizeWarningLimit: 4000 }, // the engine chunk carries stitchjs + inlined WASM
  plugins: [react()],
  worker: { format: "es" },
  resolve: { alias: { "@stitchables/stitchjs": stitchEsm } },

  // Tauri: don't hide Rust errors, fixed port (also an allowed origin of the local API).
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 5174 } : undefined,
    watch: { ignored: ["**/app/src-tauri/**"] },
  },

  test: {
    environment: "node",
    testTimeout: 30_000,
    server: { deps: { inline: [/@stitchables\/stitchjs/] } },
  },
});
