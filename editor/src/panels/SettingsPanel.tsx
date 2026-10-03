import { useState } from "react";
import {
  DEFAULT_FILL_PARAMS,
  DEFAULT_SATIN_PARAMS,
  patternInfo,
  patternValue,
  type DesignObject,
  type FillObject,
  type FillParams,
  type RunObject,
  type RunType,
  type SatinObject,
  type SatinParams,
  type SatinUnderlay,
} from "@lilo/engine/light";
import { useEditor } from "../state/store";
import { Field, HelpTip, Section, Segmented, Toggle } from "./controls";
import { DimensionsSection } from "./DimensionsSection";
import { PatternPicker } from "./PatternPicker";
import { ThreadPicker } from "./ThreadPicker";

const RUN_TYPES: { id: RunType; label: string; help: string }[] = [
  { id: "single", label: "Single", help: "One line of stitches. The everyday running stitch." },
  { id: "triple", label: "Triple", help: "Each stitch is sewn forward, back and forward again: a heavier, bolder line (bean stitch)." },
  { id: "satin", label: "Satin", help: "A satin column of fixed width along the line, like a stroke with thread across it." },
  { id: "estitch", label: "E-stitch", help: "Comb-shaped stitches reaching out from the line, handy for appliqué edges and borders." },
  { id: "doublerope", label: "Double rope", help: "A twisted cord made from two passes." },
  { id: "triplerope", label: "Triple rope", help: "A thicker twisted cord made from three passes." },
  { id: "manual", label: "Manual", help: "Sew exactly the stitch points you placed, in order." },
];

const RUN_WIDTH_DEFAULT: Partial<Record<RunType, number>> = { satin: 2.5, estitch: 3, doublerope: 0.4, triplerope: 0.4 };

const UNDERLAYS: { id: SatinUnderlay; label: string }[] = [
  { id: "none", label: "None" },
  { id: "center", label: "Center run" },
  { id: "contour", label: "Contour" },
  { id: "zigzag", label: "Zig-zag" },
];

const runTypeOf = (o: RunObject): RunType => o.params.type ?? (o.params.repeats === 3 ? "triple" : "single");

/** Left panel: everything about the selected shapes. Every control edits live; sliders merge into one undo step. */
export function SettingsPanel() {
  const { state, actions } = useEditor();
  const [pickColour, setPickColour] = useState(false);
  const objs = state.design ? state.design.objects.filter((o) => state.selectedIds.includes(o.id)) : [];
  if (objs.length === 0) return null;
  const ids = objs.map((o) => o.id);
  const first = objs[0];
  const fills = objs.filter((o): o is FillObject => o.kind === "fill");
  const runs = objs.filter((o): o is RunObject => o.kind === "run");
  const satins = objs.filter((o): o is SatinObject => o.kind === "satin");
  const thread = state.design?.threads.find((t) => t.id === first.threadId);
  const closedShape = (o: DesignObject) => o.kind === "fill" || (o.kind === "run" && o.geometry.closed && o.params.type !== "manual");
  const canConvert = objs.every(closedShape);
  const locked = objs.every((o) => o.locked);

  const merge = (key: string) => ({ merge: `set:${key}` });
  const done = () => actions.endGroup();
  const editFills = (label: string, key: string, fn: (p: FillParams) => void) =>
    actions.updateObjects(
      fills.map((o) => o.id),
      label,
      (o) => {
        if (o.kind === "fill") fn(o.params);
      },
      merge(key),
    );
  const editRuns = (label: string, key: string, fn: (o: RunObject) => void) =>
    actions.updateObjects(
      runs.map((o) => o.id),
      label,
      (o) => {
        if (o.kind === "run") fn(o);
      },
      merge(key),
    );
  const editSatinParams = (label: string, key: string, fn: (p: Partial<SatinParams>, o: DesignObject) => void) => {
    actions.updateObjects(
      ids,
      label,
      (o) => {
        if (o.kind === "satin") fn(o.params, o);
        else if (o.kind === "run" && runTypeOf(o) === "satin") {
          o.params.satin = { ...o.params.satin };
          fn(o.params.satin, o);
        }
      },
      merge(key),
    );
  };

  return (
    <aside className="panel panel-left" aria-label="Settings">
      <h2>{objs.length > 1 ? `${objs.length} shapes` : first.name}</h2>
      {locked && <p className="muted small">Locked. Unlock it from the toolbar to edit.</p>}

      <DimensionsSection />

      <Section title="Colour" help="The thread this shape is sewn in. Pick from the Brother, Country and Brothread ranges." id="colour">
        <button className="colour-current" onClick={() => setPickColour((v) => !v)} aria-expanded={pickColour}>
          <span className="swatch" style={{ background: thread?.hex }} aria-hidden="true" />
          <span>{thread ? `${thread.brand} ${thread.code} ${thread.name}` : "Choose a colour"}</span>
        </button>
        {pickColour && (
          <ThreadPicker
            current={first.threadId}
            onPick={(t) => {
              actions.setObjectThread(ids, t);
              setPickColour(false);
            }}
          />
        )}
      </Section>

      {canConvert && (
        <Section title="Style" help="Filled sews the whole area. Outlined sews just its edge, with any run type." id="style">
          <Segmented
            label="Outlined or filled"
            value={fills.length === objs.length ? "fill" : runs.length === objs.length ? "outline" : "fill"}
            options={[
              { id: "fill", label: "Filled", help: "Sew the whole shape." },
              { id: "outline", label: "Outlined", help: "Sew only the edge." },
            ]}
            onChange={(v) => {
              const isFill = fills.length === objs.length;
              if ((v === "fill") !== isFill) actions.convertSelectionOutline();
            }}
          />
        </Section>
      )}

      {runs.length > 0 && (
        <Section title="Run type" help="How the line is sewn. Each type has its own settings below." id="runtype">
          <div className="type-grid" role="listbox" aria-label="Run type">
            {RUN_TYPES.map((t) => (
              <button
                key={t.id}
                role="option"
                aria-selected={runTypeOf(runs[0]) === t.id}
                className={runTypeOf(runs[0]) === t.id ? "active" : ""}
                title={t.help}
                onClick={() =>
                  editRuns("Run type", "runtype", (o) => {
                    o.params.type = t.id;
                    o.params.repeats = t.id === "triple" ? 3 : 1;
                    o.params.widthMm = RUN_WIDTH_DEFAULT[t.id] ?? o.params.widthMm;
                  })
                }
              >
                {t.label}
              </button>
            ))}
          </div>
          <RunSettings runs={runs} editRuns={editRuns} done={done} />
        </Section>
      )}

      {(satins.length > 0 || runs.some((o) => runTypeOf(o) === "satin")) && (
        <SatinSettings objs={objs} editSatinParams={editSatinParams} done={done} />
      )}

      {fills.length > 0 && <FillSettings fills={fills} editFills={editFills} done={done} />}

      {first.mapGroup && (
        <Section title="Map to path" help="These shapes are copies placed along a path. Edit the count and spacing, or detach them to make them ordinary shapes." id="map">
          <div className="button-row">
            <button onClick={() => actions.openMapDraft()}>Edit…</button>
            <button onClick={() => actions.detachMap(first.mapGroup!)}>Detach</button>
          </div>
        </Section>
      )}
    </aside>
  );
}

function RunSettings({ runs, editRuns, done }: { runs: RunObject[]; editRuns: (label: string, key: string, fn: (o: RunObject) => void) => void; done: () => void }) {
  const r = runs[0];
  const type = runTypeOf(r);
  const p = r.params;
  if (type === "manual") return <p className="muted small">Each stitch is sewn where you placed it. Reshape the shape to move them.</p>;
  return (
    <>
      <Field label="Stitch length" value={p.stitchLengthMm} min={0.5} max={8} step={0.1} unit="mm" help="Distance between needle drops along the line." onChange={(v) => editRuns("Stitch length", "len", (o) => void (o.params.stitchLengthMm = Math.max(0.3, v)))} onDone={done} />
      {(type === "single" || type === "triple") && (
        <Field label="Tolerance" value={p.toleranceMm ?? 0.1} min={0.1} max={2} step={0.05} unit="mm" help="How far a stitch may stray from the curve you drew. Lower follows curves more closely (minimum 0.1 mm)." onChange={(v) => editRuns("Tolerance", "tol", (o) => void (o.params.toleranceMm = Math.max(0.1, v)))} onDone={done} />
      )}
      {(type === "estitch" || type === "doublerope" || type === "triplerope") && (
        <Field
          label="Width"
          value={p.widthMm ?? RUN_WIDTH_DEFAULT[type] ?? 1}
          min={type === "estitch" ? 1 : 0.2}
          max={type === "estitch" ? 8 : 2}
          step={0.1}
          unit="mm"
          help={type === "estitch" ? "How far the teeth reach out from the line." : "How wide the twist of the rope is."}
          onChange={(v) => editRuns("Width", "width", (o) => void (o.params.widthMm = v))}
          onDone={done}
        />
      )}
      {type === "estitch" && <Toggle label="Flipped" checked={!!p.flipped} onChange={(v) => editRuns("Flip E-stitch", "flip", (o) => void (o.params.flipped = v))} help="Put the teeth on the other side of the line." />}
    </>
  );
}

function SatinSettings({ objs, editSatinParams, done }: { objs: DesignObject[]; editSatinParams: (label: string, key: string, fn: (p: Partial<SatinParams>, o: DesignObject) => void) => void; done: () => void }) {
  const { actions } = useEditor();
  const o = objs.find((x) => x.kind === "satin" || (x.kind === "run" && runTypeOf(x) === "satin"))!;
  const p: SatinParams = { ...DEFAULT_SATIN_PARAMS, ...(o.kind === "satin" ? o.params : o.kind === "run" ? o.params.satin : {}) };
  const isRun = o.kind === "run";
  return (
    <Section title="Satin" help="Settings for satin columns: how close the stitches sit, how the edges are compensated and what sits underneath." id="satin">
      {isRun && (
        <Field
          label="Width"
          value={(o as RunObject).params.widthMm ?? 2.5}
          min={0.5}
          max={12}
          step={0.1}
          unit="mm"
          help="Width of the column."
          onChange={(v) =>
            actions.updateObjects(
              objs.filter((x) => x.kind === "run").map((x) => x.id),
              "Satin width",
              (x) => void (x.kind === "run" && (x.params.widthMm = v)),
              { merge: "set:swidth" },
            )
          }
          onDone={done}
        />
      )}
      <Field label="Density" value={p.densityMm} min={0.2} max={1.5} step={0.05} unit="mm" help="Distance between satin stitches along the column. Smaller is denser." onChange={(v) => editSatinParams("Density", "density", (q) => void (q.densityMm = v))} onDone={done} />
      <Field label="Pull compensation" value={p.pullCompMm} min={0} max={0.8} step={0.05} unit="mm" help="Widens each side a little, because fabric pulls the stitches in." onChange={(v) => editSatinParams("Pull compensation", "pull", (q) => void (q.pullCompMm = v))} onDone={done} />
      <Field label="Split above" value={p.splitMaxWidthMm ?? 0} min={0} max={12} step={0.5} unit="mm" help="Columns wider than this are split into stitched halves so long stitches don't snag. 0 turns it off." onChange={(v) => editSatinParams("Split satin", "split", (q) => void (q.splitMaxWidthMm = v > 0 ? v : undefined))} onDone={done} />
      {(p.splitMaxWidthMm ?? 0) > 0 && (
        <>
          <Field label="Stagger cycles" value={p.staggerCycles ?? 0} min={0} max={8} step={1} help="Repeat length of the stagger, in stitches. 0 is off." onChange={(v) => editSatinParams("Stagger", "stagger", (q) => void (q.staggerCycles = v > 0 ? v : undefined))} onDone={done} />
          <Field label="Stagger amount" value={p.staggerAmountMm ?? 0} min={0} max={2} step={0.1} unit="mm" help="How far the split lines shift sideways between stitches." onChange={(v) => editSatinParams("Stagger amount", "staggeramt", (q) => void (q.staggerAmountMm = v > 0 ? v : undefined))} onDone={done} />
        </>
      )}
      <Toggle label="Short stitches on curves" checked={!!p.shortStitches} onChange={(v) => editSatinParams("Short stitches", "short", (q) => void (q.shortStitches = v || undefined))} help="On the inside of tight curves the stitches bunch up. This shortens some of them to keep the column even." />
      <label className="field-line">
        <span className="field-label">
          Underlay <HelpTip text="Stitches sewn first under the column to stabilise the fabric and lift the satin." />
        </span>
        <select aria-label="Satin underlay" value={p.underlay} onChange={(e) => editSatinParams("Underlay", "underlay", (q) => void (q.underlay = e.target.value as SatinUnderlay))}>
          {UNDERLAYS.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </label>
    </Section>
  );
}

function FillSettings({ fills, editFills, done }: { fills: FillObject[]; editFills: (label: string, key: string, fn: (p: FillParams) => void) => void; done: () => void }) {
  const { actions } = useEditor();
  const f = fills[0];
  const p: FillParams = { ...DEFAULT_FILL_PARAMS, ...f.params };
  const id = p.pattern ?? "tatami";
  const info = patternInfo(id);
  const g = p.gradient;
  const hasUnderlays = !!p.underlays;
  return (
    <>
      <Section title="Fill pattern" help="The texture of the fill. Each preview shows the pattern on a 40 × 30 mm shape." id="pattern">
        <PatternPicker
          value={id}
          onPick={(pid) =>
            editFills("Fill pattern", "pattern", (q) => {
              q.pattern = pid;
              q.angleDeg = patternInfo(pid).defaultAngleDeg;
              delete q.patternParams;
              if (!patternInfo(pid).gradient) delete q.gradient;
            })
          }
        />
        <p className="muted small">{info.help}</p>
        {info.settings.map((s) => (
          <Field
            key={s.key}
            label={s.label}
            value={patternValue(id, p.patternParams, s.key)}
            min={s.min}
            max={s.max}
            step={s.step}
            help={s.help}
            onChange={(v) => editFills(s.label, `pp:${s.key}`, (q) => void (q.patternParams = { ...q.patternParams, [s.key]: v }))}
            onDone={done}
          />
        ))}
        {info.centred && <p className="muted small">Drag the cross on the canvas to move the centre.</p>}
        {info.guided && (
          <div className="button-row">
            <button onClick={() => actions.setMode("guide")}>Draw guide curve</button>
            {(p.guides?.length ?? 0) > 0 && <button onClick={() => editFills("Clear guides", "guides", (q) => void delete q.guides)}>Clear guides ({p.guides!.length})</button>}
          </div>
        )}
      </Section>

      <Section title="Stitching" help="Shared by every pattern: direction, row spacing, stitch length and how the edge is compensated." id="stitching">
        <div className="field-line with-button">
          <Field label="Angle" value={p.angleDeg} min={-180} max={180} step={1} unit="°" help="Direction of the stitch rows, measured clockwise from the right. Also turns the pattern." onChange={(v) => editFills("Stitch angle", "angle", (q) => void (q.angleDeg = v))} onDone={done} />
          <button className="icon" aria-pressed={false} title="Edit the angle on the canvas with a dial" onClick={() => actions.setMode("angle")}>
            Dial
          </button>
        </div>
        <Field label="Row spacing" value={p.rowSpacingMm} min={0.2} max={2} step={0.05} unit="mm" help="Distance between rows. Smaller is denser. Motif patterns use it to space the shapes." onChange={(v) => editFills("Row spacing", "spacing", (q) => void (q.rowSpacingMm = Math.max(0.1, v)))} onDone={done} />
        <Field label="Stitch length" value={p.stitchLengthMm} min={1} max={8} step={0.1} unit="mm" help="Longest stitch along a row. Machines snag above about 12 mm." onChange={(v) => editFills("Stitch length", "slen", (q) => void (q.stitchLengthMm = Math.max(0.5, v)))} onDone={done} />
        <Field label="Pull compensation" value={p.pullCompMm} min={0} max={1} step={0.05} unit="mm" help="Grows the shape a little so the stitched result matches your drawing after the fabric pulls in." onChange={(v) => editFills("Pull compensation", "fpull", (q) => void (q.pullCompMm = v))} onDone={done} />
        <Field label="Hand stitch" value={p.handStitch ?? 0} min={0} max={5} step={1} help="Adds a seeded random wobble to stitch positions so the fill looks hand-sewn. 0 is off." onChange={(v) => editFills("Hand stitch", "hand", (q) => void (q.handStitch = v > 0 ? v : undefined))} onDone={done} />
        <Toggle label="Underpath" checked={!!p.underpath} onChange={(v) => editFills("Underpath", "underpath", (q) => void (q.underpath = v || undefined))} help="Travel through the fill, hidden under the stitches, instead of jumping from row to row." />
        <Toggle label="Edge outline" checked={p.edgeRun !== false} onChange={(v) => editFills("Edge outline", "edge", (q) => void (q.edgeRun = v))} help="Sews a running outline round the edge after the fill, for a clean border." />
      </Section>

      {info.gradient && (
        <Section title="Gradient" help="Make the rows thinner out across the shape: a fade. Ramp fades one way; plateau is dense in the middle and thins toward both ends." open={!!g} id="gradient">
          <Segmented
            label="Gradient type"
            value={g?.kind ?? "none"}
            options={[
              { id: "none", label: "None" },
              { id: "ramp", label: "Ramp" },
              { id: "plateau", label: "Plateau" },
            ]}
            onChange={(v) =>
              editFills("Gradient", "gradient", (q) => {
                if (v === "none") delete q.gradient;
                else q.gradient = { kind: v, from: q.gradient?.from ?? 1, to: q.gradient?.to ?? 3, reverse: q.gradient?.reverse };
              })
            }
          />
          {g && (
            <>
              <Field label="Start spacing ×" value={g.from} min={0.5} max={5} step={0.1} help="Row spacing multiplier at the start of the gradient. 1 is the normal spacing." onChange={(v) => editFills("Gradient", "gfrom", (q) => void (q.gradient = q.gradient && { ...q.gradient, from: v }))} onDone={done} />
              <Field label={g.kind === "ramp" ? "End spacing ×" : "Middle spacing ×"} value={g.to} min={0.5} max={5} step={0.1} help="Row spacing multiplier at the far end (ramp) or in the middle (plateau). Bigger is sparser." onChange={(v) => editFills("Gradient", "gto", (q) => void (q.gradient = q.gradient && { ...q.gradient, to: v }))} onDone={done} />
              <Toggle label="Reverse" checked={!!g.reverse} onChange={(v) => editFills("Gradient", "grev", (q) => void (q.gradient = q.gradient && { ...q.gradient, reverse: v }))} />
            </>
          )}
        </Section>
      )}

      <Section title="Underlay" help="Light stitches sewn first, under the pattern, to hold the fabric flat. Add several passes at different angles for heavy fills." open={false} id="underlay">
        {!hasUnderlays && info.underlay && <Toggle label="Underlay" checked={p.underlay} onChange={(v) => editFills("Underlay", "underlay", (q) => void (q.underlay = v))} help="One light pass at right angles to the fill." />}
        {!hasUnderlays && !info.underlay && <p className="muted small">Open patterns skip the automatic underlay, which would show through the gaps. Add passes below if you want one.</p>}
        {!hasUnderlays && (
          <button onClick={() => editFills("Custom underlays", "ulist", (q) => void (q.underlays = [{ angleDeg: q.angleDeg + 90, spacingMm: 2.5, stitchLengthMm: 3.5, insetMm: 0.5 }]))}>Customise underlays…</button>
        )}
        {hasUnderlays && (
          <>
            {p.underlays!.map((u, i) => (
              <div className="underlay-row" key={i}>
                <strong>Pass {i + 1}</strong>
                <Field label="Angle" value={u.angleDeg} min={-180} max={180} step={1} unit="°" onChange={(v) => editFills("Underlay", `u${i}a`, (q) => void (q.underlays![i].angleDeg = v))} onDone={done} />
                <Field label="Spacing" value={u.spacingMm} min={0.5} max={6} step={0.1} unit="mm" onChange={(v) => editFills("Underlay", `u${i}s`, (q) => void (q.underlays![i].spacingMm = v))} onDone={done} />
                <Field label="Length" value={u.stitchLengthMm} min={1} max={8} step={0.1} unit="mm" onChange={(v) => editFills("Underlay", `u${i}l`, (q) => void (q.underlays![i].stitchLengthMm = v))} onDone={done} />
                <Field label="Inset" value={u.insetMm} min={0} max={3} step={0.1} unit="mm" help="How far inside the edge the underlay stops, so it stays hidden." onChange={(v) => editFills("Underlay", `u${i}i`, (q) => void (q.underlays![i].insetMm = v))} onDone={done} />
                <button onClick={() => editFills("Remove underlay", "uremove", (q) => void q.underlays!.splice(i, 1))}>Remove</button>
              </div>
            ))}
            <div className="button-row">
              <button onClick={() => editFills("Add underlay", "uadd", (q) => void q.underlays!.push({ angleDeg: q.angleDeg + (q.underlays!.length % 2 ? 90 : 45), spacingMm: 3, stitchLengthMm: 3.5, insetMm: 0.8 }))}>Add pass</button>
              <button onClick={() => editFills("Simple underlay", "ulist", (q) => void delete q.underlays)}>Back to simple</button>
            </div>
          </>
        )}
      </Section>
    </>
  );
}
