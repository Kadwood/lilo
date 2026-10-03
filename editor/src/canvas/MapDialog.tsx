import { Field, Segmented, Toggle } from "../panels/controls";
import { HintScope } from "../guide/Hint";
import { useEditor } from "../state/store";

/** Floating card for "map to path": how many copies, how far apart, whether they turn with the path. */
export function MapDialog() {
  const { state, actions } = useEditor();
  const draft = state.mapDraft;
  if (!draft) return null;
  const o = draft.options;
  const hasPath = !!draft.path && draft.path.length >= 2;
  const editing = !!draft.groupId;
  return (
    <HintScope scope="map">
    <div className="map-dialog" role="dialog" aria-label="Map to path">
      <h3>Map to path</h3>
      {!hasPath ? (
        <p className="muted small">Draw the path the shapes should follow: click points, then press Enter.</p>
      ) : (
        <p className="muted small">{editing ? "Editing a live mapping." : `${draft.sourceIds.length} shape${draft.sourceIds.length === 1 ? "" : "s"} along the path.`}</p>
      )}
      <Segmented
        label="Placement"
        value={o.mode}
        options={[
          { id: "count", label: "Count", help: "Place an exact number of copies, spread evenly from one end of the path to the other." },
          { id: "spacing", label: "Auto-fill", help: "Place as many copies as fit, a fixed distance apart." },
        ]}
        onChange={(mode) => actions.updateMapDraft({ mode })}
      />
      {o.mode === "count" ? (
        <Field label="Copies" value={o.count} min={1} max={60} step={1} onChange={(count) => actions.updateMapDraft({ count: Math.max(1, Math.round(count)) })} />
      ) : (
        <Field label="Spacing" value={o.spacingMm} min={1} max={60} step={0.5} unit="mm" help="Distance along the path from one copy to the next." onChange={(spacingMm) => actions.updateMapDraft({ spacingMm: Math.max(0.5, spacingMm) })} />
      )}
      <Toggle label="Rotate to follow the path" checked={o.rotate} onChange={(rotate) => actions.updateMapDraft({ rotate })} help="Turn each copy as the path turns." />
      <Toggle label="Reverse direction" checked={o.reverse} onChange={(reverse) => actions.updateMapDraft({ reverse })} help="Start from the other end of the path." />
      <div className="button-row">
        <button onClick={() => actions.setMode(state.mode === "pickPath" ? "none" : "pickPath")} aria-pressed={state.mode === "pickPath"}>
          {hasPath ? "Redraw path" : "Draw path"}
        </button>
      </div>
      <div className="button-row end">
        {editing && draft.groupId && (
          <button onClick={() => actions.detachMap(draft.groupId!)} title="Turn the copies into ordinary shapes">
            Detach
          </button>
        )}
        <button onClick={actions.closeMapDraft}>Cancel</button>
        <button className="primary" disabled={!hasPath} onClick={actions.applyMapDraft}>
          Apply
        </button>
      </div>
    </div>
    </HintScope>
  );
}
