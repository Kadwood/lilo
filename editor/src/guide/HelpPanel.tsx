import { useEffect, useMemo, useRef, useState } from "react";
import { getPlatform } from "../platform";
import { loadGuideIndex, searchPages, splitRef, type GuideIndex, type GuidePage } from "./data";
import { closeHelp, setHelpPage, setHelpQuery, startTour, useGuide } from "./guideStore";
import { Markdown } from "./Markdown";

/**
 * The Help panel: a searchable manual that slides in from the right on every screen. It reads
 * `docs/guide/index.json` (built from the pages) the first time it opens. Search covers title, summary,
 * keywords and headings; the page body is rendered by the safe Markdown renderer. Any "?" in the app can
 * open a page by id (`openHelp("satin-tips#density")`).
 */
export function HelpPanel() {
  const open = useGuide((s) => s.helpOpen);
  const pageRef = useGuide((s) => s.helpPage);
  const query = useGuide((s) => s.helpQuery);
  const [index, setIndex] = useState<GuideIndex | null>(null);
  const [failed, setFailed] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open || index) return;
    loadGuideIndex().then(setIndex, () => setFailed(true));
  }, [open, index]);

  // remember where focus was, move it into the panel, give it back on close
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    queueMicrotask(() => search.current?.focus());
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [open]);

  // Esc closes the panel from anywhere on the page (focus can sit on the body after a page swap)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) closeHelp();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const { id: pageId, anchor } = pageRef ? splitRef(pageRef) : { id: null, anchor: undefined };
  const page = index && pageId ? (index.pages.find((p) => p.id === pageId) ?? null) : null;

  // scroll to the heading a deep link names, else to the top of the page
  useEffect(() => {
    if (!page || !body.current) return;
    const target = anchor ? body.current.querySelector(`#h-${CSS.escape(anchor)}`) : null;
    if (target) target.scrollIntoView?.({ block: "start" });
    else body.current.scrollTop = 0;
  }, [page, anchor]);

  const results = useMemo(() => (index ? searchPages(index.pages, query) : []), [index, query]);
  if (!open) return null;

  const go = (ref: string) => {
    setHelpQuery("");
    setHelpPage(ref);
  };

  return (
    <aside
      className="help-panel"
      role="dialog"
      aria-label="Help"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          closeHelp();
        }
      }}
    >
      <header className="help-head">
        <h2>Help</h2>
        <button type="button" onClick={() => (closeHelp(), startTour())}>
          Replay the tour
        </button>
        <button type="button" className="icon" aria-label="Close help" onClick={closeHelp}>
          ✕
        </button>
      </header>
      <input ref={search} type="search" className="help-search" aria-label="Search the guide" placeholder="Search: satin, hoop, send, pucker…" value={query} onChange={(e) => setHelpQuery(e.target.value)} />

      <div className="help-body" ref={body}>
        {failed && <p className="error">The guide could not be loaded. Restart Lilo and try again.</p>}
        {!index && !failed && <p className="muted">Loading the guide…</p>}
        {index && query.trim() && <Results pages={results} query={query} onPick={go} />}
        {index && !query.trim() && page && <PageView page={page} index={index} onNavigate={go} onBack={() => setHelpPage(null)} />}
        {index && !query.trim() && !page && <Contents index={index} onPick={go} missing={pageId} />}
      </div>
    </aside>
  );
}

function Contents({ index, onPick, missing }: { index: GuideIndex; onPick: (id: string) => void; missing: string | null }) {
  return (
    <nav aria-label="Guide contents">
      {missing && <p className="muted small">That page was not found. Here is everything in the guide.</p>}
      {index.sections.map((s) => {
        const pages = index.pages.filter((p) => p.section === s.id);
        if (pages.length === 0) return null;
        return (
          <section key={s.id} className="help-section">
            <h3>{s.title}</h3>
            <p className="muted small">{s.blurb}</p>
            <ul>
              {pages.map((p) => (
                <li key={p.id}>
                  <button type="button" className="help-link" onClick={() => onPick(p.id)}>
                    <strong>{p.title}</strong>
                    <span className="muted small">{p.summary}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}

function Results({ pages, query, onPick }: { pages: GuidePage[]; query: string; onPick: (id: string) => void }) {
  if (pages.length === 0) return <p role="status">Nothing in the guide matches “{query.trim()}”. Try a simpler word, like “hoop” or “thread”.</p>;
  return (
    <div>
      <p className="muted small" role="status">
        {pages.length} page{pages.length === 1 ? "" : "s"} match.
      </p>
      <ul aria-label="Search results">
        {pages.map((p) => (
          <li key={p.id}>
            <button type="button" className="help-link" onClick={() => onPick(p.id)}>
              <strong>{p.title}</strong>
              <span className="muted small">{p.summary}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PageView({ page, index, onNavigate, onBack }: { page: GuidePage; index: GuideIndex; onNavigate: (ref: string) => void; onBack: () => void }) {
  const section = index.sections.find((s) => s.id === page.section);
  // the page title is shown as the panel heading, so drop the body's own "# Title" line
  const source = page.body.replace(/^# .*\n+/, "");
  return (
    <article className="help-page" aria-labelledby="help-page-title">
      <button type="button" className="link-button" onClick={onBack}>
        ← All topics
      </button>
      <p className="muted small">{section?.title}</p>
      <h3 id="help-page-title" className="help-page-title">
        {page.title}
      </h3>
      <p className="help-summary">{page.summary}</p>
      <Markdown source={source} onNavigate={onNavigate} onExternal={(url) => void getPlatform().openUrl(url)} />
    </article>
  );
}
