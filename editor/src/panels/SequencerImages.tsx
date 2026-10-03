import { IMPORT_EXTENSIONS } from "../io/decode";
import { getPlatform } from "../platform";
import { useEditor } from "../state/store";

/** Sequencer > Images: pictures behind the shapes to trace over. Add, reorder, fade, lock. */
export function SequencerImages() {
  const { state, actions } = useEditor();
  const { refImages, selectedImageId } = state;

  const add = async () => {
    try {
      const f = await getPlatform().openFile({ extensions: IMPORT_EXTENSIONS });
      if (f) await actions.addRefImage({ name: f.name, bytes: f.bytes });
    } catch (e) {
      console.error("Add image failed", e);
    }
  };

  return (
    <div className="seq-images">
      <button onClick={() => void add()}>Add image…</button>
      <p className="muted small">Reference images sit behind your shapes. Drag one on the canvas to move it, unless it is locked.</p>
      {refImages.length === 0 && <p className="muted small">No images yet.</p>}
      <ul className="image-list">
        {[...refImages].reverse().map((img, ri) => {
          const i = refImages.length - 1 - ri; // list order is bottom first; show the top image first
          return (
            <li key={img.id} className={`image-row${selectedImageId === img.id ? " selected" : ""}${img.visible ? "" : " hidden"}`} aria-selected={selectedImageId === img.id} onClick={() => actions.selectRefImage(img.id)}>
              <div className="image-row-head">
                <span className="seq-name" title={img.name}>
                  {img.name}
                </span>
                <button
                  className="icon"
                  aria-label={`Move ${img.name} up`}
                  title="Bring forward"
                  disabled={i === refImages.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.moveRefImage(img.id, 1);
                  }}
                >
                  ▲
                </button>
                <button
                  className="icon"
                  aria-label={`Move ${img.name} down`}
                  title="Send back"
                  disabled={i === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.moveRefImage(img.id, -1);
                  }}
                >
                  ▼
                </button>
                <button
                  className={`icon${img.visible ? "" : " off"}`}
                  aria-label={`${img.visible ? "Hide" : "Show"} ${img.name}`}
                  aria-pressed={img.visible}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.updateRefImage(img.id, { visible: !img.visible });
                  }}
                >
                  {img.visible ? "●" : "◌"}
                </button>
                <button
                  className={`icon${img.locked ? " on" : ""}`}
                  aria-label={`${img.locked ? "Unlock" : "Lock"} ${img.name}`}
                  aria-pressed={img.locked}
                  title={img.locked ? "Locked: can't be dragged" : "Lock in place"}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.updateRefImage(img.id, { locked: !img.locked });
                  }}
                >
                  {img.locked ? "\u{1F512}" : "\u{1F513}"}
                </button>
                <button
                  className="icon"
                  aria-label={`Remove ${img.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.removeRefImage(img.id);
                  }}
                >
                  ✕
                </button>
              </div>
              <label className="image-opacity">
                <span className="muted small">Opacity</span>
                <input type="range" min={0.05} max={1} step={0.05} value={img.opacity} aria-label={`${img.name} opacity`} onChange={(e) => actions.updateRefImage(img.id, { opacity: Number(e.target.value) })} />
                <output>{Math.round(img.opacity * 100)}%</output>
              </label>
              <label className="image-opacity">
                <span className="muted small">Width</span>
                <input type="range" min={10} max={260} step={1} value={img.widthMm} aria-label={`${img.name} width`} disabled={img.locked} onChange={(e) => actions.updateRefImage(img.id, { widthMm: Number(e.target.value) })} />
                <output>{Math.round(img.widthMm)} mm</output>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
