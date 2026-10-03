import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { initVtracer } from "./autodigitize/trace";

/**
 * Node-only setup: load the vtracer WASM from node_modules. Browsers/Workers instead call
 * `initVtracer(url)` with the bundler's asset URL (see editor/src/worker). Import this from tests
 * and CLIs as `@lilo/engine/node`.
 */
export function initVtracerNode(): Promise<void> {
  const require = createRequire(import.meta.url);
  return initVtracer(readFileSync(require.resolve("vtracer-wasm/vtracer.wasm")));
}
