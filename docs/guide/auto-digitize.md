---
id: "auto-digitize"
title: "Turn a picture into stitches"
summary: "Open a logo or sketch and let Lilo trace it, pick thread colours and lay stitches."
section: "digitizing"
order: 1
keywords: ["auto digitize", "picture", "logo", "image", "png", "jpg", "svg", "trace", "colours", "background", "region", "digitize"]
appContext: ["panel.digitize", "view.editor"]
status: "ready"
---

# Turn a picture into stitches

**Digitizing** means turning a picture into stitch instructions. Lilo can do the whole thing in one go. This is called **Auto digitize**.

## Open a picture

Use **Digitize a picture…** on Home, or **Open image…** in the left panel. You can also drop a PNG, JPG, WEBP or SVG file onto the canvas.

Flat, high-contrast pictures work best: a logo, a crest, a simple drawing. Photos with soft shading make messy embroidery, because thread cannot blend like pixels do.

## The settings, top to bottom

- **Colours** is how many thread colours to use, from 2 to 12. Fewer colours mean fewer thread changes and a faster sew. Start with the number of colours you see.
- **Size (mm)** is the width and height of the finished design. Leave one box on **auto** and Lilo keeps the shape. Small details drop out below about 80 mm for fine serif logos, so size up if the hairlines vanish.
- **Smallest region** drops tiny specks. A region smaller than this many square millimetres is merged away. Raise it if you see dust-like dots.
- **Background** is **Remove** or **Keep**. **Remove** treats the picture's background colour as empty cloth. Choose **Keep** if the background is part of the design.
- **Thread brand** picks the thread range to match against. Read [Thread brands and matching](thread-brands-matching.md).
- **Quality**, **Thread weight** and **Fabric** make up the Sewing setup. Read [Standard or Premium](standard-vs-premium.md).
- **Use my threads** matches colours to the spools you own first. Read [My Threads](my-threads.md).

Press **Digitize** to run it again after you change a setting.

## What Lilo does

1. It shrinks the picture and removes the background.
2. It reduces the picture to your chosen number of colours.
3. It snaps each colour to the nearest real thread.
4. It traces the shapes.
5. It decides how to stitch each shape. Thin lines become a running stitch. Medium shapes become satin columns. Wide shapes become fills with underlay.
6. It orders the shapes so the machine jumps as little as possible.

Everything it makes is editable. Select any shape and change it.

## If the result looks wrong

- **Too many colours:** lower **Colours**.
- **Missing thin lines:** make the design larger, or choose **Premium**, which sews fine strokes as narrow satin.
- **Messy specks:** raise **Smallest region**.
- **Wrong colours:** change the thread in the left panel after selecting a shape, or use the **Colours** tab in the sequencer to merge or swap.

When you want control over which parts get stitched, use [Click to stitch](click-to-stitch.md).
