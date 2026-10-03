import { useMemo, useState } from "react";
import type { DesignObject } from "@lilo/engine";
import { useEditor } from "../state/store";
import { groupObjects } from "../state/reorder";

type Drag = { kind: "object"; index: number } | { kind: "group"; index: number };
/** Where a drop would land: before object `at` (kind object) or before group `at`. */
type Mark = { kind: "object" | "group"; at: number } | null;

const KIND_LABEL: Record<DesignObject["kind"], string> = { fill: "Fill", satin: "Satin", run: "Run" };

/** Right panel: objects grouped by colour. Drag to reorder, click to select, eye to hide. */
export function Sequencer() {
  const { state, actions } = useEditor();
  const { design, planResult, selectedId } = state;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [mark, setMark] = useState<Mark>(null);

  const groups = useMemo(() => (design ? groupObjects(design.objects) : []), [design]);
  const counts = useMemo(() => {
    const c = new Map<number, number>();
    for (const s of planResult?.plan.stitches ?? []) if (s.type === "stitch" && s.objectIndex >= 0) c.set(s.objectIndex, (c.get(s.objectIndex) ?? 0) + 1);
    return c;
  }, [planResult]);

  if (!design) {
    return (
      <aside className="panel panel-right" aria-label="Sequencer">
        <h2>Sequencer</h2>
        <p className="muted">Colour blocks and stitch order will appear here.</p>
      </aside>
    );
  }
  const threadOf = new Map(design.threads.map((t) => [t.id, t]));

  const endDrag = () => {
    setDrag(null);
    setMark(null);
  };
  const dropOnObject = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (drag?.kind === "object") {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      actions.reorderObject(drag.index, after ? index + 1 : index);
    }
    endDrag();
  };
  const overObject = (e: React.DragEvent, index: number) => {
    if (drag?.kind !== "object") return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMark({ kind: "object", at: e.clientY > rect.top + rect.height / 2 ? index + 1 : index });
  };
  const dropOnGroup = (e: React.DragEvent, g: number) => {
    e.preventDefault();
    if (drag?.kind === "group") actions.reorderGroup(drag.index, g);
    else if (drag?.kind === "object") actions.reorderObject(drag.index, groups[g]?.indices[0] ?? design.objects.length);
    endDrag();
  };
  const overGroup = (e: React.DragEvent, g: number) => {
    if (!drag) return;
    e.preventDefault();
    setMark({ kind: "group", at: g });
  };

  return (
    <aside className="panel panel-right" aria-label="Sequencer">
      <h2>Sequencer</h2>
      <p className="muted small">
        {design.objects.length} objects · {groups.length} colour block{groups.length === 1 ? "" : "s"}. Drag to reorder.
      </p>
      <ol className="seq" onDragLeave={() => setMark(null)}>
        {groups.map((group, gi) => {
          const t = threadOf.get(group.threadId);
          const members = group.indices.map((i) => design.objects[i]);
          const allHidden = members.every((o) => o.visible === false);
          return (
            <li key={`${group.threadId}-${group.indices[0]}`} className="seq-group">
              <div
                className={`seq-group-head${mark?.kind === "group" && mark.at === gi ? " drop-before" : ""}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", `group:${gi}`);
                  setDrag({ kind: "group", index: gi });
                }}
                onDragEnd={endDrag}
                onDragOver={(e) => overGroup(e, gi)}
                onDrop={(e) => dropOnGroup(e, gi)}
              >
                <span className="swatch" style={{ background: t?.hex }} aria-hidden="true" />
                <span className="seq-name">
                  <strong>{t ? `${t.brand} ${t.code}` : "?"}</strong> {t?.name}
                </span>
                <button className="icon" aria-label={`Move ${t?.name ?? "colour"} block up`} disabled={gi === 0} onClick={() => actions.reorderGroup(gi, gi - 1)}>
                  ▲
                </button>
                <button className="icon" aria-label={`Move ${t?.name ?? "colour"} block down`} disabled={gi === groups.length - 1} onClick={() => actions.reorderGroup(gi, gi + 2)}>
                  ▼
                </button>
                <button
                  className={`icon${allHidden ? " off" : ""}`}
                  aria-label={`${allHidden ? "Show" : "Hide"} ${t?.name ?? "colour"} block`}
                  aria-pressed={!allHidden}
                  onClick={() => actions.toggleGroup(gi, allHidden)}
                >
                  {allHidden ? "◌" : "●"}
                </button>
              </div>
              <ul>
                {group.indices.map((i) => {
                  const o = design.objects[i];
                  const hidden = o.visible === false;
                  return (
                    <li
                      key={o.id}
                      className={`seq-row${selectedId === o.id ? " selected" : ""}${hidden ? " hidden" : ""}${mark?.kind === "object" && mark.at === i ? " drop-before" : ""}${mark?.kind === "object" && mark.at === i + 1 && i === group.indices[group.indices.length - 1] ? " drop-after" : ""}`}
                      draggable
                      aria-selected={selectedId === o.id}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", `object:${i}`);
                        setDrag({ kind: "object", index: i });
                      }}
                      onDragEnd={endDrag}
                      onDragOver={(e) => overObject(e, i)}
                      onDrop={(e) => dropOnObject(e, i)}
                      onClick={() => actions.select(selectedId === o.id ? null : o.id)}
                    >
                      <span className="swatch small" style={{ background: t?.hex }} aria-hidden="true" />
                      <span className="seq-name">{o.name}</span>
                      <span className="seq-kind">{KIND_LABEL[o.kind]}</span>
                      <span className="seq-count" title="stitches">
                        {(counts.get(i) ?? 0).toLocaleString()}
                      </span>
                      <button
                        className="icon"
                        aria-label={`Move ${o.name} up`}
                        disabled={i === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.reorderObject(i, i - 1);
                        }}
                      >
                        ▲
                      </button>
                      <button
                        className="icon"
                        aria-label={`Move ${o.name} down`}
                        disabled={i === design.objects.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.reorderObject(i, i + 2);
                        }}
                      >
                        ▼
                      </button>
                      <button
                        className={`icon${hidden ? " off" : ""}`}
                        aria-label={`${hidden ? "Show" : "Hide"} ${o.name}`}
                        aria-pressed={!hidden}
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.toggleObject(o.id, hidden);
                        }}
                      >
                        {hidden ? "◌" : "●"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
        <li className={`seq-end${mark?.kind === "group" && mark.at === groups.length ? " drop-before" : ""}`} onDragOver={(e) => overGroup(e, groups.length)} onDrop={(e) => dropOnGroup(e, groups.length)} aria-hidden="true" />
      </ol>
    </aside>
  );
}
