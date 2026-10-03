# Lilo by Kadwood

Free, open-source embroidery digitizing. Turn images, SVGs and fonts into stitch files and send them to your machine over Wi-Fi.

> Status: **M1 (Foundation)**. The app builds and runs: an empty editor frame, the Lilo Link
> view (machine discovery and Wi-Fi send, forked from Ember Bridge), and an engine that writes a
> demo PES. Export and Send use that demo design; real editing comes in later milestones.

## What it will do (v1)

- Auto digitize: PNG/JPG → SVG → stitches, with a live tracing animation
- Click-to-stitch, full drawing editor, every run type and fill pattern
- Lettering: ~100 built-in embroidery fonts, plus your own TTF/OTF
- Stitch player with thread-change stops and realistic preview
- Thread catalogue for many brands, plus a "My threads" shelf
- Pixel art editor and file converters
- PES export and Wi-Fi send to Brother machines (Lilo Link)

One desktop app for macOS, Windows and Linux. No account needed.

## Built on

- [stitchjs](https://github.com/stitchables/stitchjs) (MIT): stitch engine
- [Ember Bridge](https://github.com/EmberSoftwareInc/ember-bridge) (MIT): Wi-Fi transfer, forked as Lilo Link
- [Ink/Stitch](https://github.com/inkstitch/inkstitch) (GPL-3.0): thread palettes, lettering fonts
- [vtracer](https://github.com/visioncortex/vtracer) (MIT): image tracing

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

The app serves a local API on `127.0.0.1:17841` (Ember Bridge used 17831, so both can be installed).
Lilo never contacts Ember's servers and has no auto-updater.

## Licence

GPL-3.0. See [LICENSE](LICENSE). Third-party notices (including Ember Bridge, MIT): [NOTICE.md](NOTICE.md).
