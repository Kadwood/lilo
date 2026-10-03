# Changelog

All notable changes to Lilo, newest first. The section for a version becomes that release's notes on
GitHub (the in-app update banner's "What's new" links there).

Add notes under **Unreleased** as you work. `node scripts/bump-version.mjs <x.y.z>` moves them into a
dated section for the release (see [docs/RELEASING.md](docs/RELEASING.md)).

## [Unreleased]

- Faster on big designs: changing one shape re-stitches only that shape (about 60 ms instead of 2.4 s on a 300-object design); the canvas draws stitches as GPU quads that are culled off screen and simplified when zoomed out, so panning a 76,000-stitch design no longer freezes the window; version history is stored as small deltas (a project with 50 versions went from 9.4 MB to 1.7 MB and saves in a fifth of the time).
- Minimum stitch follows quality (Standard 0.5 mm, Premium 0.6 mm). Custom-font lettering uses a 1.5 mm (Standard) or 1.0 mm (Premium) narrowest column, and the Text panel warns when letters are under 6 mm (40 wt) or 4 mm (60 wt), following the Sewing setup.
- Fixed: the colour-change card hid under the tool dock, the File menu hid under the side panels, Home thumbnails could fail to load, and the Send dialog kept re-making its file in a loop.
- A Playwright journey suite (`pnpm --filter editor e2e`, opt-in in CI) covers the main screens end to end.
- New file formats: Husqvarna HUS, Pfaff/Viking VIP and Tajima TBF can be exported and opened, and G-code (a stitch path for CNC and plotter tools) can be exported. They are in the Export dialog and the Converter. HUS and TBF are checked against pyembroidery; VIP and all four are not yet tried on real machines. Janome JEF+/JPX is not supported (the layout is unpublished).

- Stitch defaults are now calibrated to published digitizing norms and live in one table (`engine/src/presets/defaults.ts`): satin density 0.40 mm same-side spacing, fill stitch length 4.0, minimum stitch 0.5, maximum 12.1, underlay chosen by column width.
- Lettering: the default satin underlay and pull compensation changed (underlay now follows the width bands: centre walk, centre + edge, edge + zig-zag, double zig-zag; satin pull is a flat 0.15 mm). Lettering saved with an older Lilo keeps its stored objects, but regenerating or editing a text block re-stitches it slightly differently.
- Auto-digitize gains Quality (Standard / Premium), Thread weight (40 / 60) and Fabric options; Standard now uses a 1.5 mm minimum satin column.
