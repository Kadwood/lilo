# Lilo by Kadwood

Free, open-source embroidery digitizing. Turn images, SVGs and fonts into stitch files and send them to your machine over Wi-Fi.

Website: [lilo.kadwood.com](https://lilo.kadwood.com) (source in [`site/`](site/README.md)).

> Status: **M5 (screens)**: Home with recent projects, click-to-stitch, My Threads, pixel art, the
> converter, all export formats, projects with autosave and version history. Before that, **M3
> (Editor)**: drop a PNG, JPG, WEBP or SVG on the canvas: Lilo traces it, snaps the
> colours to Brother threads, lays down stitches and lets you play them back stitch by stitch
> (pausing at each thread change). Everything it makes is editable, and you can draw from scratch
> with the full toolbar, the seven run types and 36 fill patterns. Export a PES with the real thread
> colours, or send it to a machine with Lilo Link. Lettering and the rest come in later milestones.

## What it will do (v1)

- Auto digitize: PNG/JPG → SVG → stitches, with a live tracing animation
- Click-to-stitch, full drawing editor, every run type and fill pattern
- Lettering: ~100 built-in embroidery fonts, plus your own TTF/OTF
- Stitch player with thread-change stops and realistic preview
- Thread catalogue for many brands, plus a "My threads" shelf
- Pixel art editor and file converters
- PES export and Wi-Fi send to Brother machines (Lilo Link)

One desktop app for macOS, Windows and Linux. No account needed.

## Install

Download the latest version from the **[Releases page](https://github.com/Kadwood/lilo/releases/latest)**.
Every release lists a `SHA256SUMS` file if you want to check your download.

**Mac** (macOS 13 or newer, Apple Silicon and Intel): download `Lilo_<version>_universal.dmg`, open
it and drag Lilo onto Applications. Lilo is signed and notarized by Apple, so the first time you open
it macOS shows "Lilo is an app downloaded from the Internet" with an **Open** button; click it. The
first time you look for machines on your network, macOS asks to allow Local Network access: say yes.

**Windows** (64-bit): download `Lilo_<version>_x64-setup.exe` and run it. The Windows installer is
not code-signed yet, so SmartScreen may say "Windows protected your PC". Click **More info**, then
**Run anyway**. It installs for your user only, no admin rights needed.

**Linux** (64-bit): download either
- `Lilo_<version>_amd64.AppImage`: `chmod +x Lilo_*.AppImage`, then run it (needs FUSE 2, `libfuse2`, on newer Ubuntu), or
- `Lilo_<version>_amd64.deb`: `sudo apt install ./Lilo_*.deb`.

**Updates**: Lilo checks GitHub for a new version when it starts (at most once a day) and shows a
banner with "Install and restart". Turn that off, or check by hand, under Lilo Link > Settings >
Updates. It only ever talks to GitHub Releases.

**Build from source**: see [Develop](#develop). Builds from source have no update key, so they never
self-update.

## Guide

Lilo explains itself. Press **⌘?** (**Ctrl+?** on Windows and Linux) or **Help** in the top bar for the searchable manual. A first-launch tour, a five-step workflow strip, a "?" hint next to almost every control and a calm warnings tray with one-click fixes sit on top of it.

All the wording lives in `docs/guide/`: the pages are Markdown (`*.md`), and the hints, tour, workflow tips and warnings are JSON (`hints.json`, `tour.json`, `workflow.json`, `live-hints.json`), so there is one copy source and it can be translated later. Four pages are generated from the app's own data (fill patterns, sewing presets, keyboard shortcuts, file formats). `pnpm guide` rebuilds them and `docs/guide/index.json`; `pnpm guide:check` validates everything and runs in CI. Screenshots still to capture are listed in `docs/guide/SCREENSHOTS.md`.

## Built on

Lilo builds on open-source software. Credits and licences for third-party code are in [NOTICE.md](NOTICE.md).

## Auto digitize, in short

`engine/src/autodigitize/`: downscale and key out the background, quantise to N colours (image-q)
and snap each to the nearest thread (CIEDE2000), trace with vtracer (cutout mode, so regions don't
overlap), then clean up in millimetres: merge specks, simplify, and classify each shape by its mean
width. Under 1 mm becomes a running stitch along the centre, up to ~7 mm becomes satin columns built
from the straight skeleton, anything wider becomes a tatami fill with underlay. Objects are ordered
colour by colour to keep thread changes down. The result is a `Design` (`engine/src/model/`), the
JSON model that later milestones extend; `designToStitchPlan` turns it into needle moves and
`writePes` writes a PES whose colour table is the nearest Brother PEC palette slot for each thread.

## The editor, in short

- **State** (`editor/src/state/editorStore.ts`): a Zustand store holding the `Design`. Every edit goes
  through `commit(label, recipe)`, an Immer recipe whose patches feed undo and redo (⌘Z, ⇧⌘Z). Edits
  that share a `merge` key (a drag, a slider, arrow-key nudges) collapse into one undo step. After
  each edit the design is re-stitched in the engine worker, debounced.
- **Tools** (`editor/src/tools/registry.ts`, `editor/src/canvas/controller.ts`): Select S, Pan Space,
  Measure M, Open shape 1, Closed shape 2, Circle 3, Rectangle 4, Pen 5, Satin blocks 6, Manual
  stitch 7. Left-click is a straight segment; right-click or double-click is a curve point; Enter
  finishes, Esc cancels; Ctrl constrains (15° snap, square, circle, inverts the aspect lock). Shapes
  keep their nodes (`geometry.shellNodes` / `geometry.nodes`), so they can be reshaped later.
  The Text tool (T) is a disabled placeholder that lettering fills in.
- **Shape actions** (the bar above a selection): reshape, cut hole, knife, start/end markers, stitch
  angle dial, map to path (live until detached), outline ↔ fill, auto redwork, lock, duplicate, delete.
  Knife and cut hole need jsts, so they run in the worker (`engine/src/shapeops.ts`).
- **Stitch types** (`engine/src/stitch`): run types single, triple (bean), satin, E-stitch, double
  rope, triple rope and manual; satin split/stagger/short stitches and three underlays; 36 fill
  patterns (`engine/src/stitch/fills`, metadata in `engine/src/model/patterns.ts`) with hand stitch,
  gradient, underpath and multiple underlay passes. Picker previews are generated from the engine:
  `pnpm --filter @lilo/engine swatches` rewrites `editor/src/assets/fill-swatches/*.png`.
- **⌘K** searches every tool and action.

## The screens, in short (M5)

Nav tabs: **Home**, **Editor**, **Pixel art**, **Converter**, **Lilo Link** (`editor/src/App.tsx`).

- **Click to stitch** (K): `autoDigitize` keeps its trace as `traceRegions` (design mm). The tool
  hit-tests them, highlights the one under the pointer, stitches a click with the panel's settings
  (one undo step; clicking again re-stitches in place), collects shift-clicks for Enter, Esc leaves.
  No second trace. State: `state.trace`, `stitchRegions` in `editorStore.ts`; hit-test and
  region-to-object in `engine/src/clickstitch.ts`.
- **Threads**: the picker reaches all 75 lines (brand, line, search; lines load on demand). **My
  Threads** (Sequencer > Threads) holds the spools you own: add from the catalogue, by photo (Apple
  Vision OCR, ranked candidates, you confirm) or by hand; quantity, notes, JSON import/export. It is
  saved by two restricted Rust commands to `~/Documents/Lilo/my-threads.json`. "Use my threads" in
  Auto digitize snaps to the shelf first.
- **Pixel art**: grid canvas with pencil, fill, erase, eyedropper, line, rectangle; palette from My
  Threads or any brand; tatami, cross or satin; live stitch preview with the player; Send to editor
  (manual-stitch objects, one undo step) and Export. State in `state/pixelStore.ts`.
- **Converter**: drop embroidery files or pictures, tick formats, convert, save one or all. Pictures
  use the editor's Auto digitize settings; PNG/JPG can also be saved as the traced SVG.
- **Export**: PES (default), DST, JEF, VP3, EXP, XXX, U01, PEC, HUS, VIP, TBF, G-code (a stitch path for CNC and plotter tools), or a PNG picture.
- **Projects**: Save / Save As / Open / Revert (⌘S, ⇧⌘S, ⌘O) read and write `.lilo` through the
  engine's project API. Autosave goes to the version history every 30 s and when the window loses
  focus; the file's last explicit save is never overwritten by an autosave. Version history lists
  versions with thumbnails and restores one as a single undo step. Closing, New, Open and Revert ask
  about unsaved changes in an in-page dialog; Cmd-Q, the Dock and the tray's Quit go through the same question (Rust holds the exit back while the editor reports unsaved changes: `app/src-tauri/src/quit.rs`). Saves are fsynced and keep the previous version as `<name>.bak`; a damaged `.lilo` or `my-threads.json` offers that copy instead of failing. Uploaded fonts the text uses are embedded in the project (`fonts/`, up to 20 MB each). Reference images live in `Design.images` (undoable) and
  are saved in the project's `images/` folder.
- **Looking at screens without the app**: `pnpm dev`, then open `http://localhost:5173/?mock`. An
  in-memory platform supplies sample projects, a thread shelf and a canned label OCR result
  (`editor/src/dev/mock.ts`, development only).

Extension points for lettering: add `"text"` to `ObjectKind`, call `registerObjectGenerator` in
`engine/src/stitch/generate.ts`, and enable the `text` entry in `editor/src/tools/registry.ts`.

Thread data lives in `data/threads/*.json`, generated by `node scripts/build-threads.mjs` from the
Ink/Stitch palettes. `pnpm --filter @lilo/engine smoke` runs every test fixture to a PES and prints
object, stitch and colour-change counts.

## Look and hoops (M6a)

- **Glass.** The window is Liquid Glass on macOS 26+ (`window-vibrancy` 0.8.1 `apply_liquid_glass`), a frosted sidebar on older macOS, Mica on Windows 11 and solid on Linux. Panels, the top bar and the tool dock float on it; the canvas stays opaque so thread colours are true. Appearance (top right) has Light / Dark / System and **Reduce transparency** (also on when macOS asks for it). `LILO_GLASS=off|vibrancy` forces a simpler window when chasing a rendering problem. Tokens and the design basis (Apple HIG and the macOS 27 kit) are at the top of `editor/src/glass.css`; `contrast.test.ts` checks WCAG AA over white, black and the colour wash.
- **Hoops.** A library of real hoops and machine fields (`engine/src/hoops/library.json`, each with its source; sizes that could not be confirmed say UNVERIFIED), your own hoops (`~/Documents/Lilo/hoops.json`), a picker (brand, machine, hoop, search, recents), the hoop drawn with its frame, clamp, crosshair and safe margin, rulers with draggable guides, Actual size (⌘0, calibrate with a credit card), "smallest hoop that fits" with a re-hooping warning, and approximate placement guides (suit lining pocket, shirt cuff, cap front, garment bag, left chest).

<!-- compat:start (generated by scripts/build-compat-docs.mjs, do not edit by hand) -->
## Works with

| Brand | File formats the machine takes | Wi-Fi via Lilo Link |
| --- | --- | --- |
| Baby Lock | .pes .phc .phx .pec .dst | Untested (7 models) |
| Barudan | .u01 .dat .dst .dsb | No |
| Bernette | .exp | No |
| Bernina | .art .exp | No |
| Brother | .pes .phc .phx .pec .dst .pen | Untested (14 models) |
| Elna | .emd | No |
| Happy | .tap .dst | No |
| Husqvarna Viking | .vp3 .hus .shv | No |
| Janome | .jef .jef+ .jpx .dst | No |
| Melco | .exp .dst | No |
| Pfaff | .vp3 .hus | No |
| Ricoma | .dst | No |
| Singer | .xxx .pes | No |
| SWF | .dst | No |
| Tajima | .dst .tbf | No |
| Toyota | .100 .10o .dst | No |
| ZSK | .dst .dsz .zxy | No |

17 brands, 66 machines, 75 thread lines (20,784 colours), 52 hoops. Lilo reads and writes DST, EXP, HUS, JEF, PEC, PES, TBF, U01, VIP, VP3, XXX, and writes GCODE only.

**Status: Wi-Fi send tested on: none yet. Brother NV2700 test pending.** Wi-Fi-capable models (Baby Lock, Brother) look compatible but none has been run with Lilo yet. 27 of 66 machine entries were checked against a maker page; the rest say UNVERIFIED.

Full tables: [docs/compatibility.md](docs/compatibility.md). Got a machine? [Tell us how it went](https://github.com/Kadwood/lilo/issues/new?template=machine-report.yml).
<!-- compat:end -->

## Develop

Prerequisites: Node 22+, [pnpm](https://pnpm.io) 10, [Rust](https://rustup.rs) (stable), and the
[Tauri 2 prerequisites](https://tauri.app/start/prerequisites/) (Xcode Command Line Tools on macOS).

```sh
pnpm install
pnpm tauri dev      # desktop app (starts the editor on :5173)
pnpm dev            # editor alone, in a browser (no machine access)
pnpm test           # engine + editor tests
pnpm typecheck
cd app/src-tauri && cargo test
pnpm tauri build --debug    # bundles Lilo.app under app/src-tauri/target/debug/bundle
```

Layout: `app/src-tauri` (Rust shell), `editor/` (React UI, Lilo Link under `editor/src/link`),
`engine/` (stitch generation, no UI), `data/`, `scripts/`, `docs/`.

The app serves a local API on `127.0.0.1:17841`.
Lilo never contacts anyone else's servers. Its only update check goes to this repo's GitHub Releases.
Maintainers: see [docs/RELEASING.md](docs/RELEASING.md).

### End-to-end journeys and performance

`pnpm --filter editor e2e` drives the editor in headless Chromium (`?mock` mode) through eight user journeys and fails on any console error; screenshots land in `editor/e2e/.shots` (or `LILO_SHOTS`). It needs a Chromium: `pnpm --filter editor exec playwright-core install chromium-headless-shell`. Close any other `vite` dev server first (two servers share one dependency cache and stall). In CI it runs only on manual dispatch or with `[e2e]` in a commit message. Performance numbers: `LILO_PERF=1 pnpm --filter @lilo/engine exec vitest run test/perf.test.ts` (engine) and `editor/e2e/perf.e2e.ts` (browser, production build).

## Licence

GPL-3.0. See [LICENSE](LICENSE). Third-party notices: [NOTICE.md](NOTICE.md).

The Kadwood name and logo, and the Lilo name and hibiscus logo, are trademarks of Kadwood. They are not licensed under the GPL-3.0; you may not use them to identify modified versions without permission.
