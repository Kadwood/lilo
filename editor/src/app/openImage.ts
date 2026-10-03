import { IMPORT_EXTENSIONS } from "../io/decode";
import { getPlatform } from "../platform";
import type { EditorActions } from "../state/editorStore";

/** The "Open image to auto-digitize" picker: choose a picture and trace it. Shared by the editor, the File menu and ⌘K. */
export async function openImagePicker(actions: Pick<EditorActions, "importFile">): Promise<void> {
  try {
    const f = await getPlatform().openFile({ extensions: IMPORT_EXTENSIONS });
    if (f) await actions.importFile({ name: f.name, bytes: f.bytes });
  } catch (e) {
    console.error("Open failed", e);
  }
}
