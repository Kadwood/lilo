---
id: "layers"
title: "Layers and sew order"
summary: "Pictures and stitch layers in one list. The list is the order the machine sews: bottom first, top last."
section: "preview"
order: 3
keywords: ["layers", "layer", "sew order", "sewing order", "order", "reorder", "hide", "lock", "opacity", "merge", "picture", "reference image", "stack", "top", "bottom"]
appContext: ["panel.layers"]
status: "ready"
---

# Layers and sew order

The **Layers** tab is in the sequencer on the right. It holds your pictures and your stitches in one list. Think of a stack of paper. The paper at the bottom goes down first. The paper on top goes down last, so it sits on top.

**The list is the sew order. The bottom layer sews first. The top layer sews last.**

A banner at the top of the panel says the same thing: "Bottom sews first. Top sews last and sits on top."

## Two kinds of layer

- A **stitch layer** holds shapes. Lilo sews them.
- A **picture layer** holds reference images. Lilo never sews them. They are there to trace over or compare to.

A new design starts with one stitch layer called **Stitches**. Add a picture and Lilo makes a **Picture** layer under it.

## What each layer row shows

- The **eye** shows or hides the layer.
- The **padlock** locks it. Nothing in a locked layer can be picked on the canvas or changed.
- A small **icon** tells you if it is a stitch layer or a picture layer.
- The **name**. Double-click it to rename the layer, or press F2.
- A **sew range**, like "sews 4–7". That means the shapes in this layer are the 4th to the 7th things the machine sews.
- **Up** and **down** arrows move the layer. Up sews it later. Down sews it earlier.
- On a picture layer, an **opacity** slider. Lower it so your stitches stay easy to see.
- The little arrow on the left opens or closes the layer.

Open a stitch layer to see its shapes. Each shape has its own **sew number**. The top of the list sews last, here too.

## Change the order

1. Drag a shape up or down. Drop it on another shape, or on a layer to put it at the end of that layer.
2. Drag a layer by its name to move the whole layer.
3. Or use the keyboard. Click a row, then press **Alt + Up** or **Alt + Down**.

Every move is one undo step. Pictures only go into picture layers. Shapes only go into stitch layers.

### Why order matters

Sew big fills first, then borders, then small details on top. If a fill is sewn after its outline, the fill covers the outline. Put the fill in a lower layer and the outline in a higher one.

## Hidden layers are not sewn

Hiding a **stitch layer** takes it out of the file too. That is how you check one part of a design at a time. It also means a forgotten hidden layer is missing from your sewing. So Lilo tells you:

- The Export and Send windows list "1 layer is hidden — it won't be sewn", with its name.
- The Before you sew card says it too.
- The stitch count, the time and the thread list only count layers you can see.

Hiding a **picture layer** changes nothing in the file.

## Buttons under the banner

- **New stitch layer** and **New picture layer** add an empty layer above the one you have selected.
- **Add image…** puts a picture into the selected picture layer. If there is no picture layer yet, Lilo makes one.
- **Delete layer** removes the selected layer. If it has things in it, Lilo asks first. You can undo it.
- **Merge down** folds the selected layer into the layer below it. Both must be the same kind. The sew order does not change.

## Keyboard

| Key | What it does |
|---|---|
| Up, Down | Move between rows |
| Left, Right | Close or open a layer |
| Space | Show or hide the row |
| L | Lock or unlock a layer |
| Enter | Select the row |
| F2 | Rename |
| Alt + Up, Alt + Down | Move the row. Up sews later |

## Old files

A project from Lilo 1.2 or earlier opens with its pictures in a **Picture** layer and its shapes in a **Stitches** layer. The shapes keep their order, so the stitches come out exactly the same. When you save, the file is in the new format. An older Lilo cannot open it. It says the project was made with a newer Lilo.

## Related

[The sequencer](sequencer.md), [The stitch player](stitch-player.md), [Fewer colour changes](fewer-colour-changes.md)
