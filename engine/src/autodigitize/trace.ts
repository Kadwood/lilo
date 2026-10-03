import initWasm, { initSync, to_svg } from "vtracer-wasm";
import { hexToRgb } from "../color";
import { NO_LABEL, type Quantized } from "./quantize";

/**
 * vtracer (visioncortex, MIT) via `vtracer-wasm` 0.1.0: the vtracer web-app crate compiled to WASM
 * and exposed as `to_svg(rgba, width, height, config)`. Pinned exactly in package.json.
 */

type WasmSource = Parameters<typeof initSync>[0] extends infer T ? (T extends { module: infer M } ? M : T) : never;

let ready: Promise<void> | null = null;

/**
 * Load the WASM. In the browser pass the asset URL (`import url from "vtracer-wasm/vtracer.wasm?url"`);
 * in Node pass the file bytes (see `node.ts`). Safe to call repeatedly; later calls reuse the first.
 */
export function initVtracer(source: string | URL | WasmSource): Promise<void> {
  if (!ready) {
    ready = (async () => {
      if (typeof source === "string" || source instanceof URL) {
        await initWasm({ module_or_path: source });
      } else {
        initSync({ module: source });
      }
    })().catch((e) => {
      ready = null; // allow a retry
      throw e;
    });
  }
  return ready;
}

export const isVtracerInitialised = (): boolean => ready !== null;

export interface TraceConfig {
  /** Drop clusters smaller than this many pixels. */
  filterSpeckle: number;
  cornerThreshold: number;
  lengthThreshold: number;
}

export const DEFAULT_TRACE_CONFIG: TraceConfig = { filterSpeckle: 6, cornerThreshold: 60, lengthThreshold: 4 };

const MARKER_CANDIDATES: [number, number, number][] = [
  [0, 255, 0],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 0],
  [128, 128, 128],
  [255, 128, 0],
];

/** A colour far from every palette colour, painted over the background so vtracer sees opaque pixels. */
function markerColour(palette: [number, number, number][]): [number, number, number] {
  let best = MARKER_CANDIDATES[0];
  let bestD = -1;
  for (const c of MARKER_CANDIDATES) {
    const d = Math.min(...palette.map((p) => Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2])));
    if (d > bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export interface TraceResult {
  /** SVG with one `<path>` per colour region (cutout mode: no overlaps), background removed. */
  svg: string;
}

/**
 * Trace the flat-colour label image with vtracer in *cutout* mode: every region is its own shape
 * with holes where other colours sit, so nothing overlaps (no double stitching). The background is
 * painted with a marker colour and dropped from the output.
 */
export function traceQuantized(q: Quantized, config: TraceConfig = DEFAULT_TRACE_CONFIG): TraceResult {
  if (!isVtracerInitialised()) throw new Error("vtracer is not initialised: call initVtracer() first");
  const { width: w, height: h, labels, palette } = q;
  const colours = palette.map((c) => hexToRgb(c.thread.hex));
  const marker = markerColour(colours);
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const l = labels[i];
    const c = l === NO_LABEL ? marker : colours[l];
    px[i * 4] = c[0];
    px[i * 4 + 1] = c[1];
    px[i * 4 + 2] = c[2];
    px[i * 4 + 3] = 255;
  }
  const raw = to_svg(px, w, h, {
    binary: false,
    mode: "polygon",
    hierarchical: "cutout",
    cornerThreshold: config.cornerThreshold,
    lengthThreshold: config.lengthThreshold,
    maxIterations: 10,
    spliceThreshold: 45,
    filterSpeckle: config.filterSpeckle,
    colorPrecision: 1,
    layerDifference: 16,
    pathPrecision: 2,
  });
  const markerHex = "#" + marker.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
  const svg = raw
    .split("\n")
    .filter((line) => !line.toUpperCase().includes(`FILL="${markerHex}"`))
    .join("\n");
  return { svg };
}
