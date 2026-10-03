import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useStore } from "zustand";
import { useApp } from "../app/AppContext";
import { useEngine } from "../engine/context";
import { collectCustomFonts, restoreCustomFonts } from "../lettering/fonts";
import { getPlatform } from "../platform";
import { pixel } from "../state/pixelStore";
import { getShelf } from "../state/shelfStore";
import { useEditorActions, useEditorSelector } from "../state/store";
import { createProjectManager, type ProjectManager, type ProjectState } from "./manager";

/** Autosave into the version history this often (and whenever the window loses focus). */
export const AUTOSAVE_MS = 30_000;

const ProjectContext = createContext<ProjectManager | null>(null);

export function useProject(): ProjectManager {
  const m = useContext(ProjectContext);
  if (!m) throw new Error("useProject must be used inside <ProjectProvider>");
  return m;
}

/** The project manager, or null where there is no provider (a lone component in a test). */
export const useOptionalProject = (): ProjectManager | null => useContext(ProjectContext);

/** A slice of the project's state (path, dirty, history, notice...). */
export function useProjectState<T>(select: (s: ProjectState) => T): T {
  return useStore(useProject().store, select);
}

/**
 * Wires the project manager to the app: unsaved-change tracking, the 30 s and on-blur autosave, files
 * the OS opens (double-click), the close guard, and the window title.
 */
export function ProjectProvider({ children, manager }: { children: ReactNode; manager?: ProjectManager }) {
  const engine = useEngine();
  const { api, actions } = useEditorActions();
  const m = useMemo(() => manager ?? createProjectManager({ editor: { api, actions }, engine, platform: getPlatform, pixel, shelf: getShelf, fonts: { collect: collectCustomFonts, restore: restoreCustomFonts } }), [manager, api, actions, engine]);

  useEffect(() => m.start(), [m]);

  // autosave: on a timer and when the window loses focus or is hidden
  useEffect(() => {
    const run = () => void m.autosave();
    const timer = setInterval(run, AUTOSAVE_MS);
    const hidden = () => document.visibilityState === "hidden" && run();
    window.addEventListener("blur", run);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clearInterval(timer);
      window.removeEventListener("blur", run);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [m]);

  // a project the OS asks us to open (Finder double-click, "Open With")
  const app = useApp();
  const goRef = useRef(app.go);
  goRef.current = app.go;
  useEffect(() => getPlatform().onOpenFile((file) => void m.openFile(file).then((ok) => ok && goRef.current("editor"))), [m]);

  // closing the window asks about unsaved changes first; the browser can only use its own prompt
  useEffect(() => {
    const off = getPlatform().onCloseRequested(() => m.closeRequested());
    const before = (e: BeforeUnloadEvent) => {
      if (getPlatform().kind === "browser" && m.store.getState().dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => {
      off();
      window.removeEventListener("beforeunload", before);
    };
  }, [m]);

  // window title: name, a dot while there is something unsaved
  const name = useEditorSelector((s) => s.projectName);
  const dirty = useStore(m.store, (s) => s.dirty);
  useEffect(() => {
    document.title = `${name || "Untitled design"}${dirty ? " •" : ""} — Lilo`;
  }, [name, dirty]);

  // the shell holds back quits it can't ask about (Cmd-Q, the tray) while this is true
  useEffect(() => getPlatform().setDirty(dirty), [dirty]);

  return <ProjectContext.Provider value={m}>{children}</ProjectContext.Provider>;
}
