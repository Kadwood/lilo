---
id: "text-on-curve"
title: "Text on a curve"
summary: "How curved lettering works today, what the warnings mean and a way to curve a word by hand."
section: "lettering"
order: 4
keywords: ["curve", "arc", "path", "circle", "badge", "patch", "curved text", "text on path", "ring"]
appContext: ["panel.text", "panel.map"]
status: "ready"
---

# Text on a curve

Curved text is what you want around the edge of a round hat patch or the rim of a crest.

## What the lettering engine can do

The lettering engine can place letters along a line or an arc. It spaces each letter and turns it to follow the curve. When the text is longer than the path, it warns you: "The text is N mm long but the path is only N mm; the end runs off the path."

## What the Text panel offers today

The Text panel does not have a curve control yet. Until it does, use one of these ways.

### Way 1: place letters one at a time

1. Draw the curve you want with an **Open shape**.
2. Add each letter as its own text with the **Text** tool.
3. Select a letter and drag the round **rotate handle** above its selection box to turn it. Hold **Ctrl** to snap to 15 degrees.
4. Move it onto the curve. Use the **Measure** tool to keep spacing even.

This is slow but gives you full control for short words, like a name on a badge.

### Way 2: use a straight word and a patch design

For a round hat patch of about 50 mm, a short word along the bottom with a straight baseline often looks fine. Put a satin border round the edge with a **Circle** and the **Satin** run type.

## Check the fit

Whichever way you choose, check the **Measure** tool against the hoop. Read [Sizing and hoops](sizing-and-hoops.md).

## Related

[Lettering: built-in fonts](lettering-fonts.md), [Map to path](editing-shapes.md)
