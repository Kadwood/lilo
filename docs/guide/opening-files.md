---
id: "opening-files"
title: "Opening files"
summary: "Which files Lilo can open, how to open them and what happens to an embroidery file (PES, DST and more) you open."
section: "tools"
order: 3
keywords: ["open", "import", "drop", "png", "jpg", "webp", "svg", "pes", "dst", "jef", "vp3", "exp", "xxx", "u01", "pec", "hus", "vip", "tbf", "lilo", "file", "drag", "existing design", "double-click", "open with", "stitch file", "add as layer"]
appContext: ["view.home", "panel.digitize"]
status: "ready"
---

# Opening files

Lilo opens three kinds of files.

## Pictures: PNG, JPG, WEBP, SVG

Open a picture to digitize it. Use **Digitize a picture…** on Home, **Open image…** in the left panel, or drop the file on the canvas. Read [Turn a picture into stitches](auto-digitize.md).

SVG files are drawings. They trace more cleanly than photos.

## Lilo projects: .lilo

A **.lilo** file is a full project: shapes, settings, reference images and version history. Open with **Open…** on Home or **⌘O**. Double-clicking a .lilo file opens it in Lilo. Read [Projects and autosave](projects-and-autosave.md).

## Embroidery files (PES, DST and friends)

Lilo opens PES, DST, JEF, VP3, EXP, XXX, U01, PEC, HUS, VIP and TBF straight in the editor. You do not need the converter first.

**Ways to open one:**

- **Open…** on Home, or **File, then Open…**, or **⌘O**. Pick the file.
- Drop the file on Home. It opens, like Open….
- Double-click it in Finder, or right-click and choose **Open With, then Lilo**.
- Drop it on the editor canvas when a design is already open. Read the next part.

**What you get:**

- A **new project** named after the file. A file called `rooster.pes` becomes a project called "rooster".
- One **stitch layer** with the same name. Read [Layers](layers.md).
- The thread colours from the file. PES and PEC colours get Brother thread names.
- The **smallest hoop** that fits it, from your machine's hoops.

**Dropping a file on a design you already have open** does not replace it. The file's stitches arrive as a **new layer on top**. One **⌘Z** takes it away again.

**Your original file is never changed.** The first **Save** asks where to put a new `.lilo` project, like Save As. The original PES stays exactly as it was.

A file that has already been stitched has fixed needle points. Lilo shows them as **Manual stitch** shapes. You can move, resize and re-colour them, but you cannot change a fill's pattern, because the pattern is gone. If you do not edit them, saving the design back to the same format gives the same needle points.

To change a file's format without opening it, use the [converter](converter.md).

## When a file will not open

- Check the ending. Lilo does not read every format. See [File formats](formats-reference.md).
- If Lilo says **"Lilo couldn't read this file"**, the file is damaged or is a format we don't support. Try the original from where you got it.
- Files over 32 MB are refused. A real stitch file is far smaller than that.
- Very large files may be slow. Close other windows.
- If a file is damaged, try the original from where you got it.

## Where projects live

New projects save to **Documents, then Lilo**. Home shows the most recent ones as cards with a thumbnail.
