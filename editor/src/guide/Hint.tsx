import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { hintById, type HintEntry } from "./data";
import { openHelp } from "./guideStore";

/**
 * The "?" button. One component for every control: it looks its text up by a stable id in
 * `docs/guide/hints.json`, shows a small card (what it does, when to change it, a typical value) and links
 * to the guide page. Keyboard: Tab to it, Enter or Space opens, Esc closes and returns focus.
 */

/** Section ids that reuse another section's hints (click-to-stitch has its own copies of the panels). */
const SCOPE_ALIASES: Record<string, string> = { "cs-style": "style", "cs-colour": "colour", "cs-pattern": "pattern", "cs-stitching": "stitching", "cs-run": "runtype" };

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/ +/g, "-");

/** The hint id a labelled control gets inside a scope: `<scope>.<label as a slug>`. */
export const hintIdFor = (scope: string, label: string): string => `${SCOPE_ALIASES[scope] ?? scope}.${slugify(label)}`;
/** The hint id of a collapsible section. */
export const sectionHintId = (sectionId: string): string => `section.${SCOPE_ALIASES[sectionId] ?? sectionId}`;

const ScopeContext = createContext<string | null>(null);
export const HintScope = ({ scope, children }: { scope: string; children: ReactNode }) => <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>;
export const useHintScope = (): string | null => useContext(ScopeContext);

export function HintCard({ entry, what, onMore }: { entry: HintEntry; what?: string; onMore: () => void }) {
  return (
    <>
      <strong className="hint-title">{entry.label}</strong>
      <p>
        <span className="hint-key">What it does</span> {what ?? entry.what}
      </p>
      <p>
        <span className="hint-key">When to change it</span> {entry.when}
      </p>
      <p>
        <span className="hint-key">Typical</span> {entry.typical}
      </p>
      {entry.effects && (
        <p>
          <span className="hint-key">Watch out</span> {entry.effects}
        </p>
      )}
      <button type="button" className="link-button hint-more" onClick={onMore}>
        Read more in the guide
      </button>
    </>
  );
}

/** Open a card next to a button: fixed, clamped to the window, closed by Esc or a click elsewhere. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLSpanElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const w = 300;
    const h = card.current?.offsetHeight ?? 160;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 8;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 8) : below;
    setPos({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!card.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);

  return { open, setOpen, button, card, pos };
}

export function Hint({ id, what }: { id: string; what?: string }) {
  const entry = hintById(id);
  const { open, setOpen, button, card, pos } = usePopover();
  const cardId = useId();
  if (!entry) return null;
  return (
    <>
      <span
        ref={button}
        role="button"
        tabIndex={0}
        className="help-tip hint-button"
        data-hint={id}
        aria-label={`Help: ${entry.label}`}
        aria-expanded={open}
        aria-controls={open ? cardId : undefined}
        aria-haspopup="dialog"
        onClick={(e) => {
          e.preventDefault(); // inside a <summary> or a <label> a click would also toggle the section or the control
          e.stopPropagation();
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(!open);
          }
        }}
      >
        ?
      </span>
      {open &&
        createPortal(
          <div id={cardId} ref={card} className="hint-card" role="dialog" aria-label={`${entry.label}: help`} style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}>
            <HintCard
              entry={entry}
              what={what}
              onMore={() => {
                setOpen(false);
                openHelp(entry.guideId);
              }}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

/** A "?" that opens a card listing several hints: for icon-only bars (the toolbar and the shape bar). */
export function HintList({ ids, label, guideId, name }: { ids: readonly string[]; label: string; guideId: string; name: string }) {
  const { open, setOpen, button, card, pos } = usePopover();
  const cardId = useId();
  const entries = ids.map((i) => hintById(i)).filter((e): e is HintEntry => !!e);
  const more = useCallback(() => {
    setOpen(false);
    openHelp(guideId);
  }, [guideId, setOpen]);
  return (
    <>
      <span
        ref={button}
        role="button"
        tabIndex={0}
        className="help-tip hint-button"
        data-hint={name}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? cardId : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(!open);
          }
        }}
      >
        ?
      </span>
      {open &&
        createPortal(
          <div id={cardId} ref={card} className="hint-card hint-list" role="dialog" aria-label={label} style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}>
            <dl>
              {entries.map((e) => (
                <div key={e.id}>
                  <dt>{e.label}</dt>
                  <dd>
                    {e.what} {e.when}
                  </dd>
                </div>
              ))}
            </dl>
            <button type="button" className="link-button hint-more" onClick={more}>
              Read more in the guide
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
