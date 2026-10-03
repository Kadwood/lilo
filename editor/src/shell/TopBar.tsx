import { useEffect, useState } from "react";
import { HoopSelect } from "../panels/DesignSection";
import { FileMenu } from "../project/FileMenu";
import { HistoryPanel } from "../project/HistoryPanel";
import { useProject, useProjectState } from "../project/ProjectProvider";
import { useEditor } from "../state/store";
import { ExportDialog } from "./ExportDialog";
import { SendDialog } from "./SendDialog";

export function TopBar() {
  const { state, actions } = useEditor();
  const [note, setNote] = useState<string | null>(null);
  const dirty = useProjectState((s) => s.dirty);
  const project = useProject();
  const projectNotice = useProjectState((s) => s.notice);
  // a "Saved" note is for a moment, an error stays until the next action
  useEffect(() => {
    if (projectNotice?.kind !== "ok") return;
    const t = setTimeout(project.clearNotice, 4000);
    return () => clearTimeout(t);
  }, [project, projectNotice]);
  const hasDesign = state.design !== null && (state.planResult?.stats.stitchCount ?? 0) > 0;

  return (
    <header className="topbar" data-tauri-drag-region>
      <FileMenu />
      <input
        className="project-name"
        aria-label="Project name"
        value={state.projectName}
        onChange={(e) => actions.setName(e.target.value)}
      />
      {dirty && (
        <span className="unsaved-dot" role="img" aria-label="Unsaved changes" title="Unsaved changes">
          ●
        </span>
      )}
      <HoopSelect compact />
      <span className="topbar-note" role="status" data-tauri-drag-region>
        {projectNotice?.text ?? note}
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
      {state.dialog === "history" && <HistoryPanel onClose={() => actions.setDialog(null)} />}
    </header>
  );
}
