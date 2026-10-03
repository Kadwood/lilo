import { useState } from "react";
import { HOOPS, emptyDesign, type Hoop } from "@lilo/engine/light";
import { useEditor } from "../state/store";
import { defaultThread, findThread } from "../state/editorStore";
import { Section } from "./controls";
import { NumberBox } from "./DimensionsSection";
import { ThreadPicker } from "./ThreadPicker";

const CUSTOM = "custom";

/** The hoop selector (with an outline on the canvas) and the colour new shapes are drawn in. */
export function HoopSelect({ compact = false }: { compact?: boolean } = {}) {
  const { state, actions } = useEditor();
  const hoop = state.design?.hoop ?? emptyDesign().hoop;
  const preset = HOOPS.find((h) => h.widthMm === hoop.widthMm && h.heightMm === hoop.heightMm && h.name === hoop.name);
  const [custom, setCustom] = useState(!preset);
  const value = custom || !preset ? CUSTOM : preset.name;
  const setSize = (w: number, h: number) => actions.setHoop({ name: `Custom ${w} x ${h}`, widthMm: w, heightMm: h });
  return (
    <div className={`hoop-select${compact ? " compact" : ""}`}>
      <label>
        <select
          aria-label="Hoop"
          value={value}
          onChange={(e) => {
            if (e.target.value === CUSTOM) {
              setCustom(true);
              setSize(hoop.widthMm, hoop.heightMm);
              return;
            }
            setCustom(false);
            const h = HOOPS.find((x) => x.name === e.target.value) as Hoop;
            actions.setHoop(h);
          }}
        >
          {HOOPS.map((h) => (
            <option key={h.name} value={h.name}>
              {h.name}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
      </label>
      {value === CUSTOM && (
        <span className="hoop-custom">
          <NumberBox label="Hoop width (mm)" value={hoop.widthMm} min={20} step={5} onCommit={(w) => setSize(w, hoop.heightMm)} />
          ×
          <NumberBox label="Hoop height (mm)" value={hoop.heightMm} min={20} step={5} onCommit={(h) => setSize(hoop.widthMm, h)} />
          <span className="muted small">mm</span>
        </span>
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
      <Section title="Hoop" help="The embroidery area of your machine. Shapes outside it can't be sewn. The NV2700 takes 160 × 260 mm and 130 × 180 mm hoops." id="hoop">
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
