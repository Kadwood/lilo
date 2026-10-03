import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../app/AppContext";
import { openImagePicker } from "../app/openImage";
import { pixelCommands } from "../app/pixelCommands";
import { useEngine } from "../engine/context";
import { projectCommands } from "../project/commands";
import { useOptionalProject } from "../project/ProjectProvider";
import { buildCommands, searchCommands, type CommandHost } from "../tools/commands";
import { useEditor } from "../state/store";

const fitEvent = () => window.dispatchEvent(new Event("lilo:fit"));

/**
 * ⌘K: type to find any tool or action (editor, projects, threads, pixel art, screens), arrows to
 * move, Enter to run. Mounted by the app for every screen, and by the editor shell on its own.
 */
export function CommandPalette({ openImage, fit = fitEvent }: Partial<Pick<CommandHost, "openImage" | "fit">>) {
  const { state, actions } = useEditor();
  const app = useApp();
  const engine = useEngine();
  const project = useOptionalProject();
  const open = state.paletteOpen;
  const openIt = useMemo(() => openImage ?? (() => void openImagePicker(actions)), [openImage, actions]);
  const extra = open && project ? [...projectCommands(project, app, state, actions), ...pixelCommands(engine, app, state, actions)] : open ? pixelCommands(engine, app, state, actions) : [];
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  // rebuilt on each open, so what is enabled reflects the project and the pixel grid right now
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => (open ? buildCommands({ state, actions, openImage: openIt, fit, app, extra }) : []), [open, state, actions, openIt, fit, app]);
  const shown = useMemo(() => searchCommands(all, query).slice(0, 60), [all, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      input.current?.focus();
    }
  }, [open]);
  useEffect(() => setIndex(0), [query]);

  if (!open) return null;
  const close = () => actions.setPaletteOpen(false);
  const run = (i: number) => {
    const c = shown[i];
    if (!c || !c.enabled) return;
    close();
    c.run();
  };

  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={shown[index] ? `cmd-${shown[index].id}` : undefined}
          placeholder="Type a command or tool…"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(shown.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(index);
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        />
        <ul id="palette-list" role="listbox" aria-label="Commands">
          {shown.map((c, i) => (
            <li
              key={c.id}
              id={`cmd-${c.id}`}
              role="option"
              aria-selected={i === index}
              aria-disabled={!c.enabled}
              className={`${i === index ? "active" : ""}${c.enabled ? "" : " disabled"}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(i)}
              ref={(el) => {
                if (el && i === index) el.scrollIntoView?.({ block: "nearest" });
              }}
            >
              <span className="cmd-group">{c.group}</span>
              <span className="cmd-label">{c.label}</span>
              {c.shortcut && <kbd>{c.shortcut}</kbd>}
            </li>
          ))}
          {shown.length === 0 && <li className="empty">Nothing matches “{query}”.</li>}
        </ul>
      </div>
    </div>
  );
}
