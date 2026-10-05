---
id: "converter"
title: "The converter"
summary: "Change an embroidery file to another format, or turn pictures into stitches or a traced SVG, many files at once."
section: "tools"
order: 2
keywords: ["converter", "convert", "format", "batch", "pes", "dst", "jef", "svg", "trace", "warnings", "save all", "open in editor"]
appContext: ["view.converter"]
status: "ready"
---

# The converter

The **converter** changes files from one format to another. Use it when a client sends a DST and your machine needs a PES.

## Steps

1. Open **Converter** from the top of the window.
2. Drop files onto the box, or press **Choose files…**. You can use embroidery files (PES, DST, JEF, VP3, EXP, XXX, U01, PEC, HUS, VIP, TBF) or pictures (PNG, JPG, WEBP, SVG).
3. Tick the formats you want. You can tick several.
4. Press **Convert**.
5. Under **Results**, press **Save…** next to a result, or **Save all**.

You can remove a file from the list with its **Remove** button, or clear the whole list.

## Open in the editor

Press **Open in editor** on an embroidery file to bring it into the editor. This works exactly like **Open…** on Home: the file becomes a new project named after it, with one stitch layer of **Manual stitch** shapes. If you already have a design open, the file arrives as a new layer on top instead, and one **⌘Z** takes it away. You can move and resize the shapes. You cannot change their stitch type, because the original instructions are fixed stitch points.

You do not have to use the converter to open a file. Read [Opening files](opening-files.md).

## Warnings

Conversions can lose something. The results list shows a warning when:

- the source file had no thread colours,
- the target format cannot keep colours,
- stops were converted,
- stitches were longer than the target allows.

Read the warnings before you save. Formats such as DST, EXP and U01 do not keep thread colours. Read [File formats](formats-reference.md).

## Pictures

A picture can become **stitches** (with the same auto-digitize as the editor) or a **traced SVG** you can edit in a drawing app.

## Related

[Opening files](opening-files.md)
