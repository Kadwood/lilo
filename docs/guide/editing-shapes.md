---
id: "editing-shapes"
title: "Editing shapes"
summary: "Reshape, cut holes, slice, set start points, duplicate, lock and map shapes along a path."
section: "digitizing"
order: 4
keywords: ["edit", "reshape", "hole", "knife", "start", "end", "angle", "map to path", "outline", "redwork", "lock", "duplicate", "delete", "shape bar", "points"]
appContext: ["panel.shape-bar", "panel.map", "panel.settings", "dialog.map-to-path"]
status: "ready"
---

# Editing shapes

Click a shape and a small **shape bar** floats above it. It has one button per action. Disabled buttons are greyed out because they do not apply to what you selected.

## The shape bar

- **Reshape.** Move, add and delete points. Double-click a point to switch it between a corner and a curve. You can also double-click a shape to start.
- **Cut hole.** Draw a closed shape inside a fill to cut it out. Use it for the hole in the letter "O" or a ring.
- **Knife.** Drag a line across a shape to slice it in two.
- **Start** and **End.** Click on the canvas to choose where sewing starts and ends. A green marker shows the start and a red one the end. A start near other shapes means fewer jumps.
- **Angle.** Turn the stitch direction with a dial on the canvas. Only for fills.
- **Map to path** (**P**). Repeat the selection along an open line. Read below.
- **Outline** or **Fill.** Converts between an outlined shape and a filled one.
- **Redwork.** Adds a running outline along every edge of the selection, routed to keep jumps short.
- **Lock** or **Unlock.** Locks the selection so you cannot move or edit it by accident.
- **Duplicate** (**⌘D**) and **Delete** (**Backspace**).

## The left panel for a shape

With a shape selected, the left panel shows its settings: **Dimensions**, **Colour**, **Style**, then the stitch settings for its type. Read [Run types](run-types.md), [Underlay and pull compensation](underlay-and-pull.md) and [Satin tips](satin-tips.md).

Every change shows on the canvas straight away. Sliders merge into one undo step.

## Several shapes at once

Select more than one shape and the panel edits all of them. The panel shows the settings of the first shape. Change one control and it applies to everyone selected.

## Map to path

**Map to path** places copies of a shape along an open line. Use it for a row of stars along a garment-bag strap crest, or small leaves along a vine.

1. Select the shape and the open line together, then press **P**. Or select the shape, press **P** and choose a path afterwards.
2. Set the **count** and **spacing** in the dialog.
3. Apply it.

The copies stay linked. Use **Edit…** in the **Map to path** section of the left panel to change the count, or **Detach** to turn them into ordinary shapes.

## Reorder and hide

Open the **Layers** tab in the Sew order panel on the right to change sewing order, hide or lock shapes and layers, or group by colour. Read [Layers and sew order](layers.md).
