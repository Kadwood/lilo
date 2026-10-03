import { lazy, Suspense, useEffect, useState } from "react";
import { EditorShell } from "./shell/EditorShell";

// The Link view carries Ember Bridge's whole UI + its (dark) stylesheet; load it on demand.
const LinkApp = lazy(() => import("./link/LinkApp"));

export type View = "editor" | "link";

const fromHash = (): View => (window.location.hash === "#/link" ? "link" : "editor");

export default function App() {
  const [view, setView] = useState<View>(fromHash);

  useEffect(() => {
    const onHash = () => setView(fromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (next: View) => {
    window.location.hash = next === "link" ? "#/link" : "#/";
    setView(next);
  };

  return (
    <div className="app">
      <nav className="app-nav" aria-label="Views">
        <span className="app-logo">Lilo</span>
        <button className={view === "editor" ? "active" : ""} onClick={() => go("editor")}>
          Editor
        </button>
        <button className={view === "link" ? "active" : ""} onClick={() => go("link")}>
          Lilo Link
        </button>
      </nav>
      <div className="app-view">
        {view === "editor" ? (
          <EditorShell />
        ) : (
          <Suspense fallback={<div className="app-loading">Loading Lilo Link…</div>}>
            <LinkApp />
          </Suspense>
        )}
      </div>
    </div>
  );
}
