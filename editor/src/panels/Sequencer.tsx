import { useEditor } from "../state/store";
import { SequencerColours } from "./SequencerColours";
import { SequencerImages } from "./SequencerImages";
import { LayersPanel } from "./Layers";
import { ShelfPanel } from "./ShelfPanel";

export { clusterText } from "./Layers";

const TABS = [
  ["layers", "Layers"],
  ["colours", "Colours"],
  ["images", "Images"],
  ["threads", "Threads"],
] as const;

/** Right panel. Layers is the sew order (pictures and stitch layers in one list); Colours, Images and My Threads sit beside it. */
export function Sequencer() {
  const { state, actions } = useEditor();
  const { design } = state;

  const tabs = (
    <div className="seq-tabs" role="tablist" aria-label="Sew order views">
      {TABS.map(([t, label]) => (
        <button key={t} role="tab" aria-selected={state.seqTab === t} className={state.seqTab === t ? "active" : ""} onClick={() => actions.setSeqTab(t)}>
          {label}
        </button>
      ))}
    </div>
  );
  const shell = (title: string, body: React.ReactNode) => (
    <aside className="panel panel-right" aria-label="Sew order" data-tour="sequencer">
      <h2>{title}</h2>
      {tabs}
      {body}
    </aside>
  );

  if (state.seqTab === "threads") return shell("My Threads", <ShelfPanel />);
  if (state.seqTab === "images") return shell("Sew order", <SequencerImages />);
  if (!design || (state.seqTab === "colours" && design.objects.length === 0)) {
    return shell("Sew order", <p className="muted">Layers, colour blocks and stitch order will appear here.</p>);
  }
  if (state.seqTab === "colours") return shell("Sew order", <SequencerColours />);
  return shell("Sew order", <LayersPanel />);
}
