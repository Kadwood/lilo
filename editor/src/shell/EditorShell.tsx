import { useState } from "react";
import { TopBar } from "./TopBar";

/** The empty editor frame. Real panels/canvas arrive in later milestones. */
export function EditorShell() {
  const [projectName, setProjectName] = useState("Untitled design");

  return (
    <div className="editor">
      <TopBar projectName={projectName} onRename={setProjectName} />
      <div className="editor-body">
        <aside className="panel panel-left" aria-label="Settings">
          <h2>Settings</h2>
          <p className="muted">Stitch settings will appear here.</p>
        </aside>

        <main className="canvas" aria-label="Canvas">
          <div className="canvas-placeholder">Canvas</div>
          <div className="toolbar" role="toolbar" aria-label="Tools">
            <span className="muted">Tools</span>
          </div>
        </main>

        <aside className="panel panel-right" aria-label="Sequencer">
          <h2>Sequencer</h2>
          <p className="muted">Colour blocks and stitch order will appear here.</p>
        </aside>
      </div>
    </div>
  );
}
