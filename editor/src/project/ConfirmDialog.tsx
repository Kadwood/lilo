import { useEffect, useRef } from "react";
import { useProject, useProjectState } from "./ProjectProvider";

/**
 * The in-page "unsaved changes" question (never `window.confirm`): Save, Don't save, Cancel. Esc
 * cancels. Shown for closing, New, Open and Revert.
 */
export function ConfirmDialog() {
  const m = useProject();
  const confirm = useProjectState((s) => s.confirm);
  const first = useRef<HTMLButtonElement>(null);
  const trigger = useRef<Element | null>(null);

  useEffect(() => {
    if (!confirm) return;
    trigger.current = document.activeElement;
    first.current?.focus();
    return () => {
      if (trigger.current instanceof HTMLElement) trigger.current.focus();
    };
  }, [confirm]);

  if (!confirm) return null;
  const name = confirm.projectName.trim() || "Untitled design";
  const revert = confirm.kind === "revert";

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        className="dialog confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            m.resolveConfirm("cancel");
          }
        }}
      >
        <h2 id="confirm-title">{revert ? "Revert to the saved version?" : `Save changes to “${name}”?`}</h2>
        <p id="confirm-body" className="muted">
          {revert ? "Everything since you last saved will be lost." : `You have changes that are not saved. If you ${confirm.action} without saving, they will be lost.`}
        </p>
        <div className="dialog-actions">
          {!revert && (
            <button className="danger" onClick={() => m.resolveConfirm("discard")}>
              Don&apos;t save
            </button>
          )}
          <span className="spacer" />
          <button onClick={() => m.resolveConfirm("cancel")} ref={revert ? first : undefined}>
            Cancel
          </button>
          {revert ? (
            <button className="primary" onClick={() => m.resolveConfirm("discard")}>
              Revert
            </button>
          ) : (
            <button className="primary" ref={first} onClick={() => m.resolveConfirm("save")}>
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
