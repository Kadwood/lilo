/**
 * The tool registry: one entry per tool in the bottom toolbar, command palette and keyboard
 * shortcuts. Handlers for the drawing tools live in `canvas/tools.ts`.
 *
 * The Text tool opens the lettering panel (`lettering/TextPanel.tsx`); a click on the canvas sets
 * where new text lands (`canvas/controller.ts`).
 */

export type ToolId = "select" | "pan" | "measure" | "open" | "closed" | "circle" | "rect" | "pen" | "satin" | "text" | "manual";

export interface ToolInfo {
  id: ToolId;
  label: string;
  /** Single-key shortcut (also shown on the button). */
  key: string;
  /** Short glyph for the button; real icons are SVG paths in `Toolbar`. */
  help: string;
  /** False for placeholders another milestone fills in. */
  enabled: boolean;
}

export const TOOLS: readonly ToolInfo[] = [
  { id: "select", label: "Select", key: "s", help: "Click to select, drag to move, drag on empty space to box-select. Shift adds to the selection.", enabled: true },
  { id: "pan", label: "Pan", key: " ", help: "Drag to move the view. Hold Space for a quick pan with any tool.", enabled: true },
  { id: "measure", label: "Measure", key: "m", help: "Drag between two points to read the distance.", enabled: true },
  { id: "open", label: "Open shape", key: "1", help: "Click to add points. Right-click or double-click for a curve point. Enter finishes, Esc cancels.", enabled: true },
  { id: "closed", label: "Closed shape", key: "2", help: "Like Open shape, but the outline closes into a fill. Click the first point or press Enter to close.", enabled: true },
  { id: "circle", label: "Circle", key: "3", help: "Drag a box for an ellipse. Hold Ctrl for a perfect circle.", enabled: true },
  { id: "rect", label: "Rectangle", key: "4", help: "Drag a box. Hold Ctrl for a square.", enabled: true },
  { id: "pen", label: "Pen", key: "5", help: "Draw freehand; the line is smoothed when you let go. Finish near the start to close it.", enabled: true },
  { id: "satin", label: "Satin blocks", key: "6", help: "Click the left edge, then the right edge, and repeat along the column. Enter finishes.", enabled: true },
  { id: "text", label: "Text", key: "t", help: "Click where the text should go, then type in the panel. Select a word to edit it.", enabled: true },
  { id: "manual", label: "Manual stitch", key: "7", help: "Click to place each stitch exactly where you want the needle. Enter finishes.", enabled: true },
];

export const toolInfo = (id: ToolId): ToolInfo => TOOLS.find((t) => t.id === id) ?? TOOLS[0];

/** Tool for a typed key, or null. Disabled tools don't respond. */
export function toolForKey(key: string): ToolId | null {
  const k = key.toLowerCase();
  const t = TOOLS.find((x) => x.key === k && x.enabled && x.id !== "pan");
  return t ? t.id : null;
}

/** Tools that draw a new object (as opposed to select, pan and measure). */
export const DRAWING_TOOLS: readonly ToolId[] = ["open", "closed", "circle", "rect", "pen", "satin", "manual", "text"];
