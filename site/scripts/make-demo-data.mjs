// Builds the hero showcase from Lilo's REAL engine, in Node:
//   the word "Lilo" in a built-in script font (satin columns) -> stitch plan -> realistic thread render.
// Output in public/demo/: final.webp (the sewn result), fabric.webp (the bare cloth), source.webp (the flat
// "picture"), trace.webp (its outline) and demo.json (needle order). The page reveals final.webp along the
// stitch order, so every frame is the realistic render, not a 1-pixel line drawing.
//   pnpm --dir site demo-data        (needs `pnpm fonts` once: the font comes from data/fonts)
// We do not run the engine in the visitor's browser: it bundles to ~2 MB gzipped.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { loadEngine, loadFont, root } from "./demo-lib.mjs";

const OUT_W = 1120; // px, the width of every demo image
const PPM = 24; // render resolution, px per mm
const PAD = 4; // mm around the design
const FABRIC = "#f1ebe0";
const HIBISCUS = [0xd9, 0x30, 0x5a];

const eng = await loadEngine();
const cat = eng.getCatalogue();
const dist = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return Math.hypot((n >> 16) - HIBISCUS[0], ((n >> 8) & 255) - HIBISCUS[1], (n & 255) - HIBISCUS[2]);
};
const thread = eng.toDesignThread([...cat.threads].sort((a, b) => dist(a.hex) - dist(b.hex))[0]);

const font = loadFont(eng, "montecarlo");
const r = eng.layoutText("Lilo", font, { heightMm: 30, threadId: thread.id, sewing: { quality: "premium", threadWeight: 40 } });
const design = eng.emptyDesign(eng.DEFAULT_HOOP);
design.threads = [thread];
design.objects = r.objects;
const { plan } = eng.validatePlan(eng.designToStitchPlan(design), design.hoop);
const stats = eng.planStats(plan);

// the same viewport for the sewn and the bare render
let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
for (const s of plan.stitches) if (s.type === "stitch") (x0 = Math.min(x0, s.x), y0 = Math.min(y0, s.y), x1 = Math.max(x1, s.x), y1 = Math.max(y1, s.y));
const viewport = { x0: x0 - PAD, y0: y0 - PAD, x1: x1 + PAD, y1: y1 + PAD };
const opts = { pxPerMm: PPM, viewport, fabricHex: FABRIC };
const sewn = eng.renderRealistic(plan, opts);
const bare = eng.renderRealistic({ threads: [], stitches: [], warnings: [] }, opts);
const rawOf = (img) => ({ raw: { width: img.width, height: img.height, channels: 4 } });

const outH = Math.round((sewn.height * OUT_W) / sewn.width);
const scale = OUT_W / sewn.width;
const dir = join(root, "site/public/demo");
mkdirSync(dir, { recursive: true });
await sharp(Buffer.from(sewn.rgba), rawOf(sewn)).resize(OUT_W, outH).webp({ quality: 84, effort: 6 }).toFile(join(dir, "final.webp"));
await sharp(Buffer.from(bare.rgba), rawOf(bare)).resize(OUT_W, outH).webp({ quality: 55, effort: 6 }).toFile(join(dir, "fabric.webp"));

// silhouette of the stitched area: where the sewn render differs from bare cloth
const mask = new Uint8Array(sewn.width * sewn.height);
for (let i = 0; i < mask.length; i++) {
  const d = Math.abs(sewn.rgba[i * 4] - bare.rgba[i * 4]) + Math.abs(sewn.rgba[i * 4 + 1] - bare.rgba[i * 4 + 1]) + Math.abs(sewn.rgba[i * 4 + 2] - bare.rgba[i * 4 + 2]);
  mask[i] = d > 70 ? 255 : 0;
}
// (blur + low threshold closes the thread-sized gaps between satin stitches, a second blur + threshold smooths the edge)
const closed = await sharp(Buffer.from(mask), { raw: { width: sewn.width, height: sewn.height, channels: 1 } })
  .resize(OUT_W, outH)
  .blur(4)
  .threshold(40)
  .blur(2.5)
  .threshold(128)
  .extractChannel(0) // single channel, so one byte per pixel below
  .raw()
  .toBuffer();
const small = closed;
const at = (x, y) => (x < 0 || y < 0 || x >= OUT_W || y >= outH ? 0 : small[y * OUT_W + x]);
const src = Buffer.alloc(OUT_W * outH * 4);
const edge = Buffer.alloc(OUT_W * outH * 4);
const ER = 3;
for (let y = 0; y < outH; y++) {
  for (let x = 0; x < OUT_W; x++) {
    const i = (y * OUT_W + x) * 4;
    if (!at(x, y)) continue;
    // the "picture": a flat ink drawing of the word
    src[i] = 38; src[i + 1] = 33; src[i + 2] = 33; src[i + 3] = 255;
    // the "trace": pixels of the shape that touch the outside within ER px
    let touches = false;
    for (let dy = -ER; dy <= ER && !touches; dy++) for (let dx = -ER; dx <= ER; dx++) if (!at(x + dx, y + dy)) { touches = true; break; }
    if (touches) { edge[i] = HIBISCUS[0]; edge[i + 1] = HIBISCUS[1]; edge[i + 2] = HIBISCUS[2]; edge[i + 3] = 255; }
  }
}
await sharp(src, { raw: { width: OUT_W, height: outH, channels: 4 } }).webp({ quality: 85, alphaQuality: 90 }).toFile(join(dir, "source.webp"));
await sharp(edge, { raw: { width: OUT_W, height: outH, channels: 4 } }).webp({ quality: 85, alphaQuality: 90 }).toFile(join(dir, "trace.webp"));

// needle order, in tenths of a mm
const pts = [];
const TYPE = { stitch: 0, jump: 1, trim: 2, colorChange: 3 };
for (const s of plan.stitches) pts.push(Math.round(s.x * 10), Math.round(s.y * 10), TYPE[s.type]);
writeFileSync(
  join(dir, "demo.json"),
  JSON.stringify({
    unit: 0.1,
    width: OUT_W,
    height: outH,
    // pixel position of design point (x mm, y mm): (x - x0) * pxPerMm
    view: { x0: +viewport.x0.toFixed(3), y0: +viewport.y0.toFixed(3), pxPerMm: +(PPM * scale).toFixed(4) },
    thread: thread.hex,
    stats: { stitches: stats.stitchCount, widthMm: +stats.widthMm.toFixed(1), heightMm: +stats.heightMm.toFixed(1) },
    pts,
  }),
);
// a full-size copy of the final frame for reviewing the result
if (process.env.DEMO_PREVIEW) await sharp(join(dir, "final.webp")).png().toFile(process.env.DEMO_PREVIEW);
console.log(`thread ${thread.name} ${thread.hex}; ${stats.stitchCount} stitches; ${stats.widthMm.toFixed(1)} x ${stats.heightMm.toFixed(1)} mm; ${OUT_W}x${outH}`);
