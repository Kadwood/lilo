import { DEFAULT_HOOP, type PixelStyle } from "@lilo/engine/light";
import type { EngineClient } from "../engine/client";
import type { EditorActions, EditorState } from "../state/editorStore";
import { PIXEL_TOOLS, isBlank, pixel } from "../state/pixelStore";
import type { Command } from "../tools/commands";
import type { AppApi } from "./AppContext";
import { sendPixelToEditor } from "./pixelSend";

/** Everything the pixel-art screen can do, in the ⌘K palette. */
export function pixelCommands(engine: EngineClient, app: AppApi | undefined, state: EditorState, actions: EditorActions): Command[] {
  const px = pixel.store.getState();
  const filled = !isBlank(px.art);
  const show = () => app?.go("pixel");
  const c = (id: string, label: string, run: () => void, extra: Partial<Command> = {}): Command => ({ id: `pixel.${id}`, group: "Pixel art", label, enabled: true, run, ...extra });
  const out: Command[] = [];
  for (const t of PIXEL_TOOLS) out.push(c(`tool.${t.id}`, `Pixel art: ${t.label} tool`, () => (show(), pixel.actions.setTool(t.id)), { shortcut: t.key.toUpperCase(), keywords: `${t.help} draw paint` }));
  for (const s of ["tatami", "cross", "satin"] as PixelStyle[]) out.push(c(`style.${s}`, `Pixel art: ${s} stitches`, () => (show(), pixel.actions.setStyle(s)), { keywords: "style cell block" }));
  out.push(
    c("open", "Pixel art: open the pixel editor", () => show(), { keywords: "grid sprite" }),
    c("new", "Pixel art: new grid", () => (show(), pixel.actions.load(null)), { keywords: "clear blank 32" }),
    c("undo", "Pixel art: undo", () => pixel.actions.undo(), { enabled: px.undoDepth > 0, shortcut: "⌘Z" }),
    c("redo", "Pixel art: redo", () => pixel.actions.redo(), { enabled: px.redoDepth > 0, shortcut: "⇧⌘Z" }),
    c("clear", "Pixel art: clear the grid", () => pixel.actions.clear(), { enabled: filled }),
    c("send", "Pixel art: send to the editor", () => void sendPixelToEditor(engine, actions, state.design?.hoop ?? DEFAULT_HOOP).then((ok) => ok && app?.go("editor")), { enabled: filled, keywords: "add design objects" }),
    c("export", "Pixel art: export…", () => (show(), pixel.actions.setExportOpen(true)), { enabled: filled, keywords: "pes dst save" }),
  );
  return out;
}
