import { CanvasView } from "../canvas/CanvasView";
import { IMPORT_EXTENSIONS } from "../io/decode";
import { TextDock } from "../lettering/TextPanel";
import { DigitizePanel } from "../panels/DigitizePanel";
import { Sequencer } from "../panels/Sequencer";
import { StitchPlayer } from "../panels/StitchPlayer";
import { getPlatform } from "../platform";
import { useEditor } from "../state/store";
import { TopBar } from "./TopBar";

/** The editor frame: top bar, Auto-digitize panel, canvas + stitch player, sequencer. */
export function EditorShell() {
  const { actions } = useEditor();

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
        <DigitizePanel onOpen={open} />

        <main className="canvas" aria-label="Canvas">
          <CanvasView onOpen={open} />
          <TextDock />
          <StitchPlayer />
          <div className="toolbar" role="toolbar" aria-label="Tools">
            <span className="muted">Tools</span>
          </div>
        </main>

        <Sequencer />
      </div>
    </div>
  );
}
