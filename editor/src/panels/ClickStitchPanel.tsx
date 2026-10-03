import { useMemo, useState } from "react";
import { DEFAULT_FILL_PARAMS, patternInfo, type FillParams, type RunParams, type RunType } from "@lilo/engine/light";
import { useEditor } from "../state/store";
import { Field, rowsHint, Section, Segmented, Toggle } from "./controls";
import { PatternPicker } from "./PatternPicker";
import { RUN_TYPES, RUN_WIDTH_DEFAULT } from "./SettingsPanel";
import { ThreadPicker } from "./ThreadPicker";

const runTypeOf = (p: RunParams): RunType => p.type ?? (p.repeats === 3 ? "triple" : "single");

/**
 * Left panel for the Click to stitch tool (spec 4.3). The trace of the picture you opened is already
 * split into regions; choose how a region should be sewn here, then click regions on the canvas.
 * Each click is one undo step. Uses the same controls as the settings panel.
 */
export function ClickStitchPanel({ onOpen }: { onOpen: () => void }) {
  const { state, actions } = useEditor();
  const { trace, stitchSettings: st, pendingRegions, regionObjects, design } = state;
  const [pickColour, setPickColour] = useState(false);

  const done = useMemo(() => {
    const have = new Set(design?.objects.map((o) => o.id));
    return Object.values(regionObjects).filter((ids) => ids.length > 0 && ids.every((i) => have.has(i))).length;
  }, [design, regionObjects]);

  if (!trace) {
    return (
      <aside className="panel panel-left" aria-label="Click to stitch">
        <h2>Click to stitch</h2>
        <p className="muted">Open a picture first. Lilo traces it, and then you can click the regions you want stitched.</p>
        <button className="primary" onClick={onOpen}>
          Open image…
        </button>
        <button onClick={() => actions.setTool("select")}>Back to Select</button>
      </aside>
    );
  }

  const fill: FillParams = { ...DEFAULT_FILL_PARAMS, ...st.fill };
  const run = st.run;
  const type = runTypeOf(run);
  const info = patternInfo(fill.pattern);
  const editFill = (fn: (p: FillParams) => void) => {
    const p = { ...fill };
    fn(p);
    actions.setStitchSettings({ fill: p });
  };
  const editRun = (fn: (p: RunParams) => void) => {
    const p = { ...run };
    fn(p);
    actions.setStitchSettings({ run: p });
  };

  return (
    <aside className="panel panel-left" aria-label="Click to stitch">
      <h2>Click to stitch</h2>
      <p className="muted small">
        {trace.regions.length} region{trace.regions.length === 1 ? "" : "s"} in the trace, {done} stitched by you. Click a region to stitch it. Shift-click collects several; Enter stitches them together. Esc leaves.
      </p>

      <Section title="Style" help="Filled sews the whole region. Outlined sews just its edge (and the edges of its holes) as a line." id="cs-style">
        <Segmented
          label="Region style"
          value={st.style}
          options={[
            { id: "fill", label: "Filled", help: "Sew the whole region." },
            { id: "outline", label: "Outlined", help: "Sew only the edge." },
          ]}
          onChange={(v) => actions.setStitchSettings({ style: v })}
        />
      </Section>

      <Section title="Colour" help="By default each region is sewn in the thread its colour matched. Pick one thread to override that for every click." id="cs-colour">
        <Segmented
          label="Region colour"
          value={st.thread ? "thread" : "image"}
          options={[
            { id: "image", label: "From image" },
            { id: "thread", label: "One thread" },
          ]}
          onChange={(v) => {
            if (v === "image") actions.setStitchSettings({ thread: undefined });
            else setPickColour(true);
          }}
        />
        {st.thread && (
          <button className="colour-current" onClick={() => setPickColour((v) => !v)} aria-expanded={pickColour}>
            <span className="swatch" style={{ background: st.thread.hex }} aria-hidden="true" />
            <span>
              {st.thread.brand} {st.thread.code} {st.thread.name}
            </span>
          </button>
        )}
        {pickColour && (
          <ThreadPicker
            current={st.thread?.id}
            onPick={(t) => {
              actions.setStitchSettings({ thread: t });
              setPickColour(false);
            }}
          />
        )}
      </Section>

      {st.style === "fill" ? (
        <>
          <Section title="Fill pattern" id="cs-pattern">
            <PatternPicker
              value={fill.pattern ?? "tatami"}
              onPick={(pid) =>
                editFill((q) => {
                  q.pattern = pid;
                  q.angleDeg = patternInfo(pid).defaultAngleDeg;
                  delete q.patternParams;
                  if (!patternInfo(pid).gradient) delete q.gradient;
                })
              }
            />
            <p className="muted small">{info.help}</p>
          </Section>
          <Section title="Stitching" id="cs-stitching">
            <Field label="Angle" value={fill.angleDeg} min={-180} max={180} step={1} unit="°" onChange={(v) => editFill((q) => void (q.angleDeg = v))} />
            <Field label="Row spacing" value={fill.rowSpacingMm} min={0.2} max={2} step={0.05} unit="mm" hint={rowsHint(fill.rowSpacingMm)} onChange={(v) => editFill((q) => void (q.rowSpacingMm = Math.max(0.1, v)))} />
            <Field label="Stitch length" value={fill.stitchLengthMm} min={1} max={8} step={0.1} unit="mm" onChange={(v) => editFill((q) => void (q.stitchLengthMm = Math.max(0.5, v)))} />
            <Field label="Pull compensation" value={fill.pullCompMm} min={0} max={1} step={0.05} unit="mm" onChange={(v) => editFill((q) => void (q.pullCompMm = v))} />
            <Toggle label="Underlay" checked={fill.underlay} onChange={(v) => editFill((q) => void (q.underlay = v))} help="One light pass at right angles to the fill." />
            <Toggle label="Edge outline" checked={fill.edgeRun !== false} onChange={(v) => editFill((q) => void (q.edgeRun = v))} help="A running outline round the edge after the fill, for a clean border." />
          </Section>
        </>
      ) : (
        <Section title="Run type" id="cs-run">
          <div className="type-grid" role="listbox" aria-label="Run type">
            {RUN_TYPES.filter((t) => t.id !== "manual").map((t) => (
              <button
                key={t.id}
                role="option"
                aria-selected={type === t.id}
                className={type === t.id ? "active" : ""}
                title={t.help}
                onClick={() =>
                  editRun((q) => {
                    q.type = t.id;
                    q.repeats = t.id === "triple" ? 3 : 1;
                    q.widthMm = RUN_WIDTH_DEFAULT[t.id] ?? q.widthMm;
                  })
                }
              >
                {t.label}
              </button>
            ))}
          </div>
          <Field label="Stitch length" value={run.stitchLengthMm} min={0.5} max={8} step={0.1} unit="mm" onChange={(v) => editRun((q) => void (q.stitchLengthMm = Math.max(0.3, v)))} />
          {(type === "satin" || type === "estitch" || type === "doublerope" || type === "triplerope") && (
            <Field label="Width" value={run.widthMm ?? RUN_WIDTH_DEFAULT[type] ?? 1} min={0.2} max={12} step={0.1} unit="mm" onChange={(v) => editRun((q) => void (q.widthMm = v))} />
          )}
        </Section>
      )}

      {pendingRegions.length > 0 && (
        <div className="button-row">
          <button className="primary" onClick={actions.stitchPending}>
            Stitch {pendingRegions.length} selected
          </button>
          <button onClick={actions.clearPendingRegions}>Clear</button>
        </div>
      )}

      <h2 className="spaced">Start from the trace</h2>
      <p className="muted small">The automatic result is still in the design. Clear it to stitch only the regions you click.</p>
      <button onClick={actions.clearStitches} disabled={(design?.objects.length ?? 0) === 0}>
        Clear the automatic stitches
      </button>
      <button className="primary wide" onClick={() => actions.setTool("select")}>
        Done
      </button>
    </aside>
  );
}
