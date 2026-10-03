import { CanvasView } from "../canvas/CanvasView";
import { Toolbar } from "../canvas/Toolbar";
import { IMPORT_EXTENSIONS } from "../io/decode";
import { DesignSection } from "../panels/DesignSection";
import { DigitizePanel } from "../panels/DigitizePanel";
import { Sequencer } from "../panels/Sequencer";
import { SettingsPanel } from "../panels/SettingsPanel";
import { StitchPlayer } from "../panels/StitchPlayer";
import { getPlatform } from "../platform";
import { useEditor } from "../state/store";
import { CommandPalette } from "./CommandPalette";
import { TopBar } from "./TopBar";

/** Ask the canvas to fit the view (the palette has no handle on the canvas). */
export const FIT_EVENT = "lilo:fit";
const fit = () => window.dispatchEvent(new Event(FIT_EVENT));

/**
 * The editor frame: top bar, a contextual settings panel (the selection's settings, or Auto-digitize
 * and the hoop when nothing is selected), canvas + stitch player + toolbar, sequencer, ⌘K palette.
 */
export function EditorShell() {
  const { state, actions } = useEditor();

  const open = async () => {
    try {
      const f = await getPlatform().openFile({ extensions: IMPORT_EXTENSIONS });
      if (f) await actions.importFile({ name: f.name, bytes: f.bytes });
    } catch (e) {
      console.error("Open failed", e);
    }
  };

  return (
    <div className="editor">
      <TopBar />
      <div className="editor-body">
        {state.selectedIds.length > 0 ? (
          <SettingsPanel />
        ) : (
          <DigitizePanel onOpen={open}>
            <DesignSection />
          </DigitizePanel>
        )}

        <main className="canvas" aria-label="Canvas">
          <CanvasView onOpen={open} />
          <StitchPlayer />
          <Toolbar />
        </main>

        <Sequencer />
      </div>
      <CommandPalette openImage={open} fit={fit} />
    </div>
  );
}
