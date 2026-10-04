# Changelog

All notable changes to Lilo, newest first. The section for a version becomes that release's notes on
GitHub (the in-app update banner's "What's new" links there).

Add notes under **Unreleased** as you work. `node scripts/bump-version.mjs <x.y.z>` moves them into a
dated section for the release (see [docs/RELEASING.md](docs/RELEASING.md)).

## [Unreleased]

- Fixed: PES files had a short stitch-block header. Brother machines showed only part of the design and sewed it wrong. Lilo now writes the full header, and still opens older Lilo files.
- Fixed: large designs saved as XXX no longer lose stitches. A stitch of exactly 12.4 mm in one direction was turned into a jump, so it was not sewn.
- Every export format (PES, PEC, DST, EXP, JEF, VP3, XXX, U01, TBF, HUS, G-code) is now checked against an independent reader (pyembroidery) on every change. VIP has no independent reader and is checked only by Lilo itself.
- **Menus and pop-ups no longer hide behind the top bar.** The Appearance pop-up, the File menu and the drawing-colour picker now sit on top of everything.
- Recent projects now include files you opened or saved anywhere, not just Documents/Lilo.

## [1.1.0] - 2026-10-04

Help when you need it.

- **A built-in manual.** 49 short, friendly pages, right inside Lilo. Press ⌘? (Ctrl+? on Windows and Linux) or click Help. It is also on lilo.kadwood.com/manual.
- **A "?" next to every setting.** It tells you what the setting does, when to change it and a good starting value.
- **A first-launch tour.** Pick what you want to do: stitch a picture, draw from scratch, make a monogram or open a file. Lilo walks you through it. You can replay it from Help.
- **A step-by-step guide along the top:** Get a design → Size and hoop → Stitches → Preview → Send. Each step ticks itself off as you go.
- **Friendly warnings.** If something will not sew well, such as letters that are too small, a design too big for the hoop or a crowded patch, Lilo tells you and offers a one-click fix.
- **Curved text.** Bend words into an arc, up or down, with a radius slider.
- Fixed: the stitch player could stop when a frame arrived out of order.

## [1.0.0] - 2026-10-04

The first release of Lilo: free, open-source embroidery for Mac, Windows and Linux.

- **Turn a picture into stitches.** Drop in a logo or drawing. Lilo traces it, picks matching threads and makes satin, fill and running stitches. Click any part to stitch it your way.
- **Draw and edit.** Shapes, pen, satin columns, holes, a knife and map-to-path. Seven stitch types and 36 fill patterns, with undo.
- **Letters and monograms.** 108 built-in embroidery fonts, or use your own font file. Lilo warns you when letters are too small to sew well.
- **Real threads.** 75 thread lines from 44 brands (20,784 colours). Keep your own spools in My Threads, and add one by taking a photo of its label.
- **See it before you sew.** A stitch player that stops at every thread change, a realistic preview, and a "Before you sew" checklist.
- **Good stitching by default.** Settings follow published digitizing norms. Pick your fabric, thread weight and Standard or Premium quality.
- **Hoops.** 52 hoops from the main brands, or add your own. Rulers, a true actual-size view and placement guides.
- **Send to your machine.** Save as PES, DST, JEF, VP3, EXP, XXX, U01, PEC, HUS, VIP, TBF or G-code. Brother and Baby Lock Wi-Fi machines are found automatically on your network.
- **Also:** pixel art, a file converter, projects that save themselves with version history, and automatic updates.
- Free forever, no account, works offline. GPL-3.0.

Windows: the installer is not signed yet, so Windows may show a blue box. Click **More info**, then **Run anyway**.
