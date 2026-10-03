# Changelog

## Unreleased

- Stitch defaults are now calibrated to published digitizing norms and live in one table (`engine/src/presets/defaults.ts`): satin density 0.40 mm same-side spacing, fill stitch length 4.0, minimum stitch 0.5, maximum 12.1, underlay chosen by column width.
- Lettering: the default satin underlay and pull compensation changed (underlay now follows the width bands: centre walk, centre + edge, edge + zig-zag, double zig-zag; satin pull is a flat 0.15 mm). Lettering saved with an older Lilo keeps its stored objects, but regenerating or editing a text block re-stitches it slightly differently.
- Auto-digitize gains Quality (Standard / Premium), Thread weight (40 / 60) and Fabric options; Standard now uses a 1.5 mm minimum satin column.
