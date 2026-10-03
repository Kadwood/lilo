import { useEffect, useMemo, useRef, useState } from "react";
import { editRings, objectBox, type DesignObject } from "@lilo/engine/light";
import { useEditor } from "../state/store";
import { groupObjects } from "../state/reorder";
import { SequencerColours } from "./SequencerColours";
import { SequencerImages } from "./SequencerImages";
import { ShelfPanel } from "./ShelfPanel";

type Drag = { kind: "object"; index: number } | { kind: "group"; index: number };
/** Where a drop would land: before object `at` (kind object) or before group `at`. */
type Mark = { kind: "object" | "group"; at: number } | null;

const KIND_LABEL: Record<DesignObject["kind"], string> = { fill: "Fill", satin: "Satin", run: "Run" };

/** Name that turns into a text box on double-click. Enter or blur saves, Esc cancels. */
function EditableName({ object, onRename }: { object: DesignObject; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(object.name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      setText(object.name);
      ref.current?.select();
    }
  }, [editing, object.name]);
  if (!editing) {
    return (
      <span className="seq-name" title="Double-click to rename" onDoubleClick={(e) => (e.stopPropagation(), setEditing(true))}>
        {object.name}
      </span>
    );
  }
  const done = (save: boolean) => {
    setEditing(false);
    if (save && text.trim() && text.trim() !== object.name) onRename(text.trim());
  };
  return (
    <input
      ref={ref}
      className="seq-rename"
      aria-label={`Rename ${object.name}`}
      value={text}
      autoFocus
      onChange={(e) => setText(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => done(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") done(true);
        else if (e.key === "Escape") done(false);
      }}
    />
  );
}

/** Right panel: objects grouped by colour. Drag to reorder, click to select, eye to hide. */
export function Sequencer() {
  const { state, actions } = useEditor();
  const { design, planResult, selectedIds } = state;
  const selectedId = selectedIds[selectedIds.length - 1] ?? null;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [mark, setMark] = useState<Mark>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const groups = useMemo(() => (design ? groupObjects(design.objects) : []), [design]);
  const counts = useMemo(() => {
    const c = new Map<number, number>();
    for (const s of planResult?.plan.stitches ?? []) if (s.type === "stitch" && s.objectIndex >= 0) c.set(s.objectIndex, (c.get(s.objectIndex) ?? 0) + 1);
    return c;
  }, [planResult]);

  const tabs = (
    <div className="seq-tabs" role="tablist" aria-label="Sequencer views">
      {(["shapes", "colours", "images", "threads"] as const).map((t) => (
        <button key={t} role="tab" aria-selected={state.seqTab === t} className={state.seqTab === t ? "active" : ""} onClick={() => actions.setSeqTab(t)}>
          {t === "shapes" ? "Shapes" : t === "colours" ? "Colours" : t === "images" ? "Images" : "Threads"}
        </button>
      ))}
    </div>
  );

  if (state.seqTab === "threads") {
    return (
      <aside className="panel panel-right" aria-label="Sequencer">
        <h2>My Threads</h2>
        {tabs}
        <ShelfPanel />
      </aside>
    );
  }

  if (state.seqTab === "images") {
    return (
      <aside className="panel panel-right" aria-label="Sequencer">
        <h2>Sequencer</h2>
        {tabs}
        <SequencerImages />
      </aside>
    );
  }

  if (!design || design.objects.length === 0) {
    return (
      <aside className="panel panel-right" aria-label="Sequencer">
        <h2>Sequencer</h2>
        {tabs}
        <p className="muted">Colour blocks and stitch order will appear here.</p>
      </aside>
    );
  }

  if (state.seqTab === "colours") {
    return (
      <aside className="panel panel-right" aria-label="Sequencer">
        <h2>Sequencer</h2>
        {tabs}
        <SequencerColours />
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
      {tabs}
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
                {clusterText(group.indices, design.objects).map((cl) => {
                  if (cl.length > 1 || design.objects[cl[0]].sourceText) {
                    return <TextRow key={`text-${design.objects[cl[0]].sourceText?.group}-${cl[0]}`} indices={cl} counts={counts} thread={t?.hex} />;
                  }
                  const i = cl[0];
                  const o = design.objects[i];
                  const hidden = o.visible === false;
                  return (
                    <li
                      key={o.id}
                      className={`seq-row${selectedIds.includes(o.id) ? " selected" : ""}${hidden ? " hidden" : ""}${mark?.kind === "object" && mark.at === i ? " drop-before" : ""}${mark?.kind === "object" && mark.at === i + 1 && i === group.indices[group.indices.length - 1] ? " drop-after" : ""}`}
                      draggable
                      aria-selected={selectedIds.includes(o.id)}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", `object:${i}`);
                        setDrag({ kind: "object", index: i });
                      }}
                      onDragEnd={endDrag}
                      onDragOver={(e) => overObject(e, i)}
                      onDrop={(e) => dropOnObject(e, i)}
                      onClick={(e) => {
                        if (e.shiftKey || e.metaKey || e.ctrlKey) {
                          actions.setSelection(selectedIds.includes(o.id) ? selectedIds.filter((x) => x !== o.id) : [...selectedIds, o.id]);
                        } else if (selectedIds.length === 1 && selectedId === o.id) actions.select(null);
                        else actions.select(o.id);
                      }}
                    >
                      <span className="swatch small" style={{ background: t?.hex }} aria-hidden="true" />
                      <EditableName object={o} onRename={(n) => actions.rename(o.id, n)} />
                      <span className="seq-kind">{KIND_LABEL[o.kind]}</span>
                      <span className="seq-count" title="stitches">
                        {(counts.get(i) ?? 0).toLocaleString()}
                      </span>
                      <button
                        className={`icon${open.has(o.id) ? " on" : ""}`}
                        aria-label={`Details for ${o.name}`}
                        aria-expanded={open.has(o.id)}
                        title="Stitch and point counts"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen((prev) => {
                            const next = new Set(prev);
                            if (next.has(o.id)) next.delete(o.id);
                            else next.add(o.id);
                            return next;
                          });
                        }}
                      >
                        ⚙
                      </button>
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
                      {open.has(o.id) && <RowDetails o={o} index={i} stitches={counts.get(i) ?? 0} />}
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

/** Split consecutive indices into runs: objects of one text block stay together, everything else is alone. */
export function clusterText(indices: number[], objects: readonly DesignObject[]): number[][] {
  const out: number[][] = [];
  for (const i of indices) {
    const g = objects[i].sourceText?.group;
    const last = out[out.length - 1];
    if (g && last && objects[last[0]].sourceText?.group === g) last.push(i);
    else out.push([i]);
  }
  return out;
}

/** One row for a whole text block ("Text: Lilo"); the arrow shows its letters. */
function TextRow({ indices, counts, thread }: { indices: number[]; counts: Map<number, number>; thread?: string }) {
  const { state, actions } = useEditor();
  const [open, setOpen] = useState(false);
  const design = state.design!;
  const objs = indices.map((i) => design.objects[i]);
  const group = objs[0].sourceText!.group;
  const block = design.textBlocks?.find((b) => b.id === group);
  const label = block ? `Text: ${block.text.replace(/\s+/g, " ").trim().slice(0, 24)}` : `Text: ${group}`;
  const total = indices.reduce((n, i) => n + (counts.get(i) ?? 0), 0);
  const selected = objs.every((o) => state.selectedIds.includes(o.id));
  const hidden = objs.every((o) => o.visible === false);
  return (
    <li className={`seq-row text-row${selected ? " selected" : ""}${hidden ? " hidden" : ""}`} aria-selected={selected} onClick={() => actions.setSelection(selected ? [] : objs.map((o) => o.id))}>
      <button className="icon" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${label}`} onClick={(e) => (e.stopPropagation(), setOpen(!open))}>
        {open ? "▾" : "▸"}
      </button>
      <span className="swatch small" style={{ background: thread }} aria-hidden="true" />
      <span className="seq-name" title={block?.text}>
        {label}
      </span>
      <span className="seq-kind">Text</span>
      <span className="seq-count" title="stitches">
        {total.toLocaleString()}
      </span>
      <button
        className={`icon${hidden ? " off" : ""}`}
        aria-label={`${hidden ? "Show" : "Hide"} ${label}`}
        aria-pressed={!hidden}
        onClick={(e) => {
          e.stopPropagation();
          actions.updateObjects(objs.map((o) => o.id), hidden ? "Show text" : "Hide text", (o) => void (o.visible = hidden));
        }}
      >
        {hidden ? "◌" : "●"}
      </button>
      {open && (
        <ul className="text-letters">
          {indices.map((i) => (
            <li key={design.objects[i].id}>
              <span className="seq-name">{design.objects[i].sourceText?.char ?? design.objects[i].name}</span>
              <span className="seq-count">{(counts.get(i) ?? 0).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Per-object numbers behind the gear button. */
function RowDetails({ o, index, stitches }: { o: DesignObject; index: number; stitches: number }) {
  const nodes = editRings(o).reduce((n, r) => n + r.nodes.length, 0);
  const b = objectBox(o);
  return (
    <dl className="row-details" onClick={(e) => e.stopPropagation()} data-testid={`details-${index}`}>
      <dt>Stitches</dt>
      <dd>{stitches.toLocaleString()}</dd>
      <dt>Nodes</dt>
      <dd>{nodes}</dd>
      {b && (
        <>
          <dt>Size</dt>
          <dd>
            {(b.maxX - b.minX).toFixed(1)} × {(b.maxY - b.minY).toFixed(1)} mm
          </dd>
        </>
      )}
      {o.locked && (
        <>
          <dt>State</dt>
          <dd>Locked</dd>
        </>
      )}
    </dl>
  );
}
