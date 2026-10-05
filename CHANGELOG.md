# Changelog

All notable changes to Lilo, newest first. The section for a version becomes that release's notes on
GitHub (the in-app update banner's "What's new" links there).

Add notes under **Unreleased** as you work. `node scripts/bump-version.mjs <x.y.z>` moves them into a
dated section for the release (see [docs/RELEASING.md](docs/RELEASING.md)).

## [Unreleased]

## [1.4.0] - 2026-10-05

- The manual and website now show real screenshots, and the Help panel in the app shows them too (it used to show only grey placeholders).
- **Open stitch files straight in the editor.** PES, DST, JEF, VP3, EXP, XXX, U01, PEC, HUS, VIP and TBF files now open like any other file. You no longer have to go through the Converter. Use **Open…** (File menu, Home or **⌘O**), drop the file on Home, or double-click it in Finder (or right-click, **Open With**, Lilo).
- An opened stitch file becomes a **new project** named after the file, with one layer of the same name, the thread colours from the file, and the smallest hoop of your machine that fits it. It never picks a turned hoop, so nothing gets rotated.
- **Drop a stitch file on a design you already have open** and it joins as a new layer on top. Your design stays as it was, and one **⌘Z** takes the new layer away.
- **Your original file is never changed.** The first Save works like Save As and makes a new .lilo in Documents/Lilo. Only that .lilo shows up in Recent, not the PES.
- If you do not edit a stitch file, saving it back to the same format gives the same needle points (within 0.1 mm). The one exception: a stitch longer than 12.1 mm is still split in two, so it cannot snag. Lilo no longer adds extra tie stitches to, or merges short stitches in, stitches that came from a file.
- A damaged file says: "Lilo couldn't read this file — it may be damaged or a format we don't support." It never crashes Lilo. Files over 32 MB are refused.
- **Open in editor** in the Converter now does the same thing as Open…. The manual page "Opening files" explains it.

## [1.3.0] - 2026-10-05

- **Layers.** The right-hand panel now has a **Layers** tab where pictures and stitch layers sit in one list. The list is the order the machine sews: the bottom layer sews first and the top layer sews last, so it sits on top. Each layer has an eye (show or hide), a padlock, a name you can change, and a "sews 4–7" note that says where it falls in the order. Picture layers have an opacity slider.
- Drag shapes between layers, drag layers to reorder them, or click a row and press Alt with the up or down arrow. Every move is one undo step. Use **New stitch layer**, **New picture layer**, **Delete layer** and **Merge down** under the banner. The whole tab works from the keyboard (arrows, Space to show or hide, L to lock, F2 to rename).
- A **hidden stitch layer is not sewn**. Lilo leaves it out of every exported or sent file, and the stitch count, time and thread list ignore it. Export, Send and Before You Sew all warn you: "1 layer is hidden — it won't be sewn".
- A locked layer cannot be clicked, boxed or changed on the canvas. A picture layer above a stitch layer draws over it, and a hidden picture layer changes nothing in the file.
- Projects are saved in a new format. Old projects open as before: pictures go in a **Picture** layer and shapes in a **Stitches** layer, and the stitches come out exactly the same. Older versions of Lilo will say a project made with 1.3 is from a newer Lilo.
- The right-hand panel is now called **Sew order**. Its old **Shapes** tab is now **Layers**. Colours, Images and Threads are unchanged. The manual has a new page, "Layers and sew order".
- The Stitch safety card follows layers: shapes in a hidden layer aren't counted, and its sliders never change shapes in a locked layer.

## [1.2.0] - 2026-10-05

- **Stitch safety.** Every spacing, stitch length, width and pull setting now has a green band behind its slider. Go outside it and the slider turns amber with one short sentence on why. Lilo still sews it and still exports it. You will see the same sliders in a new **Stitch safety** card in Before you sew, where one slider changes every shape of that kind in one undo step.
- **"What will this change?"** Under each of those sliders, a small line shows how the stitch count and sew time moved, like "+1,240 stitches · +1 min 30 s".
- **Machine speed advice.** Before you sew now says what speed to set on the machine, and why: "Set your machine to 450 stitches a minute (thin lines in this design)". It slows you down for thin lines, small letters, metallic thread and very dense stitching. A file cannot set the speed, so you still set it on the machine.
- **More honest sew time.** The time now counts thread cuts (7 seconds each) and colour changes (45 seconds each, up from 15), plus a quarter extra for real life. Before you sew shows the time at 850 and at the suggested speed.
- **Two new warnings.** "Satin too thin" (under 1.5 mm with 40 wt thread, under 1 mm with 60 wt) and "A long stitch can snag" (over 7 mm on cloth you wear). Both are heads ups only.
- Changed: with 40 wt thread and Premium quality, custom-font letters no longer use satin columns thinner than 1.5 mm. Thinner strokes, like a thin signature, become a running stitch. A 1 mm column is too thin to look shiny and it breaks thread. 60 wt still allows 1 mm.
- **Lilo's own settings are always safe.** A design made only with Lilo's defaults, for any quality, thread weight and fabric (auto-digitize, click-to-stitch, lettering, the sample design), now shows no amber items. To get there: satin columns wider than 6.8 mm are split in halves, a zig-zag underlay is swapped for edge walks under columns wider than 5.5 mm, Premium 40 wt hairlines are 1.5 mm (1.0 mm at 60 wt), thin built-in letter columns are widened to the safe width, and no font sews tighter than 0.35 mm (0.30 mm at 60 wt). Stitch counts barely move: the K logo goes from 1,365 to 1,374, the badge stays at 3,795, and a script word gets lighter (1,911 to 1,700) because the font's 0.30 mm spacing is now 0.35 mm.
- Changed: the "too dense" warning no longer fires for one square millimetre where two lines cross. It still fires for a patch of two or more touching spots, or a pile twice the limit.
- Before you sew now gives one speed to set, not two. The fabric's usual range is part of the reasons under it.
- Numbers in the sliders are rounded (5.8 mm, not 5.828 mm).
- The manual has a new page, "Stitch safety and machine speed".

## [1.1.1] - 2026-10-05

- Fixed: PES files had a short stitch-block header. Brother machines showed only part of the design and sewed it wrong. Lilo now writes the full header, and still opens older Lilo files.
- Fixed: large designs saved as XXX no longer lose stitches. A stitch of exactly 12.4 mm in one direction was turned into a jump, so it was not sewn.
- Every export format (PES, PEC, DST, EXP, JEF, VP3, XXX, U01, TBF, HUS, G-code) is now checked against an independent reader (pyembroidery) on every change. VIP has no independent reader and is checked only by Lilo itself.
- Fixed: menus and pop-ups no longer hide behind the top bar. The Appearance pop-up, the File menu and the drawing-colour picker now sit on top of everything.
- Fixed: Recent projects now include files you opened or saved anywhere, not just Documents/Lilo.
- Fixed: turned hoops now sew the right way round, and the fit check uses the real hoop size.
- Lilo Link's Wi-Fi sending is now covered by tests.

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
