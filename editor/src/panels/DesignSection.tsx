import { useState } from "react";
import { useStore } from "zustand";
import { PLACEMENT_GUIDES, rotateHoop } from "@lilo/engine/light";
import { fmtMm, fmtSize } from "../hoops/format";
import { pickFor, useCustomHoops, useHoop } from "../hoops/autoPick";
import { useEditor } from "../state/store";
import { defaultThread, findThread } from "../state/editorStore";
import { hoopViewStore, setHoopView } from "../state/hoopViewStore";
import { rememberHoop } from "../state/hoopStore";
import { Hint } from "../guide/Hint";
import { Section, Toggle } from "./controls";
import { ThreadPicker } from "./ThreadPicker";

/** Ask the canvas for Actual size (it owns the view). */
export const ACTUAL_SIZE_EVENT = "lilo:actual-size";

/**
 * The hoop: one button that names it and opens the picker (brand, machine, hoop, search, recents, your
 * own). The roomy version, in the panel, adds the quick actions and what the canvas draws around it.
 */
export function HoopSelect({ compact = false }: { compact?: boolean } = {}) {
  const { state, actions } = useEditor();
  const hoop = useHoop();
  const custom = useCustomHoops();
  const view = useStore(hoopViewStore);
  const [note, setNote] = useState<string | null>(null);

  const smallest = () => {
    const r = pickFor(state.design, hoop, custom);
    if (!r) return setNote("Draw or digitize something first.");
    if (r.kind === "fit") {
      actions.setHoop(r.hoop);
      rememberHoop(r.hoop);
      return setNote(`${r.hoop.name}${r.rotated ? " (turned a quarter)" : ""} is the smallest that fits.`);
    }
    const o = r.overflowMm;
    setNote(`Needs re-hooping: ${r.closest?.name ?? "no hoop"} is ${[o.x > 0.05 ? `${fmtMm(o.x)} too narrow` : null, o.y > 0.05 ? `${fmtMm(o.y)} too short` : null].filter(Boolean).join(" and ")}.`);
  };

  return (
    <div className={`hoop-select${compact ? " compact" : ""}`}>
      <button className="hoop-button" onClick={() => setHoopView({ pickerOpen: true })} aria-label={`Hoop: ${hoop.name}, ${fmtSize(hoop)}. Change`} title="Choose a hoop" data-tour={compact ? "hoop-chip" : undefined}>
        <span className="hoop-button-icon" aria-hidden="true" data-shape={hoop.shape ?? "rect"} />
        <span className="hoop-button-name">{hoop.name}</span>
        {!compact && <span className="muted small">{fmtSize(hoop)}</span>}
      </button>
      {!compact && <Hint id="hoop.chip" />}
      {!compact && (
        <>
          <div className="button-row">
            <button onClick={smallest}>Smallest hoop that fits</button>
            <button onClick={() => actions.setHoop(rotateHoop(hoop))} title="Swap width and height">
              Turn 90°
            </button>
            <button onClick={() => setHoopView({ customEditor: { id: null } })}>Add my own…</button>
          </div>
          <div className="hint-strip" aria-label="Hoop help">
            <span>
              Smallest hoop <Hint id="hoop.smallest-hoop-that-fits" />
            </span>
            <span>
              Turn 90° <Hint id="hoop.swap" />
            </span>
            <span>
              Your own hoop <Hint id="hoop.add-own" />
            </span>
          </div>
          {note && (
            <p className="small" role="status">
              {note}
            </p>
          )}
          <Toggle label="Show hoop frame" checked={view.showFrame} onChange={(v) => setHoopView({ showFrame: v })} help="Draws the frame and its clamp around the sewing area, like the real hoop." />
          <Toggle label="Show safe margin" checked={view.showSafeArea} onChange={(v) => setHoopView({ showSafeArea: v })} help="A dashed line 5 mm inside the sewing area. Stitches closer to the edge are close to the presser foot and the frame." />
          <Toggle label="Show rulers" checked={view.showRulers} onChange={(v) => setHoopView({ showRulers: v })} help="Rulers along the top and left of the canvas. Drag from a ruler to pull out a guide." />
          <label className="field-line">
            <span className="field-label">
              Placement guide <Hint id="hoop.placement-guide" />
            </span>
            <select aria-label="Placement guide" value={view.placementId ?? ""} onChange={(e) => setHoopView({ placementId: e.target.value || null })}>
              <option value="">None</option>
              {PLACEMENT_GUIDES.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <div className="hint-strip" aria-label="Real size help">
            <span>
              Actual size <Hint id="hoop.actual-size" />
            </span>
            <span>
              Calibrate screen <Hint id="hoop.calibrate-screen" />
            </span>
          </div>
          <div className="button-row">
            <button onClick={() => window.dispatchEvent(new Event(ACTUAL_SIZE_EVENT))} title="Show the design at its real size on this screen (⌘0)">
              Actual size <kbd>⌘0</kbd>
            </button>
            <button onClick={() => setHoopView({ calibrationOpen: true })}>Calibrate screen…</button>
          </div>
        </>
      )}
    </div>
  );
}

/** Shown in the left panel when nothing is selected. */
export function DesignSection() {
  const { state, actions } = useEditor();
  const [pick, setPick] = useState(false);
  const t = (state.threadId && (state.design?.threads.find((x) => x.id === state.threadId) ?? findThread(state.threadId))) || state.design?.threads[0] || defaultThread();
  return (
    <>
      <Section title="Hoop" help="The embroidery area of your machine. Shapes outside it can't be sewn. Pick yours from the list, or add your own." id="hoop">
        <HoopSelect />
      </Section>
      <Section title="Drawing colour" help="New shapes are drawn in this thread. Select a shape to change its own colour." id="drawing-colour">
        <button className="colour-current" onClick={() => setPick((v) => !v)} aria-expanded={pick}>
          <span className="swatch" style={{ background: t.hex }} aria-hidden="true" />
          <span>
            {t.brand} {t.code} {t.name}
          </span>
        </button>
        {pick && (
          <ThreadPicker
            current={t.id}
            onPick={(th) => {
              actions.setThread(th.id);
              setPick(false);
            }}
          />
        )}
      </Section>
    </>
  );
}
