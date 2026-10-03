import { useMemo, useState } from "react";
import { useCustomHoops, useHoop } from "../hoops/autoPick";
import { useEditor } from "../state/store";
import { dismissLive, openHelp, restoreLive, useGuide } from "./guideStore";
import { applyLiveFix, fixApplies, liveFindings } from "./live";

const SHOWN = 3;

/**
 * The calm warnings tray, bottom-left of the canvas. It never blocks: no dialog, no sound, and a screen
 * reader hears new notes politely. Each note has a one-click fix or a guide link, and a dismiss button.
 */
export function LiveWarnings() {
  const { state, actions } = useEditor();
  const hoop = useHoop();
  const customHoops = useCustomHoops();
  const dismissed = useGuide((s) => s.dismissed);
  const [expanded, setExpanded] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const findings = useMemo(() => liveFindings(state), [state.design, state.planResult]);
  const visible = findings.filter((f) => !dismissed.includes(f.key));
  const shown = expanded ? visible : visible.slice(0, SHOWN);
  const hiddenCount = dismissed.length;

  if (visible.length === 0 && !done && hiddenCount === 0) return null;

  return (
    <section className="live-tray" aria-label="Design warnings" aria-live="polite" data-tour="live-tray">
      {done && (
        <p className="live-done" role="status">
          {done}
        </p>
      )}
      <ul>
        {shown.map((f) => (
          <li key={f.key} className={`live-note ${f.hint.severity}`} data-hint={f.hint.id}>
            <p>{f.hint.message}</p>
            <div className="live-actions">
              {fixApplies(f, state.design) && (
                <button type="button" className="primary" onClick={() => setDone(applyLiveFix(f, { state, actions, hoop, customHoops }))}>
                  {f.hint.fix!.label}
                </button>
              )}
              {f.hint.guideId && (
                <button type="button" className="link-button" onClick={() => openHelp(f.hint.guideId)}>
                  Read more
                </button>
              )}
              <button type="button" className="link-button" aria-label={`Dismiss: ${f.hint.message}`} onClick={() => dismissLive(f.key)}>
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
      {visible.length > SHOWN && (
        <button type="button" className="link-button" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show fewer" : `Show ${visible.length - SHOWN} more`}
        </button>
      )}
      {hiddenCount > 0 && (
        <button type="button" className="link-button" onClick={() => (restoreLive(), setDone(null))}>
          Show dismissed notes
        </button>
      )}
    </section>
  );
}
