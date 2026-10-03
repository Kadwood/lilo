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
  const recover = confirm.kind === "recover";

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
        <h2 id="confirm-title">{recover ? "This project file is damaged" : revert ? "Revert to the saved version?" : `Save changes to “${name}”?`}</h2>
        <p id="confirm-body" className="muted">
          {recover
            ? "Lilo can't read it, but the copy from the save before the last one is fine. Open that copy instead? Nothing is overwritten until you save."
            : revert
              ? "Everything since you last saved will be lost."
              : `You have changes that are not saved. If you ${confirm.action} without saving, they will be lost.`}
        </p>
        <div className="dialog-actions">
          {!revert && !recover && (
            <button className="danger" onClick={() => m.resolveConfirm("discard")}>
              Don&apos;t save
            </button>
          )}
          <span className="spacer" />
          <button onClick={() => m.resolveConfirm("cancel")} ref={revert || recover ? first : undefined}>
            Cancel
          </button>
          {revert || recover ? (
            <button className="primary" onClick={() => m.resolveConfirm("discard")}>
              {recover ? "Open the earlier copy" : "Revert"}
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
