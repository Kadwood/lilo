import { useMemo, useState } from "react";
import type { Thread } from "@lilo/engine/light";
import { Hint } from "../guide/Hint";
import { useEditor } from "../state/store";
import { ThreadPicker } from "./ThreadPicker";

/** Sequencer > Colours: one row per thread. Group objects by colour to cut thread changes, merge or swap a colour. */
export function SequencerColours() {
  const { state, actions } = useEditor();
  const { design, planResult } = state;
  const [swapping, setSwapping] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (!design) return [];
    const stitches = new Map<number, number>();
    for (const s of planResult?.plan.stitches ?? []) if (s.type === "stitch" && s.objectIndex >= 0) stitches.set(s.objectIndex, (stitches.get(s.objectIndex) ?? 0) + 1);
    const out: { thread: Thread; objects: number; stitches: number }[] = [];
    for (const t of design.threads) {
      const idx = design.objects.map((o, i) => (o.threadId === t.id ? i : -1)).filter((i) => i >= 0);
      if (idx.length === 0) continue;
      out.push({ thread: t, objects: idx.length, stitches: idx.reduce((n, i) => n + (stitches.get(i) ?? 0), 0) });
    }
    return out;
  }, [design, planResult]);

  if (!design || rows.length === 0) return <p className="muted small">Colours used in the design will be listed here.</p>;

  const blocks = planResult?.stats.colorChanges !== undefined ? planResult.stats.colorChanges + 1 : rows.length;
  return (
    <div className="seq-colours">
      <p className="muted small">
        {rows.length} colour{rows.length === 1 ? "" : "s"} · {blocks} colour block{blocks === 1 ? "" : "s"} when stitched.
      </p>
      <div className="hint-strip" aria-label="Colours help">
        <span>
          Group by colour <Hint id="seq.group-by-colour" />
        </span>
        <span>
          Merge <Hint id="seq.merge" />
        </span>
        <span>
          Swap <Hint id="seq.swap" />
        </span>
        <span>
          Select <Hint id="seq.select-colour" />
        </span>
      </div>
      <button onClick={actions.groupByColour} disabled={blocks <= rows.length} title="Reorder objects so each colour is sewn in one go, cutting thread changes.">
        Group by colour
      </button>
      <ul className="colour-list">
        {rows.map(({ thread, objects, stitches }) => (
          <li key={thread.id} className="colour-row">
            <span className="swatch" style={{ background: thread.hex }} aria-hidden="true" />
            <span className="seq-name">
              <strong>
                {thread.brand} {thread.code}
              </strong>{" "}
              {thread.name}
            </span>
            <span className="muted small" title="objects · stitches">
              {objects} · {stitches.toLocaleString()}
            </span>
            <button className="icon" aria-label={`Select ${thread.name} objects`} title="Select every object in this colour" onClick={() => actions.setSelection(design.objects.filter((o) => o.threadId === thread.id).map((o) => o.id))}>
              ◎
            </button>
            {rows.length > 1 && (
              <select
                aria-label={`Merge ${thread.name} into`}
                value=""
                onChange={(e) => {
                  const to = design.threads.find((t) => t.id === e.target.value);
                  if (to) actions.mergeColours(thread.id, to);
                }}
              >
                <option value="">Merge into…</option>
                {rows
                  .filter((r) => r.thread.id !== thread.id)
                  .map((r) => (
                    <option key={r.thread.id} value={r.thread.id}>
                      {r.thread.name} ({r.thread.code})
                    </option>
                  ))}
              </select>
            )}
            <button className="icon" aria-label={`Swap ${thread.name} for another thread`} title="Swap for another thread" onClick={() => setSwapping(swapping === thread.id ? null : thread.id)}>
              ⇄
            </button>
            {swapping === thread.id && (
              <div className="colour-swap">
                <ThreadPicker
                  current={thread.id}
                  onPick={(t) => {
                    actions.mergeColours(thread.id, t);
                    setSwapping(null);
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
