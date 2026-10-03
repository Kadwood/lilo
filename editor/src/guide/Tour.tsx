import { useEffect, useRef, useState } from "react";
import mascotUrl from "../assets/brand/mascot.svg";
import { useApp } from "../app/AppContext";
import { useModalFocus } from "../shell/useModalFocus";
import { useEditor } from "../state/store";
import { evalCondition, type TourContext } from "./conditions";
import { TOUR, type TourStep } from "./data";
import { chooseTourPath, closeTourDone, finishTour, openHelp, skipTour, tourBack, tourNext, useGuide } from "./guideStore";

/**
 * The first-launch tour: the mascot asks what you want to make, then a few coach marks point at the real
 * buttons for that path. A step moves on when you do what it asks (the conditions in `conditions.ts`), or
 * when you press Next. Skip any time; replay from Help. All wording lives in `docs/guide/tour.json`.
 */
export function TourOverlay() {
  const phase = useGuide((s) => s.tour.phase);
  if (phase === "welcome") return <Welcome />;
  if (phase === "running") return <Coach />;
  if (phase === "done") return <DoneCard />;
  return null;
}

function Welcome() {
  const modal = useModalFocus<HTMLDivElement>();
  const w = TOUR.welcome;
  return (
    <div className="tour-backdrop" role="presentation">
      <div ref={modal} tabIndex={-1} className="tour-welcome" role="dialog" aria-modal="true" aria-labelledby="tour-welcome-title" onKeyDown={(e) => e.key === "Escape" && skipTour()}>
        <img className="tour-mascot" src={mascotUrl} alt="Lilo's mascot, a friendly blue creature with a hibiscus" width={96} height={96} />
        <h2 id="tour-welcome-title">{w.title}</h2>
        <p>{w.body}</p>
        <ul className="tour-choices" aria-label="What do you want to make?">
          {w.choices.map((c) => (
            <li key={c.path}>
              <button type="button" data-path={c.path} onClick={() => chooseTourPath(c.path)}>
                <strong>{c.label}</strong>
                <span className="muted small">{c.hint}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="link-button" onClick={skipTour}>
          {w.skip}
        </button>
      </div>
    </div>
  );
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the element with `data-tour=target` is on screen, or null (not shown right now). Re-measured as the UI moves. */
function useTargetRect(target: string | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    if (!target) return setRect(null);
    const measure = () => {
      const el = [...document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)].find((e) => e.getClientRects().length > 0);
      if (!el) return setRect((r) => (r === null ? r : null));
      const b = el.getBoundingClientRect();
      const next = { left: Math.round(b.left), top: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) };
      setRect((r) => (r && r.left === next.left && r.top === next.top && r.width === next.width && r.height === next.height ? r : next));
    };
    measure();
    const id = window.setInterval(measure, 250);
    window.addEventListener("resize", measure);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", measure);
    };
  }, [target]);
  return rect;
}

const CARD_W = 320;
const CARD_H = 210;

function cardPosition(rect: Rect | null): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!rect) return { left: Math.max(12, (vw - CARD_W) / 2), top: Math.max(12, vh * 0.28) };
  const centre = rect.left + rect.width / 2;
  const left = Math.max(12, Math.min(vw - CARD_W - 12, centre - CARD_W / 2));
  const below = rect.top + rect.height + 14;
  if (below + CARD_H < vh) return { left, top: below };
  const above = rect.top - CARD_H - 14;
  if (above > 8) return { left, top: above };
  // a tall target (a panel): put the card beside it
  const right = rect.left + rect.width + 14;
  return right + CARD_W < vw ? { left: right, top: Math.max(12, rect.top + 12) } : { left: Math.max(12, rect.left - CARD_W - 14), top: Math.max(12, rect.top + 12) };
}

function Coach() {
  const tour = useGuide((s) => s.tour);
  const guide = useGuide((s) => s);
  const { state } = useEditor();
  const app = useApp();
  const path = TOUR.paths.find((p) => p.id === tour.path);
  const step: TourStep | undefined = path?.steps[tour.step];
  const rect = useTargetRect(step?.target ?? null);
  const ctx: TourContext = { editor: state, guide, view: app.view };
  const cond = step?.advanceOn.type === "state" ? step.advanceOn.cond : null;
  const doneAtStart = useRef(false);
  const startedFor = useRef<string | null>(null);

  // A step that is already satisfied when it starts (a replay, a design already open) does not skip itself: it waits for Next.
  const key = `${tour.path}/${step?.id}`;
  if (startedFor.current !== key) {
    startedFor.current = key;
    doneAtStart.current = !!cond && evalCondition(cond, ctx);
  }
  const satisfied = !!cond && !doneAtStart.current && evalCondition(cond, ctx);

  useEffect(() => {
    if (!satisfied) return;
    const t = window.setTimeout(tourNext, 500); // a beat, so you see what you just did
    return () => window.clearTimeout(t);
  }, [satisfied, key]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && skipTour();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!path || !step) return null;
  const pos = cardPosition(rect);
  const last = tour.step + 1 >= path.steps.length;
  const waiting = cond !== null && !doneAtStart.current;

  return (
    <>
      {rect && <div className="tour-ring" aria-hidden="true" style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} />}
      <div className="tour-card" role="dialog" aria-label={`Tour: ${step.title}`} style={{ left: pos.left, top: pos.top, width: CARD_W }} data-step={step.id}>
        <p className="tour-progress muted small">
          {path.title}: step {tour.step + 1} of {path.steps.length}
        </p>
        <strong className="tour-title">{step.title}</strong>
        <p>{step.body}</p>
        <div className="button-row">
          {tour.step > 0 && (
            <button type="button" onClick={tourBack}>
              Back
            </button>
          )}
          <button type="button" className={waiting ? "" : "primary"} onClick={last ? finishTour : tourNext}>
            {last ? "Finish" : waiting ? "Skip this step" : "Next"}
          </button>
          {step.guideId && (
            <button type="button" className="link-button" onClick={() => openHelp(step.guideId)}>
              Read more
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="link-button" onClick={skipTour}>
            Skip tour
          </button>
        </div>
      </div>
    </>
  );
}

function DoneCard() {
  useEffect(() => {
    const t = window.setTimeout(closeTourDone, 8000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="tour-card tour-done" role="status" style={{ right: 20, bottom: 96 }}>
      <strong className="tour-title">{TOUR.done.title}</strong>
      <p>{TOUR.done.body}</p>
      <div className="button-row">
        <button type="button" className="primary" onClick={closeTourDone}>
          Close
        </button>
        <button type="button" className="link-button" onClick={() => (closeTourDone(), openHelp())}>
          Open the guide
        </button>
      </div>
    </div>
  );
}
