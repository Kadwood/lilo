import { useEffect, useRef, useState, type ReactNode } from "react";
import { useApp } from "../app/AppContext";
import { openImagePicker } from "../app/openImage";
import { useEditor } from "../state/store";
import { useProject, useProjectState } from "./ProjectProvider";

interface Item {
  label: string;
  shortcut?: string;
  enabled?: boolean;
  run: () => void;
}

/**
 * The File menu: New, Open, Save, Save As, Revert, Version history, Open image, Export, Send.
 * Keyboard: Enter or Down opens it, arrows move, Enter runs, Esc closes and gives focus back.
 */
export function FileMenu({ children }: { children?: ReactNode }) {
  const m = useProject();
  const app = useApp();
  const { state, actions } = useEditor();
  const savedAt = useProjectState((s) => s.savedAt);
  const dirty = useProjectState((s) => s.dirty);
  const hasStitches = (state.planResult?.stats.stitchCount ?? 0) > 0;
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);

  const go = (p: Promise<boolean>) => void p.then((ok) => ok && app.go("editor"));
  const items: (Item | "sep")[] = [
    { label: "New", shortcut: "⌘N", run: () => go(m.newProject()) },
    { label: "Open…", shortcut: "⌘O", run: () => go(m.openDialog()) },
    { label: "Open image to auto-digitize…", run: () => void openImagePicker(actions) },
    "sep",
    { label: "Save", shortcut: "⌘S", run: () => void m.save() },
    { label: "Save As…", shortcut: "⇧⌘S", run: () => void m.saveAs() },
    { label: "Revert to saved", enabled: dirty && savedAt !== null, run: () => void m.revert() },
    { label: "Version history…", run: () => actions.setDialog("history") },
    "sep",
    { label: "Export…", enabled: hasStitches, run: () => actions.setDialog("export") },
    { label: "Send to machine…", enabled: hasStitches, run: () => actions.setDialog("send") },
  ];
  const actionable = items.flatMap((it, i) => (it !== "sep" && it.enabled !== false ? [i] : []));

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const run = (it: Item) => {
    close();
    if (it.enabled !== false) it.run();
  };

  useEffect(() => {
    if (!open) return;
    setIndex(actionable[0] ?? 0);
    menu.current?.focus();
    const away = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const move = (d: 1 | -1) => {
    const at = actionable.indexOf(index);
    setIndex(actionable[(at + d + actionable.length) % actionable.length]);
  };

  return (
    <div className="file-menu">
      <button
        ref={button}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        File
      </button>
      {open && (
        <ul
          ref={menu}
          className="menu"
          role="menu"
          aria-label="File"
          tabIndex={-1}
          aria-activedescendant={`file-item-${index}`}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), move(1));
            else if (e.key === "ArrowUp") (e.preventDefault(), move(-1));
            else if (e.key === "Home") (e.preventDefault(), setIndex(actionable[0]));
            else if (e.key === "End") (e.preventDefault(), setIndex(actionable[actionable.length - 1]));
            else if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), close());
            else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              const it = items[index];
              if (it && it !== "sep") run(it);
            } else if (e.key === "Tab") setOpen(false);
          }}
        >
          {items.map((it, i) =>
            it === "sep" ? (
              <li key={`sep-${i}`} role="separator" />
            ) : (
              <li key={it.label} id={`file-item-${i}`} role="menuitem" aria-disabled={it.enabled === false} className={`${i === index ? "active" : ""}${it.enabled === false ? " disabled" : ""}`} onMouseEnter={() => it.enabled !== false && setIndex(i)} onClick={() => run(it)}>
                <span>{it.label}</span>
                {it.shortcut && <kbd>{it.shortcut}</kbd>}
              </li>
            ),
          )}
        </ul>
      )}
      {children}
    </div>
  );
}
