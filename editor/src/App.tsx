import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { AppContext, VIEW_HASH, viewFromHash, useApp, type AppApi, type View } from "./app/AppContext";
import { ConverterView } from "./app/ConverterView";
import { HomeView } from "./app/HomeView";
import { PixelView } from "./app/PixelView";
import { EngineProvider } from "./engine/context";
import { ConfirmDialog } from "./project/ConfirmDialog";
import { ProjectProvider, useProject, useProjectState } from "./project/ProjectProvider";
import { CommandPalette } from "./shell/CommandPalette";
import { EditorShell } from "./shell/EditorShell";
import { EditorProvider, useEditor } from "./state/store";

// The Link view carries Ember Bridge's whole UI + its (dark) stylesheet; load it on demand.
const LinkApp = lazy(() => import("./link/LinkApp"));

export type { View } from "./app/AppContext";

const NAV: { id: View; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "editor", label: "Editor" },
  { id: "pixel", label: "Pixel art" },
  { id: "converter", label: "Converter" },
  { id: "link", label: "Lilo Link" },
];

const isTyping = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

/**
 * Shortcuts that work on every screen: ⌘N, ⌘O, ⌘S, ⇧⌘S for projects, and ⌘K for the palette where the
 * editor (which handles ⌘K itself) is not showing.
 */
function useAppShortcuts() {
  const project = useProject();
  const app = useApp();
  const { state, actions } = useEditor();
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const go = (p: Promise<boolean>) => void p.then((ok) => ok && app.go("editor"));
      if (k === "k") {
        if (app.view === "editor") return; // the canvas shortcuts own it there
        e.preventDefault();
        actions.setPaletteOpen(!state.paletteOpen);
      } else if (k === "n") {
        e.preventDefault();
        go(project.newProject());
      } else if (k === "o" && !isTyping(e.target)) {
        e.preventDefault();
        go(project.openDialog());
      } else if (k === "s") {
        e.preventDefault();
        void (e.shiftKey ? project.saveAs() : project.save());
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [project, app, actions, state.paletteOpen]);
}

function Shell() {
  const app = useApp();
  const { state } = useEditor();
  const dirty = useProjectState((s) => s.dirty);
  useAppShortcuts();

  return (
    <div className="app">
      <nav className="app-nav" aria-label="Views">
        <span className="app-logo">Lilo</span>
        {NAV.map((n) => (
          <button key={n.id} className={app.view === n.id ? "active" : ""} aria-current={app.view === n.id ? "page" : undefined} onClick={() => app.go(n.id)}>
            {n.label}
          </button>
        ))}
        <span className="spacer" />
        {app.view !== "editor" && app.view !== "link" && (
          <span className="app-doc" title="The design in the editor">
            {state.projectName || "Untitled design"}
            {dirty && (
              <span className="unsaved-dot" role="img" aria-label="Unsaved changes">
                {" "}
                ●
              </span>
            )}
          </span>
        )}
      </nav>
      <div className="app-view">
        {app.view === "home" && <HomeView />}
        {app.view === "editor" && <EditorShell />}
        {app.view === "pixel" && <PixelView />}
        {app.view === "converter" && <ConverterView />}
        {app.view === "link" && (
          <Suspense fallback={<div className="app-loading">Loading Lilo Link…</div>}>
            <LinkApp />
          </Suspense>
        )}
      </div>
      {app.view !== "editor" && <CommandPalette />}
      <ConfirmDialog />
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>(() => viewFromHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setView(viewFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const api = useMemo<AppApi>(
    () => ({
      view,
      go(next) {
        window.location.hash = VIEW_HASH[next];
        setView(next);
      },
    }),
    [view],
  );

  return (
    <AppContext.Provider value={api}>
      <EngineProvider>
        <EditorProvider>
          <ProjectProvider>
            <Shell />
          </ProjectProvider>
        </EditorProvider>
      </EngineProvider>
    </AppContext.Provider>
  );
}
