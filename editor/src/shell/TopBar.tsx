import { useState } from "react";
import { getPlatform } from "../platform";
import { loadDemoPes } from "./demo";
import { SendDialog } from "./SendDialog";

export function TopBar({ projectName, onRename }: { projectName: string; onRename: (n: string) => void }) {
  const [sendOpen, setSendOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // M1: Export and Send both use the built-in demo design until real editing lands.
  const exportDemo = async () => {
    setNote(null);
    try {
      const saved = await getPlatform().saveFile("demo.pes", await loadDemoPes());
      if (saved) setNote(`Saved ${saved}`);
    } catch (e) {
      setNote(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <header className="topbar">
      <input
        className="project-name"
        aria-label="Project name"
        value={projectName}
        onChange={(e) => onRename(e.target.value)}
      />
      <span className="topbar-note" role="status">
        {note}
      </span>
      <button onClick={exportDemo}>Export</button>
      <button className="primary" onClick={() => setSendOpen(true)}>
        Send
      </button>
      {sendOpen && <SendDialog onClose={() => setSendOpen(false)} />}
    </header>
  );
}
