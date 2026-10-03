import { useState } from "react";
import { HoopSelect } from "../panels/DesignSection";
import { useEditor } from "../state/store";
import { ExportDialog } from "./ExportDialog";
import { SendDialog } from "./SendDialog";

export function TopBar() {
  const { state, actions } = useEditor();
  const [note, setNote] = useState<string | null>(null);
  const hasDesign = state.design !== null && (state.planResult?.stats.stitchCount ?? 0) > 0;

  return (
    <header className="topbar">
      <input
        className="project-name"
        aria-label="Project name"
        value={state.projectName}
        onChange={(e) => actions.setName(e.target.value)}
      />
      <HoopSelect compact />
      <span className="topbar-note" role="status">
        {note}
      </span>
      <button className="palette-hint" onClick={() => actions.setPaletteOpen(true)} title="Search every tool and action">
        Search… <kbd>⌘K</kbd>
      </button>
      <button onClick={() => actions.setDialog("export")} disabled={!hasDesign} title={hasDesign ? undefined : "Draw or digitize something first"}>
        Export
      </button>
      <button className="primary" onClick={() => actions.setDialog("send")} disabled={!hasDesign} title={hasDesign ? undefined : "Draw or digitize something first"}>
        Send
      </button>
      {state.dialog === "export" && <ExportDialog onClose={() => actions.setDialog(null)} onSaved={setNote} />}
      {state.dialog === "send" && <SendDialog onClose={() => actions.setDialog(null)} />}
    </header>
  );
}
