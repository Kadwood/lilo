import { useEffect, useMemo } from "react";
import { getPlatform } from "../platform";
import { whenLabel } from "../project/HistoryPanel";
import type { RecentCard } from "../project/manager";
import { useProject, useProjectState } from "../project/ProjectProvider";
import { openImagePicker } from "./openImage";
import { useApp } from "./AppContext";
import { useEditor } from "../state/store";

/** One card: the thumbnail from inside the file, its title and when it was last saved. */
function Card({ card, onOpen }: { card: RecentCard; onOpen: () => void }) {
  const url = useMemo(() => (card.thumbnail ? URL.createObjectURL(new Blob([card.thumbnail as BlobPart], { type: "image/png" })) : null), [card.thumbnail]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  const title = card.title || card.name;
  return (
    <li>
      <button className="recent-card" onClick={onOpen} title={card.path} disabled={!!card.error} aria-label={`Open ${title}`}>
        <span className="recent-thumb">{url ? <img src={url} alt="" /> : <span className="thumb-blank" aria-hidden="true" />}</span>
        <strong>{title}</strong>
        <span className="muted small">{card.error ? "Can't be read" : whenLabel(new Date(card.modifiedMs).toISOString())}</span>
      </button>
    </li>
  );
}

/** Home: the launch screen. New, Open, and the gallery of recent projects. */
export function HomeView() {
  const m = useProject();
  const app = useApp();
  const { actions } = useEditor();
  const recent = useProjectState((s) => s.recent);
  const loading = useProjectState((s) => s.recentLoading);
  const notice = useProjectState((s) => s.notice);
  const desktop = getPlatform().kind === "tauri";

  useEffect(() => void m.refreshRecent(), [m]);

  const go = (p: Promise<boolean>) => void p.then((ok) => ok && app.go("editor"));

  return (
    <div className="screen home" aria-label="Home">
      <header className="home-hero">
        <h1>Lilo</h1>
        <p className="muted">Free embroidery digitizing. Start something new, or pick up where you left off.</p>
        <div className="button-row">
          <button className="primary" onClick={() => go(m.newProject())}>
            New design
          </button>
          <button onClick={() => go(m.openDialog())}>Open…</button>
          <button
            onClick={() => {
              app.go("editor");
              void openImagePicker(actions);
            }}
          >
            Digitize a picture…
          </button>
          <button onClick={() => app.go("pixel")}>Pixel art</button>
          <button onClick={() => app.go("converter")}>Converter</button>
        </div>
        {notice && (
          <p className={notice.kind === "error" ? "error" : "muted"} role={notice.kind === "error" ? "alert" : "status"}>
            {notice.text}
          </p>
        )}
      </header>

      <section aria-labelledby="recent-title">
        <h2 id="recent-title">Recent</h2>
        {recent.length === 0 ? (
          <p className="muted" role="status">
            {loading ? "Looking in your Lilo folder…" : desktop ? "Nothing here yet. Projects you save in Documents/Lilo show up here." : "Recent projects show up here in the desktop app. Use Open… to pick a file."}
          </p>
        ) : (
          <ul className="recent-grid" aria-label="Recent projects">
            {recent.map((c) => (
              <Card key={c.path} card={c} onOpen={() => go(m.openPath(c.path))} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
