import type { Hoop } from "@lilo/engine/light";
import type { EngineClient } from "../engine/client";
import type { EditorActions } from "../state/editorStore";
import { isBlank, pixel } from "../state/pixelStore";

/**
 * Send the pixel grid to the editor: its stitches become manual-stitch objects in the current design,
 * centred on what is there, as one undo step. Resolves to whether anything was sent; the reason it
 * wasn't goes to the pixel view's message line.
 */
export async function sendPixelToEditor(engine: EngineClient, actions: Pick<EditorActions, "placeObjects">, hoop: Hoop): Promise<boolean> {
  const art = pixel.store.getState().art;
  try {
    if (isBlank(art)) throw new Error("The grid is empty: paint something first.");
    const r = await engine.call("pixelObjects", art, hoop, {});
    if (r.objects.length === 0) throw new Error("The grid has no stitches to send.");
    actions.placeObjects(r.objects, r.threads, "Add pixel art", { centreOnDesign: true });
    pixel.actions.setMessage({ kind: "ok", text: "Sent to the editor." });
    return true;
  } catch (e) {
    pixel.actions.setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    return false;
  }
}
