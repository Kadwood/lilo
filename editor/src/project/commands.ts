import type { AppApi } from "../app/AppContext";
import type { Command } from "../tools/commands";
import type { EditorActions, EditorState } from "../state/editorStore";
import type { ProjectManager } from "./manager";

/** File menu actions in the ⌘K palette: New, Open (a project or a stitch file), Save, Save As, Revert. (Version history is in the main list.) */
export function projectCommands(m: ProjectManager, app: AppApi | undefined, state: EditorState, actions: EditorActions): Command[] {
  const p = m.store.getState();
  const toEditor = (r: Promise<boolean>) => void r.then((ok) => ok && app?.go("editor"));
  const c = (id: string, label: string, run: () => void, extra: Partial<Command> = {}): Command => ({ id: `file.${id}`, group: "File", label, enabled: true, run, ...extra });
  void state;
  return [
    c("new", "New design", () => toEditor(m.newProject()), { shortcut: "⌘N", keywords: "blank empty project" }),
    c("openProject", "Open…", () => toEditor(m.openDialog()), { shortcut: "⌘O", keywords: "project lilo file recent stitch embroidery import pes dst jef vp3 exp xxx u01 pec hus vip tbf" }),
    c("save", "Save", () => void m.save(), { shortcut: "⌘S", keywords: "project lilo" }),
    c("saveAs", "Save As…", () => void m.saveAs(), { shortcut: "⇧⌘S", keywords: "project lilo copy rename" }),
    c("revert", "Revert to saved", () => void m.revert(), { enabled: p.dirty && p.savedAt !== null, keywords: "undo changes last saved" }),
    c("images", "Reference images: add…", () => (app?.go("editor"), actions.setSeqTab("images")), { keywords: "trace picture behind" }),
  ];
}
