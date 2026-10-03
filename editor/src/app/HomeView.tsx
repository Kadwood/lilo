import { useEffect, useState } from "react";
import { getPlatform } from "../platform";
import { whenLabel } from "../project/HistoryPanel";
import type { RecentCard } from "../project/manager";
import { useProject, useProjectState } from "../project/ProjectProvider";
import { openImagePicker } from "./openImage";
import { useApp } from "./AppContext";
import { useEditor } from "../state/store";
import iconUrl from "../assets/brand/lilo-icon.svg";
import { KadwoodWordmark } from "../shell/BrandMark";

/** One card: the thumbnail from inside the file, its title and when it was last saved. */
export function Card({ card, onOpen }: { card: RecentCard; onOpen: () => void }) {
  // Made and revoked in one effect: a URL made during render and revoked by a cleanup is dead after React
  // re-runs the effect (StrictMode in development), and the image then fails to load.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!card.thumbnail) {
      setUrl(null);
      return;
    }
    const made = URL.createObjectURL(new Blob([card.thumbnail as BlobPart], { type: "image/png" }));
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [card.thumbnail]);
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

const KADWOOD_URL = "https://kadwood.com";

const ICONS = {
  new: <path d="M12 5v14M5 12h14" />,
  picture: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="3" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4.5 17 4.5-4.5 3 3 3-3.5 4.5 5" />
    </>
  ),
  type: <path d="M5 7V5h14v2M12 5v14M9 19h6" />,
  pixel: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </>
  ),
  open: <path d="M3.5 7.5a2 2 0 0 1 2-2H10l2 2.2h6.5a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  convert: <path d="M5 8h12l-3-3M19 16H7l3 3" />,
} as const;

/** One quick-start card: a small icon, what it does in a word, and a line about it. */
function Quick({ icon, title, hint, primary, onClick, tour }: { icon: keyof typeof ICONS; title: string; hint: string; primary?: boolean; onClick: () => void; tour?: string }) {
  return (
    <li>
      <button className={`quick-card${primary ? " primary-card" : ""}`} onClick={onClick} aria-label={title} data-tour={tour}>
        <span className="quick-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            {ICONS[icon]}
          </svg>
        </span>
        <strong aria-hidden="true">{title}</strong>
        <span className="muted small" aria-hidden="true">
          {hint}
        </span>
      </button>
    </li>
  );
}

/** Home: the launch screen. A welcome, the ways to start, and the gallery of recent projects. */
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
        <img className="home-icon" src={iconUrl} alt="" width={96} height={96} />
        <div className="home-welcome">
          <h1>Welcome to Lilo</h1>
          <p className="muted">Free embroidery digitizing. Turn a picture into stitches, type a monogram, or pick up where you left off.</p>
          <button className="lockup" onClick={() => void getPlatform().openUrl(KADWOOD_URL)} title="kadwood.com">
            <span>Lilo by</span>
            <KadwoodWordmark height={14} />
          </button>
        </div>
      </header>

      <section aria-labelledby="start-title">
        <h2 id="start-title">Start</h2>
        <ul className="quick-grid" aria-label="Ways to start">
          <Quick icon="new" title="New design" hint="A blank hoop to draw in" primary tour="home-new" onClick={() => go(m.newProject())} />
          <Quick
            icon="picture"
            tour="home-picture"
            title="Digitize a picture…"
            hint="Turn a logo or photo into stitches"
            onClick={() => {
              app.go("editor");
              void openImagePicker(actions);
            }}
          />
          <Quick
            icon="type"
            tour="home-monogram"
            title="Type a monogram"
            hint="Letters, ready to stitch"
            onClick={() =>
              void m.newProject().then((ok) => {
                if (!ok) return;
                app.go("editor");
                actions.setTool("text");
              })
            }
          />
          <Quick icon="pixel" title="Pixel art" hint="Cross-stitch style, square by square" onClick={() => app.go("pixel")} />
          <Quick icon="open" tour="home-open" title="Open…" hint="A Lilo project from your computer" onClick={() => go(m.openDialog())} />
          <Quick icon="convert" title="Converter" hint="Change embroidery file formats" onClick={() => app.go("converter")} />
        </ul>
        {notice && (
          <p className={notice.kind === "error" ? "error" : "muted"} role={notice.kind === "error" ? "alert" : "status"}>
            {notice.text}
          </p>
        )}
      </section>

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
