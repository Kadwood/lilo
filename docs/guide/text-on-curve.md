---
id: "text-on-curve"
title: "Text on a curve"
summary: "Bend lettering round the top or bottom of a circle, for hat patches, badges and crests."
section: "lettering"
order: 4
keywords: ["curve", "arc", "path", "circle", "badge", "patch", "curved text", "text on path", "ring", "radius", "bend"]
appContext: ["panel.text"]
status: "ready"
---

# Text on a curve

Curved text is what you want round the edge of a hat patch or the rim of a crest. A name along the top of a 50 mm hat patch is a good example.

## Bend the text

1. Choose the **Text** tool (press **T**) and type your words.
2. Find **Curve** in the Text panel. It has three buttons:
   - **Straight** keeps the baseline flat. This is the default.
   - **Arc up** bends the words over the top of a circle. The letters stand on the outside.
   - **Arc down** bends them along the bottom of a circle. The letters stand on the inside, and still read left to right.
3. For a curve, a **Curve radius** slider appears. The radius is the size of the circle in millimetres. A smaller radius bends harder.
4. Press **Add text**.

A curve centres the words on the arc, so **Alignment** is ignored while a curve is on.

## Pick a radius

- The text should be shorter than the arc. A 30 mm radius gives an arc of about 150 mm. That is room for a name at 10 mm tall.
- For a round patch, make the radius a little smaller than the patch radius. A 50 mm patch is 25 mm from the centre, so try 20 mm and make the letters about 6 mm tall.
- If the text is too long for the circle, Lilo says so: "The text is N mm long but the path is only N mm". Make the radius bigger or the letters smaller.

## Change it later

Select the word. The panel becomes **Edit text** and the curve settings load into it. Change the buttons or the slider and press **Update text**. The word stays where you put it, and keeps any rotation you gave it. **⌘Z** undoes the change.

## Top and bottom text on one patch

Add the top words with **Arc up**. Then start new text with **New text**, and add the bottom words with **Arc down**. Move the second word until the two sit on the same circle. Use the **Measure** tool to check the gap.

## Related

[Lettering: built-in fonts](lettering-fonts.md), [Small letters](small-letters.md), [Sizing and hoops](sizing-and-hoops.md)
