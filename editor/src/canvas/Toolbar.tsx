import { useState, type ReactNode } from "react";
import { TOOLS, type ToolId } from "../tools/registry";
import { ThreadPicker } from "../panels/ThreadPicker";
import { useEditor } from "../state/store";
import { defaultThread, findThread } from "../state/editorStore";

const I = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const ICONS: Record<ToolId, ReactNode> = {
  select: (
    <I>
      <path d="M6 3l12 9-5.2 1.2L15 19l-2.6 1-2.2-5.6L6 17z" />
    </I>
  ),
  pan: (
    <I>
      <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
    </I>
  ),
  measure: (
    <I>
      <path d="M3 17L17 3l4 4L7 21z" />
      <path d="M7 13l2 2M10 10l2 2M13 7l2 2" />
    </I>
  ),
  open: (
    <I>
      <path d="M4 18l5-9 5 6 6-10" />
      <circle cx="4" cy="18" r="1.4" />
      <circle cx="9" cy="9" r="1.4" />
      <circle cx="14" cy="15" r="1.4" />
      <circle cx="20" cy="5" r="1.4" />
    </I>
  ),
  closed: (
    <I>
      <path d="M5 8l9-3 5 7-4 7-10-2z" />
      <circle cx="5" cy="8" r="1.3" />
      <circle cx="14" cy="5" r="1.3" />
      <circle cx="19" cy="12" r="1.3" />
    </I>
  ),
  circle: (
    <I>
      <circle cx="12" cy="12" r="8" />
    </I>
  ),
  rect: (
    <I>
      <rect x="4" y="6" width="16" height="12" rx="1" />
    </I>
  ),
  pen: (
    <I>
      <path d="M3 17c3-8 5-9 7-5s4 3 6-3 3-4 5-3" />
    </I>
  ),
  satin: (
    <I>
      <path d="M6 3c-2 6-2 12 0 18M18 3c2 6 2 12 0 18" />
      <path d="M6.3 7h11.4M5.8 11h12.4M5.8 15h12.4M6.3 19h11.4" strokeWidth="1.3" />
    </I>
  ),
  text: (
    <I>
      <path d="M5 6V4h14v2M12 4v16M9 20h6" />
    </I>
  ),
  manual: (
    <I>
      <path d="M4 17l4-3 4 2 3-5 5 1" strokeDasharray="2 2" />
      <circle cx="4" cy="17" r="1.6" fill="currentColor" />
      <circle cx="12" cy="16" r="1.6" fill="currentColor" />
      <circle cx="20" cy="12" r="1.6" fill="currentColor" />
    </I>
  ),
};

/** The bottom toolbar: tools, undo/redo and the colour new shapes are drawn in. */
export function Toolbar() {
  const { state, actions } = useEditor();
  const [pick, setPick] = useState(false);
  const t = (state.threadId && (state.design?.threads.find((x) => x.id === state.threadId) ?? findThread(state.threadId))) || state.design?.threads[0] || defaultThread();
  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          className={`tool${state.tool === tool.id ? " active" : ""}`}
          aria-pressed={state.tool === tool.id}
          aria-label={tool.label}
          disabled={!tool.enabled}
          title={`${tool.label}${tool.key.trim() ? ` (${tool.key.toUpperCase()})` : " (Space)"}: ${tool.help}`}
          onClick={() => actions.setTool(tool.id)}
          data-tool={tool.id}
        >
          {ICONS[tool.id]}
          <kbd>{tool.key === " " ? "␣" : tool.key.toUpperCase()}</kbd>
        </button>
      ))}
      <span className="toolbar-sep" aria-hidden="true" />
      <button className="tool" aria-label="Undo" title={state.undoLabel ? `Undo ${state.undoLabel} (⌘Z)` : "Undo (⌘Z)"} disabled={!state.canUndo} onClick={actions.undo}>
        <I>
          <path d="M9 7L4 12l5 5M4 12h10a6 6 0 010 8h-3" />
        </I>
      </button>
      <button className="tool" aria-label="Redo" title={state.redoLabel ? `Redo ${state.redoLabel} (⇧⌘Z)` : "Redo (⇧⌘Z)"} disabled={!state.canRedo} onClick={actions.redo}>
        <I>
          <path d="M15 7l5 5-5 5M20 12H10a6 6 0 000 8h3" />
        </I>
      </button>
      <span className="toolbar-sep" aria-hidden="true" />
      <div className="toolbar-colour">
        <button className="tool colour" aria-label="Drawing colour" aria-expanded={pick} title={`Drawing colour: ${t.brand} ${t.code} ${t.name}`} onClick={() => setPick((v) => !v)}>
          <span className="swatch" style={{ background: t.hex }} aria-hidden="true" />
        </button>
        {pick && (
          <div className="popover up">
            <ThreadPicker
              current={t.id}
              onPick={(th) => {
                // with shapes selected the swatch recolours them; otherwise it sets the drawing colour
                if (state.selectedIds.length > 0) actions.setObjectThread(state.selectedIds, th);
                else actions.setThread(th.id);
                setPick(false);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
