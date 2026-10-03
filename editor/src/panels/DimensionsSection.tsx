import { useEffect, useRef, useState } from "react";
import { useEditor } from "../state/store";
import { selectionBox } from "../state/editorStore";
import { fromMm, roundFor, toMm } from "../state/units";
import { Hint } from "../guide/Hint";
import { Section, Toggle } from "./controls";

/** A number input you can type into freely; the value is applied on Enter or when it loses focus. */
export function NumberBox({ value, onCommit, label, step = 0.1, min }: { value: number; onCommit: (v: number) => void; label: string; step?: number; min?: number }) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && (min === undefined || v >= min) && v !== value) onCommit(v);
    else setText(String(value));
  };
  return (
    <input
      className="num"
      type="number"
      aria-label={label}
      step={step}
      min={min}
      value={text}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.stopPropagation();
          commit();
        }
      }}
    />
  );
}

/** Width and height of the selection, in mm or inches, with an aspect lock and flip buttons. */
export function DimensionsSection() {
  const { state, actions } = useEditor();
  const box = selectionBox(state.design, state.selectedIds);
  if (!box) return null;
  const u = state.units;
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const setW = (v: number) => {
    const wmm = toMm(v, u);
    actions.resizeSelection(wmm, state.aspectLock ? (wmm * h) / (w || 1) : h, { merge: "dims", mergeWithinMs: 1000 });
  };
  const setH = (v: number) => {
    const hmm = toMm(v, u);
    actions.resizeSelection(state.aspectLock ? (hmm * w) / (h || 1) : w, hmm, { merge: "dims", mergeWithinMs: 1000 });
  };
  return (
    <Section title="Dimensions" help="Width and height of the selection. The top-left corner stays put. Switch between mm and inches, or lock the aspect ratio." id="dimensions">
      <div className="dim-grid">
        <label>
          W
          <NumberBox label={`Width (${u})`} value={roundFor(fromMm(w, u), u)} step={u === "in" ? 0.01 : 0.1} min={0.01} onCommit={setW} />
        </label>
        <button className={`icon lock${state.aspectLock ? " on" : ""}`} aria-label="Lock aspect ratio" aria-pressed={state.aspectLock} title="Lock aspect ratio" onClick={() => actions.setAspectLock(!state.aspectLock)}>
          {state.aspectLock ? "\u{1F512}" : "\u{1F513}"}
        </button>
        <label>
          H
          <NumberBox label={`Height (${u})`} value={roundFor(fromMm(h, u), u)} step={u === "in" ? 0.01 : 0.1} min={0.01} onCommit={setH} />
        </label>
        <div className="segmented small" role="group" aria-label="Units">
          {(["mm", "in"] as const).map((x) => (
            <button key={x} className={u === x ? "active" : ""} aria-pressed={u === x} onClick={() => actions.setUnits(x)}>
              {x}
            </button>
          ))}
        </div>
      </div>
      <div className="hint-strip" aria-label="Dimensions help">
        <span>
          Width <Hint id="dimensions.width" />
        </span>
        <span>
          Height <Hint id="dimensions.height" />
        </span>
        <span>
          Lock <Hint id="dimensions.aspect-lock" />
        </span>
        <span>
          Units <Hint id="dimensions.units" />
        </span>
        <span>
          Flip H <Hint id="dimensions.flip-horizontal" />
        </span>
        <span>
          Flip V <Hint id="dimensions.flip-vertical" />
        </span>
        <span>
          Rotate <Hint id="dimensions.rotate" />
        </span>
      </div>
      <div className="button-row">
        <button onClick={() => actions.flipSelection("h")} title="Flip left-right">
          Flip H
        </button>
        <button onClick={() => actions.flipSelection("v")} title="Flip top-bottom">
          Flip V
        </button>
        <button onClick={() => actions.rotateSelection(90)} title="Rotate 90 degrees clockwise">
          Rotate 90°
        </button>
      </div>
      <Toggle label="Keep aspect ratio" checked={state.aspectLock} onChange={actions.setAspectLock} help="When on, changing width also changes height. Ctrl while dragging a handle does the opposite." />
    </Section>
  );
}
