---
id: "warnings-explained"
title: "What the warnings mean"
summary: "Every warning Lilo can show in the tray and in Export or Send, what it means and how to fix it."
section: "help"
order: 2
keywords: ["warning", "outside hoop", "density", "stitch too long", "thin satin", "long stitch", "snag", "colour changes", "stitch count", "small region", "satin too wide", "letters too small", "tray", "fix", "empty", "object failed"]
appContext: ["panel.warnings", "dialog.export", "dialog.send"]
status: "ready"
---

# What the warnings mean

Lilo watches your design while you work. When something might sew badly, a short note appears in the **warnings tray**, in the right-hand column, under the Sewing setup card. It never blocks you. Each note offers a **fix** button or a **Read more** link. You can dismiss any note.

## Outside the hoop

The design is bigger than the hoop's sewing area. The machine cannot sew what is outside.

**Fix:** pick a larger hoop (**Smallest hoop that fits**), or scale the design down. Read [Sizing and hoops](sizing-and-hoops.md).

## Too dense

Too many stitches land in the same 1 square millimetre. The thread may break or the cloth may pucker.

**Fix:** open the shape's settings and raise **Row spacing** (fills) or **Density** (satin). Read [Fixing sew-out problems](sewout-troubleshooting.md).

## A stitch was too long

Stitches over 12 mm can snag, so Lilo split them. The design is fine, but long stitches often mean a big, open fill.

**Fix:** shorten **Stitch length** in a fill, or use a pattern with shorter stitches.

## Satin too thin

A satin column is narrower than the thread can cover well: under 1.5 mm with 40 wt thread, or under 1 mm with 60 wt. It will not look shiny. Stitches pile up and the thread can break.

**Fix:** turn it into a running stitch, make it wider, or switch to **60 wt**. Lilo still makes the file. See [Stitch safety](stitch-safety.md).

## A long stitch can snag

Some stitches are longer than 7 mm and the fabric is something you wear. Long stitches can catch on fingers and buttons. Lilo only splits stitches over 12 mm.

**Fix:** shorten **Stitch length** in a fill or run. Read [Stitch safety](stitch-safety.md).

## A shape made no stitches

A shape could not be stitched, for example if its thread is missing. **Fix:** select the shape and give it a thread.

## The design is empty

Nothing to sew yet. Draw, type or open a picture.

## Many colour changes

More than 8 colour changes. Each is a stop to swap thread on a home machine.

**Fix:** merge similar colours. Read [Fewer colour changes](fewer-colour-changes.md).

## A high stitch count or long sewing time

A design with more than about 30,000 stitches, or over an hour of sewing at 850 stitches a minute (counting stops for thread changes and cuts), is a long sew and a bigger file.

**Fix:** make it smaller, use **Standard** quality, or use fewer fills.

## Tiny regions

A shape under about 1 mm wide is too small to sew as a fill. It will blur or snap thread.

**Fix:** delete it, make it bigger, or turn it into a **Triple** run.

## Satin too wide

A satin column over 8 mm with no split has long, loose stitches.

**Fix:** turn on **Split above** in the **Satin** section, or change the shape to a fill. Read [Satin tips](satin-tips.md).

## Letters too small

The letters are shorter than 6 mm with 40 wt thread, or 4 mm with 60 wt. They will fill in.

**Fix:** make them taller or switch to **60 wt**. Read [Small letters](small-letters.md).

## Fonts and text

- **Below or above the font's range:** the font suits another height. Pick a different font.
- **Custom font small:** custom fonts sew best above a minimum height.
- **Missing glyph:** the font has no letter for a character you typed.
- **Text longer than the path:** the end would run off the curve.

## About dismissing

A dismissed note stays hidden until the problem changes. Reopening the project shows it again.
