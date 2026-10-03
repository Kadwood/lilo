# Lilo v1 — Spec

Status: approved via grill, 2026-10-03. Research backing every claim: [research/ember-features.md](research/ember-features.md).

## 1. What Lilo is

A free, open-source (GPL-3.0) desktop embroidery digitizer. It matches every feature of Ember (emberdesign.net) Pro, free, and sends designs to Brother Wi-Fi embroidery machines.

- First user: Kadwood, on a Brother Innov-is NV2700. Jobs: monograms on suit linings, garment-bag crests, hat patches.
- Built so a public hosted version (phase 2) can follow without a rewrite.

## 2. Non-goals for v1

- No accounts, cloud sync, community gallery, likes or profiles. These are phase 2.
- No public web deploy. The editor builds as a web app but ships inside the desktop app.
- No USB-cable machine transfer. USB stick export (PES download) is the fallback.
- No Mac App Store build. We use a private Apple API for Liquid Glass.

## 3. Architecture

One Tauri 2 desktop app (macOS first, Windows/Linux supported). Repo `Kadwood/lilo`, monorepo:

```
lilo/
  app/          Tauri shell. Forked from EmberSoftwareInc/ember-bridge (MIT; keep its notice).
    src-tauri/  Rust: machine discovery + Brother "pedxml" Wi-Fi send, project file I/O,
                OCR (Apple Vision), localhost API (kept for parity, editor uses Tauri commands).
  editor/       Vite + React + TypeScript UI. Builds standalone (web) and as the Tauri frontend.
  engine/       TypeScript library, no UI. Tracing, cleanup, lettering, threads, stitch generation
                (wraps stitchjs), file IO, validation. Pure functions + Web Workers. Fully unit-tested.
  data/         Thread catalogues (from Ink/Stitch palettes), bundled fonts (Ink/Stitch OFL/PD).
  scripts/      Build scripts (palette → JSON, font import).
  docs/
```

- Package manager: pnpm workspaces.
- Editor talks to Rust only through a thin `platform` interface (`sendToMachine`, `discoverMachines`, `openFile`, `saveFile`, `ocrImage`). There's a Tauri implementation and a browser stub, so phase 2 web works.
- Heavy work (tracing, stitch gen) runs in Web Workers so the UI stays at 60 fps.

### Key dependencies

| Need | Library | Licence |
|---|---|---|
| Stitch generation, PES/DST write | `@stitchables/stitchjs` | MIT |
| Raster → vector | `vtracer` (WASM, pinned version) | MIT |
| Colour quantise | `image-q` | MIT |
| Font parsing | `opentype.js` | MIT |
| Geometry | `jsts` (via stitchjs) | EPL/EDL |
| Wi-Fi send | Ember Bridge Rust (`brother/`, `machine/`) | MIT |
| Lettering + palettes reference | Ink/Stitch | GPL-3 |
| Canvas | PixiJS (WebGL) for stitch render; SVG overlay for handles | MIT |
| State | Zustand + Immer (undo/redo via patches) | MIT |

## 4. Features (all ship in v1)

### 4.1 Canvas + drawing
- Tools: Select (S), Pan (Space), Measure (M), Open shape (1), Closed shape (2), Circle (3), Rectangle (4), Pen/freehand (5), Satin blocks (6), Text (T), Manual stitch.
- Left-click = straight segment. Right-click or double-click = curve. Enter = finish. Ctrl = constrain / 15° snap / square.
- Shape actions: reshape (drag/insert/delete points), cut holes, knife (split), set start/end points, edit stitch angle, map to path (repeat/count, rotate, reverse, detach), lock, duplicate, delete, flip H/V.
- Dimensions panel: W/H, aspect lock, in/cm toggle. Hoop overlay (NV2700: 160×260, 130×180).
- Undo/redo, Ctrl+A, Ctrl+D, arrows nudge, ⌘K command palette.

### 4.2 Stitch types
- **Run types (7):** Single, Triple, Satin, E-stitch, Double rope, Triple rope, Manual.
- **Satin settings:** width, density, pull compensation, split satin (max width), stagger, short stitches on curves, underlays (center, contour, zig-zag).
- **Fills:** at least the 23 documented Ember fills: Tatami, Original, Triangle, Waves, Columns, Offset Columns, Hearts S/M/L, Diamonds S/M/L, Zig-Zag, Circles S/M/L, Heartbeat, Spiral, Staircase, Rainfall, Hexweave, Tornado, Streamlines, Circular. Add more to reach ≥34.
- **Fill settings:** angle, row spacing, stitch length, pull comp, hand-stitch 0–5, underpath, gradient (ramp/plateau), multiple underlays (angle, spacing, length, inset). Pattern-specific settings as per research notes.
- Auto redwork (single-line outline digitize).

### 4.3 Auto digitize (top priority)
Pipeline, each step visible and animated:
1. **Import** PNG/JPG/WEBP/HEIC/SVG/EPS (drag, paste, picker).
2. **Prep:** downscale, optional upscale for small images, background key (corner colour), colour count slider (default 6).
3. **Quantise** with image-q, snapped to the user's threads (My Threads, else the default brand) by ΔE in Lab.
4. **Trace** with vtracer (stacked mode) → SVG. *Animation: colour layers fade in, outlines draw on.*
5. **Cleanup:** drop/merge specks under min area, simplify, shell + holes, classify by stroke width (<1 mm run, 1–7 mm satin, wider fill), order by colour to cut thread changes.
6. **Stitch** via stitchjs (AutoFill, ClassicSatin/AutoSatin, Run) → editable shapes in the editor.
- The SVG stage is editable before stitching.
- **Click-to-stitch:** after trace, the user picks run/fill settings and clicks regions. The hit-test is on traced regions.

### 4.4 Lettering
- **Built-in "best quality" fonts:** Ink/Stitch embroidery fonts with OFL/PD/CC-BY(-SA) licences (skip NC). Port the font.json + SVG glyph format, kerning and min/max scale from `inkstitch/lib/lettering`.
- **Custom fonts:** TTF/OTF/TTC upload → opentype.js → flatten → straight skeleton (str8 via stitchjs) → stroke width → satin quad strips (1–7 mm), run (<1 mm), split satin/fill (wider) → pull comp + underlay → AutoSatin route.
- Size presets. Below the font's min height (custom fonts: 6 mm), show a warning and suggest a built-in font.
- Text on path. Multi-line, alignment, letter spacing.

### 4.5 Threads
- Catalogue built at build time from Ink/Stitch palettes: `{brand, line, code, name, hex, lab?, weight?, material?, source, licence}`. Default: Brother Embroidery Thread.
- **My Threads shelf.** Add a spool by:
  - typing brand + code
  - photographing the label (Apple Vision OCR → code suggestion, user confirms)
  - entering it manually (colour picker)
- When a code isn't found, "Search online" opens the brand's chart.
- Colour snapping prefers My Threads.

### 4.6 Preview + sequence
- **Stitch player:** play/pause/scrub/speed; needle position.
  - Pauses at each colour change with a card: "Swap to Brother 513 Blue".
  - Shows stitch count, time estimate at 850 spm, thread changes.
- **Realistic view:** shaded thread rendering (WebGL).
- **Sequencer:**
  - Shapes tab: reorder, rename, stitch count.
  - Colours tab: group by colour.
  - Images tab: reference images.

### 4.7 Other tools
- **Pixel art editor:** 32×32 default grid (resizable), pencil/fill/erase/eyedropper, palette from My Threads → cross/tatami-block stitches.
- **Converters:**
  - PNG/JPG → SVG (trace)
  - SVG → PES
  - PNG/JPG → PES
  - Embroidery file A → B (PES, DST, JEF, VP3, EXP, XXX, U01, PEC)
- **Import** existing embroidery files to view/edit as manual stitches.
- **Export:** PES (v1 default; v6 if stitchjs/pyembroidery port needed), DST, JEF, VP3, EXP + PNG image.
  - Origin point picker (3×3).
  - Export stats: stitches, shapes, colour changes, size.

### 4.8 Machine send (Lilo Link)
- Discover Brother Wi-Fi machines on the LAN.
- Save machines and show status (storage, files).
- **Send** → progress → done/error.
- Errors in plain English: machine off, not on same Wi-Fi, 2.4 GHz only, storage full, unsupported format.
- Fallback button: "Save for USB stick". Files go at the root of the stick, no folders; warn if more than 12 designs.

### 4.9 Projects
- `.lilo` file = zip containing:
  - `project.json` (versioned schema)
  - reference images
  - `thumbnail.png`
  - `history/` (last 50 autosaves)
- Default folder `~/Documents/Lilo`. Recent gallery with thumbnails on launch.
- Autosave every 30 s and on blur. Version history browser.
- Double-click opens a `.lilo` file (file association).

### 4.10 UI / design
- macOS 26+ Liquid Glass via `window-vibrancy` `apply_liquid_glass` (fallback NSVisualEffectView). Windows: mica. Linux: solid.
- Layout like Ember:
  - floating glass toolbar at the bottom
  - left contextual settings panel
  - right sequencer
  - top bar with project menu, Export, Send
- Calm, luxurious, Kadwood-inspired typography. Dark + light. Keyboard-first.
- First-run tutorial (draw → satin → fill → preview).
- Accessible: focus rings, labels, reduced motion respected (animations skippable).

## 5. Quality bar (v1 acceptance)

**Automated (CI):**
- Engine unit tests.
- Golden-file tests: fixed inputs → stitch output hashes + invariants:
  - no stitch > 12 mm
  - no density pile-ups (> N needle penetrations per 1 mm² cell)
  - jumps > 3 mm get trim commands
  - design fits the selected hoop
  - PES re-reads identically (round trip)
- `cargo test` for Rust.
- Editor builds.

**Manual sew-outs on NV2700**. All 5 must sew clean and be client-worthy:
1. Kadwood logo, auto-digitized, ~60 mm, suit fabric
2. "JK" monogram, 10 mm, custom font, suit lining
3. Garment-bag crest, ~120 mm, fills + satin, canvas
4. Round hat patch, ~50 mm, satin border, twill
5. 32×32 pixel art

Stitch count within ~15% of Ember for the same design.

## 6. Build order (one v1 release)

1. **M1 Foundation:** monorepo, Ember Bridge imported + renamed (Lilo), editor shell inside Tauri, engine package with stitchjs, CI. Send an existing PES to the NV2700 over Wi-Fi (manual test).
2. **M2 Auto digitize + stitch player:** full pipeline, tracing + sequence animations, PES export, send.
3. **M3 Editor:** all drawing tools, run types, fills, settings, sequencer, realistic view.
4. **M4 Lettering:** built-in fonts + custom-font pipeline.
5. **M5:** click-to-stitch, threads + My Threads + OCR, pixel art, converters, import, remaining fills.
6. **M6 Polish:** Liquid Glass, tutorial, `.lilo` versions, installers (signed + notarized DMG), docs, GitHub release.

Each milestone goes through builder → refuter before it's reported done.

## 7. Licensing

- Lilo is GPL-3.0.
- Keep MIT notices for Ember Bridge, stitchjs and vtracer.
- Per-font licence files ship with the fonts. An `NOTICE.md` lists all third-party sources.
