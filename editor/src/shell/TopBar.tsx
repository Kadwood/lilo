import { useState } from "react";
import { useEditor } from "../state/store";
import { ExportDialog } from "./ExportDialog";
import { SendDialog } from "./SendDialog";

export function TopBar() {
  const { state, actions } = useEditor();
  const [exportOpen, setExportOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
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
      <span className="topbar-note" role="status">
        {note}
      </span>
      <button onClick={() => setExportOpen(true)} disabled={!hasDesign} title={hasDesign ? undefined : "Digitize an image first"}>
        Export
      </button>
      <button className="primary" onClick={() => setSendOpen(true)} disabled={!hasDesign} title={hasDesign ? undefined : "Digitize an image first"}>
        Send
      </button>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} onSaved={setNote} />}
      {sendOpen && <SendDialog onClose={() => setSendOpen(false)} />}
    </header>
  );
}
