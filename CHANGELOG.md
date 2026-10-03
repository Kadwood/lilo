# Changelog

All notable changes to Lilo, newest first. The section for a version becomes that release's notes on
GitHub (the in-app update banner's "What's new" links there).

Add notes under **Unreleased** as you work. `node scripts/bump-version.mjs <x.y.z>` moves them into a
dated section for the release (see [docs/RELEASING.md](docs/RELEASING.md)).

## [Unreleased]

- A guide inside Lilo: a searchable Help panel (Help in the top bar, or ⌘? / Ctrl+?), 49 plain-words pages, a "?" hint next to almost every control (what it does, when to change it, a typical value), a five-step workflow strip that ticks itself (Get a design, Size and hoop, Stitches, Preview, Send), a first-launch tour with four paths that you can replay from Help, and a calm warnings tray with one-click fixes. All the wording lives in `docs/guide/` (`pnpm guide:check` validates it in CI).
- Fixed: the stitch player could crash when a frame's time stamp came before the last one.

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
