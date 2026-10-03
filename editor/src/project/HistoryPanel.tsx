import { useEffect, useMemo, useState } from "react";
import { useEngine } from "../engine/context";
import { useModalFocus } from "../shell/useModalFocus";
import { useProject, useProjectState } from "./ProjectProvider";

const THUMB = 160;
const PREVIEW = 360;

/** "3 min ago", "yesterday 14:05", or a date. */
export function whenLabel(iso: string, now = new Date()): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "unknown time";
  const s = Math.round((now.getTime() - t.getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  const clock = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (t.toDateString() === now.toDateString()) return `today ${clock}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (t.toDateString() === y.toDateString()) return `yesterday ${clock}`;
  return `${t.toLocaleDateString([], { day: "numeric", month: "short", year: t.getFullYear() === now.getFullYear() ? undefined : "numeric" })} ${clock}`;
}

/**
 * Version history: every autosave and save the project has kept (up to 50), newest first, with a
 * thumbnail and time. Pick one to preview it larger; Restore brings it back as one undoable edit.
 */
export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const m = useProject();
  const engine = useEngine();
  const modal = useModalFocus<HTMLDivElement>();
  const history = useProjectState((s) => s.history);
  const entries = useMemo(() => [...history].reverse(), [history]);
  const [selected, setSelected] = useState<string | null>(entries[0]?.id ?? null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [big, setBig] = useState<{ id: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // small thumbnails, one after another, newest first, so the list fills in from the top
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    (async () => {
      for (const e of entries) {
        if (!alive) return;
        try {
          const doc = m.entryDoc(e.id);
          if (!doc) continue;
          const png = await engine.call("designThumbnail", doc.design, THUMB);
          if (!alive) return;
          const url = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
          urls.push(url);
          setThumbs((t) => ({ ...t, [e.id]: url }));
        } catch {
          // an unreadable entry shows without a picture
        }
      }
    })();
    return () => {
      alive = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [engine, m, entries]);

  // the large preview of the picked version
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    let url: string | null = null;
    const doc = (() => {
      try {
        return m.entryDoc(selected);
      } catch {
        return null;
      }
    })();
    if (!doc) return;
    void engine
      .call("designThumbnail", doc.design, PREVIEW)
      .then((png) => {
        if (!alive) return;
        url = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
        setBig({ id: selected, url });
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [engine, m, selected]);

  const doc = useMemo(() => {
    if (!selected) return null;
    try {
      return m.entryDoc(selected);
    } catch {
      return null;
    }
  }, [m, selected]);
  const entry = entries.find((e) => e.id === selected) ?? null;

  const restore = async () => {
    if (!selected) return;
    setError(null);
    if (await m.restore(selected)) onClose();
    else setError("That version could not be restored.");
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <div ref={modal} tabIndex={-1} className="dialog dialog-wide history" role="dialog" aria-modal="true" aria-labelledby="history-title" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <h2 id="history-title">Version history</h2>
        {entries.length === 0 ? (
          <p className="muted">No versions yet. Lilo keeps one every 30 seconds while you work, and each time you save.</p>
        ) : (
          <div className="history-body">
            <ul className="history-list" role="listbox" aria-label="Saved versions">
              {entries.map((e, i) => (
                <li key={e.id} role="option" aria-selected={selected === e.id}>
                  <button className={selected === e.id ? "active" : ""} onClick={() => setSelected(e.id)} onDoubleClick={() => void restore()}>
                    {thumbs[e.id] ? <img src={thumbs[e.id]} alt="" width={64} height={64} /> : <span className="thumb-blank" aria-hidden="true" />}
                    <span className="history-text">
                      <strong>{whenLabel(e.savedAt)}</strong>
                      <span className="muted small">{i === 0 ? "latest" : `version ${entries.length - i}`}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="history-preview" aria-label="Preview">
              {selected && big?.id === selected ? <img src={big.url} alt={`Preview of the version from ${entry ? whenLabel(entry.savedAt) : ""}`} /> : <div className="thumb-blank large" aria-hidden="true" />}
              {doc && (
                <dl className="stats">
                  <div>
                    <dt>Shapes</dt>
                    <dd>{doc.design.objects.length}</dd>
                  </div>
                  <div>
                    <dt>Colours</dt>
                    <dd>{doc.design.threads.length}</dd>
                  </div>
                  <div>
                    <dt>Name</dt>
                    <dd>{doc.title}</dd>
                  </div>
                </dl>
              )}
              <p className="muted small">Restoring puts this version in the editor. It is one step: Undo brings back what you have now.</p>
            </div>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
          <button className="primary" onClick={() => void restore()} disabled={!selected || !doc}>
            Restore this version
          </button>
        </div>
      </div>
    </div>
  );
}
