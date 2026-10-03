# Feature inventory (target: match/exceed the commercial digitizers, all free)

Source: a commercial digitizer's public manual + pricing, read 2026-10-03 via WebFetch (summarised text, not raw HTML).

## Pricing split
- Free: all digitizing tools, pixel art, 15 projects, 7 fills, 23 fonts, 3 run types, multi-format export.
- Pro ($9.99/mo): auto digitize, custom fonts (TTF/OTF/TTC), unlimited projects, click-to-stitch, version history, auto-save, 34 fills, gradient fill, auto redwork, map to path.
- Lilo: everything free.

## Toolbar + shortcuts
Select S, Pan Space, Measure M, Open shape 1, Closed shape 2, Circle 3, Rectangle 4, Pen 5, Satin blocks 6, Text T, Stitch player, Realistic view.
Undo/redo, Ctrl+A, Ctrl+D duplicate, Ctrl+S, P map to path, arrows nudge, Enter finish, Backspace delete. Ctrl = constrain/15° snap/square/invert aspect lock. Left-click = line, right/double-click = curve. ⌘K command search.

## Run types (7)
1. Single: length, tolerance (min 0.1mm)
2. Triple: length, tolerance
3. Satin: width, density, pull comp, split satin, max width, stagger (cycles, amount), short stitches on curves, underlays (Center, Contour, Zig Zag)
4. E stitch: length, width, flipped
5. Double rope: length, width
6. Triple rope: length, width
7. Manual: place each stitch

## Fill patterns (manual names 23; pricing says 34)
Tatami, Original, Triangle, Waves (steps, amplitude), Columns, Offset Columns, Hearts s/m/l, Diamonds s/m/l, Zig-Zag, Circles s/m/l, Heartbeat (intensity), Spiral (tightness, rotations), Staircase (step height, steps), Rainfall (chaos, density), Hexweave (cell size), Tornado (tightness, rotations), Streamlines (separation, guide curves), Circular Fill (movable centre).
Shared: angle, row spacing, stitch length, pull comp, hand stitch 0–5, underpath toggle, gradient (ramp/plateau), multiple underlays (angle, spacing, length, inset).

## Shape actions
Reshape, cut holes, start/end points, edit angle, map to path (repeat/count, rotate, reverse, detach), lock, duplicate, delete. Knife mentioned in onboarding tooltip only.

## Other
- Dimensions: W/H fields, aspect lock, flip H/V, in/cm.
- Lettering: satin blocks per glyph, 23 built-in fonts, size presets, custom fonts Pro.
- Sequencer: shapes tab (reorder, rename, stitch count), colours tab (group to cut colour changes), images tab (reference images behind shapes).
- Thread palette: 15,809 colours, 78 brands.
- Project info: shapes, colour changes, stitches.
- Import images: PNG, JPEG, SVG, EPS, WEBP, HEIC. Open existing machine files.
- Export: PES, DST, JEF, VP3, EXP, HUS, XXX, VIP + image. Origin point picker (3x3 grid).
- Converter (in-browser, no account): PES, DST, EXP, JEF, VP3, U01, PEC, XXX, TBF, G-code.
- Pixel art: 32x32 grid → stitches.
- Community: explore, publish, clone, profiles, views, likes, download.
- Bridge: desktop app, LAN push to Brother Wi-Fi machines (closed source).
- A USB Wi-Fi dongle exists for sending designs. Out of scope for Lilo.

## NV2700 facts
- Max area 160x260mm; hoops 260x160, 180x130.
- Formats: PES, PHC, PHX, DST, PEN. USB import works.
- Wi-Fi: 2.4GHz only. Official wireless = Design Database Transfer / PE-DESIGN (Windows) or Artspira (iOS, Brother cloud). No Mac app.

## Unverified
Which run types/fills are free; 34 vs 23 fills gap; fill underlay types; setting ranges/defaults; NV2700 support in Bridge/Link; PES version limits.

## OSS libraries (checked 2026-10-03)
- **stitchjs** (github.com/stitchables/stitchjs, npm `@stitchables/stitchjs`): by the authors of a commercial digitizer (Matt Jacobson, Cory Ortega). TS, browser. Runs: Satin, ClassicSatin, CalligraphySatin, AutoSatin, TatamiFill, AutoFill, BCDFill, CircularFill, PatternFill, StreamlineFill, CrossStitchFill, Run + routed fill/satin. Writers: PES v1 (`#PES0001`), DST. MIT on npm but NO LICENSE file in repo. Verdict: reuse, get licence confirmed.
- **pyembroidery**: MIT, pure Python, writes PES v1 + v6, DST/EXP/JEF/VP3. No digitizer. Last push 2024-05 (stale). Pyodide untested.
- **pystitch** (inkstitch/pystitch): MIT, maintained pyembroidery fork.
- **@guillaumemmm/tsembroidery**: MIT TS port of pyembroidery, writePes/readPes/DST, svgToPes. New, 1 author. PES version unverified.
- **Ink/Stitch**: GPL-3 — reference only.
- **libembroidery**: zlib, C, no wasm build found.
- **Embroiderly**: GPL, cross-stitch app — not related. Ignore.
- **Stitch Lab**: closed source. Ignore.

## Machine transfer (checked 2026-10-03)
- **A Wi-Fi bridge for Brother machines is open source, MIT** (Tauri + Rust, pushed 2026-10-02; credited in NOTICE.md). Speaks Brother's reverse-engineered "pedxml" protocol (TLS 1.2, static RSA) to Innov-is / WLAN machines over local Wi-Fi. Localhost REST API on 127.0.0.1:17831 with origin-gated pairing → token; endpoints: health, discover, machines, info, status, send (raw bytes), jobs, logs, settings. Manufacturer-neutral `machine/` layer + `brother/` backend. NV2700 not named — test it.
- Protocol PoC: github.com/evozago/brother-embroidery-connect (MIT, PROTOCOL.md).
- USB on Brother (sibling models; NV2700 unconfirmed): machine mounts as removable disk on Mac. Write PES at root — no folders. Brother says max ~12 designs. Eject before unplug.
- Browser write to USB: Chrome/Edge only (`showDirectoryPicker`); Safari + Firefox no.

## Auto digitize (checked 2026-10-03)
- stitchjs has NO image tracing/quantise/region code. Starts at polygons: `AutoFill(shell, holes, angle, rowSpacingMm, fillPattern, travelStitchLengthMm, start, end, center?, underpath, gradient?)` (src/Core/Runs/AutoFill.ts:79); `AutoSatin(ClassicSatin[], start?, end?)`. Example `examples/svgToEmbroidery` = SVG → stitches.
- The commercial digitizers' method: not published.
- **vtracer** (visioncortex/vtracer): MIT, colour quantise + trace, WASM (~65 KiB) + Rust crate. Alpha (1.0.0-alpha.4) — pin it. Best fit.
- imagetracerjs: Unlicense, stale (2023). Fallback.
- potrace (GPL), imgly background-removal (AGPL): avoid.
- MobileSAM (Apache-2.0, ~10.5 MB quantised, onnxruntime-web): click-a-point → mask; good for click-to-stitch on photos.
- Ink/Stitch lessons: auto-trace makes tiny fragments → drop/merge specks, simplify, flatten gradients, route to cut jumps.
- Proposed pipeline: load+downscale → quantise to N thread colours (snap to palette) → vtracer stacked → cleanup (drop specks, simplify, shell+holes, thin→satin/run, wide→AutoFill, sort by colour) → stitchjs → PES. Click-to-stitch = hit-test traced regions; SAM later for photos.

## Tracing alternatives + desktop look (checked 2026-10-03, mostly search snippets/recall — re-verify)
- Keep vtracer. Fallback imagetracerjs. opencv.js too heavy (~8 MB) unless custom control needed. potrace/autotrace GPL — skip.
- AI vectorizers (StarVector Apache-2.0 1B/8B; OmniSVG weights unclear): too big/slow, hallucinate shapes — not v1.
- Pre-processing: colour quantise first (`image-q` MIT); Real-ESRGAN (BSD-3) upscaler for low-res; background removal: corner-colour keying for logos; RMBG-2.0 is CC BY-NC — avoid.
- Liquid Glass in Tauri: window-vibrancy v0.7.0 `apply_liquid_glass` (macOS 26+, private NSGlassEffectView; corner bug #198). Plugin `tauri-plugin-liquid-glass` (falls back to NSVisualEffectView). Fine for GitHub distribution; App Store risk. Windows: mica/acrylic; Linux: plain.

## Thread catalogues (checked 2026-10-03)
- Ink/Stitch `palettes/`: 75 `.gpl` files (Madeira, Isacord, Robison-Anton, Gunold, Sulky, Janome, Floriani, Marathon, Simthread, Aurifil, DMC, Anchor, Mettler, Coats, Wonderfil…). Brother: `Brother Embroidery` (61, 001 White/900 Black), `Brother Country` (61, older 000/100 numbering), `Brothread 40` (40), `Brothread 80` (78), `Simthread 63 Brother Colors` (Lab values). Rows = `R G B Name Number`; brand/weight only from filename/header. **Licence: likely GPL-3.0 (repo licence, no separate palette licence)** — clashes with MIT Lilo. Ask maintainers / treat colour facts question legally.
- pyembroidery (MIT): PEC 64-colour machine palette, JEF palette — format slots, NOT retail spool codes.
- libembroidery thread tables: mostly TODO placeholders. Useless.
- Brother's official range may exceed 61 colours — check coverage.
- OCR: Apple Vision via `apple-vision` crate or Swift sidecar; reference Tauri app `pepperonas/inspector-rust` (MIT). tesseract.js (Apache-2.0) weaker.
- Schema: brand, line, code (string), name, hex, lab?, weight?, material?, source, licence. Snap colours by ΔE in Lab.

## Lettering / custom fonts (checked 2026-10-03)
- Ink/Stitch fonts are HAND-digitized (submodule `inkstitch/embroidery-fonts`, ~142 fonts: `font.json` + `ltr.svg` satin columns + preview). Licences: ~100 OFL, 6 PD, 8 CC-BY-NC-SA (skip), few CC-BY(-SA) (attribution). `font.json` has min_scale/max_scale, kerning_pairs, auto_satin, units_per_em…
- Ink/Stitch code: `lib/lettering/*.py` (render_text, kerning), `lib/stitches/auto_satin.py` (routes existing satins), `fill_to_satin.py` (needs user rungs), `stroke_to_satin.py`. NO TTF import / centerline / medial axis.
- stitchjs: `ClassicSatin(quadStripVertices, {densityMm, split, shortening, underlays…})`; `CalligraphySatin(centerLine, {angle, widthMm})` constant width; `AutoSatin` router; `getStraightSkeleton.ts` (str8). No font code; `examples/hersheyFonts` = single-stroke Hershey → RoutedCalligraphySatin.
- opentype.js MIT.
- Auto TTF→satin pipeline (proposed): opentype.js → flatten → straight skeleton (str8), prune spurs → width from distance-to-skeleton → split at junctions → 1–4mm ClassicSatin quad strips, <1mm run, >4mm split satin/fill → pull comp + underlay → AutoSatin. Min-height guard (~5–8mm) → suggest single-stroke/block fonts. "Quality varies" badge.
- Bundle OFL/PD Ink/Stitch fonts as "best quality" set; port lettering loader + font.json schema; honour min/max scale.
- Folklore (unverified): TTF degrades <6–8mm; lowercase poor <4mm; block caps best.
