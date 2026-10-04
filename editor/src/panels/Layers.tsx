import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { editRings, objectBox, sewOrder, type Design, type DesignImage, type DesignObject, type Layer } from "@lilo/engine/light";
import { IMPORT_EXTENSIONS } from "../io/decode";
import { getPlatform } from "../platform";
import { useEditor } from "../state/store";
import { groupObjects } from "../state/reorder";
import { Hint } from "../guide/Hint";

/**
 * Sequencer > Layers. The list is the sew order, shown like Photoshop: the TOP of the list sews LAST and sits
 * on top, the bottom sews first. Pictures and stitch layers live in one list; inside a layer the shapes are
 * listed the same way (last sewn on top) and every shape shows its sew number.
 */

type Drag = { kind: "object"; id: string } | { kind: "image"; id: string } | { kind: "layer"; id: string };
type Mark = { kind: "object" | "image"; id: string; after: boolean } | { kind: "layer"; id: string; where: "above" | "below" | "into" } | null;

const KIND_LABEL: Record<DesignObject["kind"], string> = { fill: "Fill", satin: "Satin", run: "Run" };

/** Text that turns into a box on double-click or F2. Enter or blur saves, Esc cancels. */
function EditableText({ value, label, editing, onStart, onDone }: { value: string; label: string; editing: boolean; onStart: () => void; onDone: (save: string | null) => void }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      setText(value);
      ref.current?.select();
    }
  }, [editing, value]);
  if (!editing) {
    return (
      <span className="seq-name" title="Double-click to rename" onDoubleClick={(e) => (e.stopPropagation(), onStart())}>
        {value}
      </span>
    );
  }
  const finish = (save: boolean) => onDone(save && text.trim() && text.trim() !== value ? text.trim() : null);
  return (
    <input
      ref={ref}
      className="seq-rename"
      aria-label={`Rename ${label}`}
      value={text}
      autoFocus
      onChange={(e) => setText(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
    />
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

/** "sews 4–7", "sews 4", or why it sews nothing. */
export function sewRangeText(layer: Layer, range: { first: number; last: number } | null): string {
  if (layer.kind === "picture") return "not stitched";
  if (!layer.visible) return "hidden, not sewn";
  if (!range) return "empty";
  return range.first === range.last ? `sews ${range.first}` : `sews ${range.first}–${range.last}`;
}

const rowKey = {
  layer: (id: string) => `layer:${id}`,
  object: (id: string) => `obj:${id}`,
  image: (id: string) => `img:${id}`,
  text: (group: string) => `text:${group}`,
};

export function LayersPanel() {
  const { state, actions } = useEditor();
  const design = state.design as Design;
  const { planResult, selectedIds } = state;
  const selectedId = selectedIds[selectedIds.length - 1] ?? null;
  const layers = design.layers ?? [];
  const top = useMemo(() => [...layers].reverse(), [layers]); // top of the list = top layer
  const order = useMemo(() => sewOrder(design), [design]);
  const counts = useMemo(() => {
    const c = new Map<number, number>();
    for (const s of planResult?.plan.stitches ?? []) if (s.type === "stitch" && s.objectIndex >= 0) c.set(s.objectIndex, (c.get(s.objectIndex) ?? 0) + 1);
    return c;
  }, [planResult]);
  const activeId = state.activeLayerId && layers.some((l) => l.id === state.activeLayerId) ? state.activeLayerId : (top.find((l) => l.kind === "stitch")?.id ?? null);
  const active = layers.find((l) => l.id === activeId) ?? null;
  const threadOf = useMemo(() => new Map(design.threads.map((t) => [t.id, t])), [design.threads]);

  const [drag, setDrag] = useState<Drag | null>(null);
  const [mark, setMark] = useState<Mark>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const treeRef = useRef<HTMLUListElement>(null);
  const refocus = useRef<string | null>(null);

  // After a keyboard move the row is re-created in a new spot: put focus back on it.
  useLayoutEffect(() => {
    const k = refocus.current;
    if (!k) return;
    refocus.current = null;
    const el = [...(treeRef.current?.querySelectorAll<HTMLElement>("[data-key]") ?? [])].find((e) => e.dataset.key === k);
    el?.focus();
  });

  const idxOf = useMemo(() => new Map(design.objects.map((o, i) => [o.id, i])), [design.objects]);
  const objectsIn = (layerId: string) => design.objects.flatMap((o, i) => (o.layerId === layerId ? [i] : []));
  const imagesIn = (layerId: string): DesignImage[] => (design.images ?? []).filter((m) => m.layerId === layerId);
  const sizeOf = (l: Layer) => (l.kind === "stitch" ? objectsIn(l.id).length : imagesIn(l.id).length);
  const layerIndex = (id: string) => layers.findIndex((l) => l.id === id);

  const toggle = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };
  const endDrag = () => {
    setDrag(null);
    setMark(null);
  };

  /** Add a picture: it goes into the selected picture layer (or the lowest one). */
  const addImage = async () => {
    try {
      const f = await getPlatform().openFile({ extensions: IMPORT_EXTENSIONS });
      if (f) await actions.addRefImage({ name: f.name, bytes: f.bytes });
    } catch (e) {
      console.error("Add image failed", e);
    }
  };

  // ---- moves ----
  const moveLayerBy = (id: string, dir: 1 | -1, say = false) => {
    const i = layerIndex(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= layers.length) return;
    actions.moveLayer(id, j);
    if (say) setAnnounce(`Moved layer ${layers[i].name} ${dir > 0 ? "up. It now sews later" : "down. It now sews earlier"}.`);
  };
  /** Move one shape within its layer: up = sews later. Returns false at the edge. */
  const moveObjectBy = (id: string, dir: 1 | -1, say = false): boolean => {
    const i = idxOf.get(id);
    if (i === undefined) return false;
    const mine = design.objects[i].layerId;
    const j = i + dir;
    if (j < 0 || j >= design.objects.length || design.objects[j].layerId !== mine) return false;
    actions.moveObjectBlock([i], dir > 0 ? i + 2 : i - 1);
    if (say) setAnnounce(`Moved ${design.objects[i].name} ${dir > 0 ? "up. It now sews later" : "down. It now sews earlier"}.`);
    return true;
  };
  const moveImageBy = (id: string, dir: 1 | -1, say = false): boolean => {
    const list = design.images ?? [];
    const i = list.findIndex((m) => m.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length || list[j].layerId !== list[i].layerId) return false;
    actions.moveRefImage(id, dir);
    if (say) setAnnounce(`Moved ${list[i].name} ${dir > 0 ? "up. It draws over the one below" : "down"}.`);
    return true;
  };

  // ---- drop targets ----
  const half = (e: React.DragEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return (e.clientY || 0) > rect.top + rect.height / 2; // true: lower half
  };
  const overObject = (e: React.DragEvent, o: DesignObject) => {
    if (drag?.kind !== "object") return;
    e.preventDefault();
    e.stopPropagation();
    // in the list the top half is "after" in sew order (sews later)
    setMark({ kind: "object", id: o.id, after: !half(e) });
  };
  const dropOnObject = (e: React.DragEvent, o: DesignObject) => {
    if (drag?.kind !== "object" || !o.layerId) return;
    e.preventDefault();
    e.stopPropagation();
    const sewsLater = !half(e);
    const members = objectsIn(o.layerId);
    const pos = members.indexOf(idxOf.get(o.id)!);
    const before = sewsLater ? design.objects[members[pos + 1]]?.id ?? null : o.id;
    // dragging a shape within the selection moves the whole selection
    const ids = selectedIds.includes(drag.id) ? selectedIds : [drag.id];
    actions.moveObjectsToLayer(ids, o.layerId, before);
    endDrag();
  };
  const overImage = (e: React.DragEvent, m: DesignImage) => {
    if (drag?.kind !== "image") return;
    e.preventDefault();
    e.stopPropagation();
    setMark({ kind: "image", id: m.id, after: !half(e) });
  };
  const dropOnImage = (e: React.DragEvent, m: DesignImage) => {
    if (drag?.kind !== "image" || !m.layerId) return;
    e.preventDefault();
    e.stopPropagation();
    const members = imagesIn(m.layerId);
    const pos = members.findIndex((x) => x.id === m.id);
    const before = !half(e) ? (members[pos + 1]?.id ?? null) : m.id;
    actions.moveImageToLayer(drag.id, m.layerId, before);
    endDrag();
  };
  const overLayer = (e: React.DragEvent, l: Layer) => {
    if (!drag) return;
    if (drag.kind === "layer") {
      if (drag.id === l.id) return;
      e.preventDefault();
      setMark({ kind: "layer", id: l.id, where: half(e) ? "below" : "above" });
    } else if ((drag.kind === "object" && l.kind === "stitch") || (drag.kind === "image" && l.kind === "picture")) {
      e.preventDefault();
      setMark({ kind: "layer", id: l.id, where: "into" });
    }
  };
  const dropOnLayer = (e: React.DragEvent, l: Layer) => {
    if (!drag) return;
    e.preventDefault();
    if (drag.kind === "layer" && drag.id !== l.id) {
      const from = layerIndex(drag.id);
      const at = layerIndex(l.id);
      const below = half(e);
      // list order is top first, so "above" in the list is a higher index
      const target = below ? at : at + 1;
      actions.moveLayer(drag.id, from < target ? target - 1 : target);
    } else if (drag.kind === "object" && l.kind === "stitch") {
      actions.moveObjectsToLayer(selectedIds.includes(drag.id) ? selectedIds : [drag.id], l.id, null);
    } else if (drag.kind === "image" && l.kind === "picture") {
      actions.moveImageToLayer(drag.id, l.id, null);
    }
    endDrag();
  };

  // ---- keyboard ----
  const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, select, textarea, button")) return;
    const items = [...(treeRef.current?.querySelectorAll<HTMLElement>("[role=treeitem][data-key]") ?? [])];
    const cur = t.closest<HTMLElement>("[role=treeitem][data-key]");
    if (!cur) return;
    const key = cur.dataset.key!;
    const at = items.indexOf(cur);
    const [type, ...rest] = key.split(":");
    const id = rest.join(":");
    const focusItem = (el?: HTMLElement) => {
      if (!el) return;
      el.focus();
      setFocusKey(el.dataset.key ?? null);
    };
    const stop = () => (e.preventDefault(), e.stopPropagation());

    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      stop();
      const dir = e.key === "ArrowUp" ? 1 : -1; // up the list = sews later
      refocus.current = key;
      if (type === "layer") moveLayerBy(id, dir, true);
      else if (type === "obj") moveObjectBy(id, dir, true);
      else if (type === "img") moveImageBy(id, dir, true);
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        stop();
        focusItem(items[at + 1]);
        break;
      case "ArrowUp":
        stop();
        focusItem(items[at - 1]);
        break;
      case "Home":
        stop();
        focusItem(items[0]);
        break;
      case "End":
        stop();
        focusItem(items[items.length - 1]);
        break;
      case "ArrowRight":
        if (type === "layer") {
          stop();
          if (collapsed.has(id)) setCollapsed(toggle(collapsed, id));
          else focusItem(items[at + 1]?.getAttribute("aria-level") === "2" ? items[at + 1] : undefined);
        }
        break;
      case "ArrowLeft":
        stop();
        if (type === "layer") {
          if (!collapsed.has(id)) setCollapsed(toggle(collapsed, id));
        } else {
          for (let k = at - 1; k >= 0; k--) if (items[k].getAttribute("aria-level") === "1") return focusItem(items[k]);
        }
        break;
      case " ":
        stop();
        if (type === "layer") {
          const l = layers.find((x) => x.id === id);
          if (l) actions.setLayerVisible(id, !l.visible);
        } else if (type === "obj") {
          const o = design.objects.find((x) => x.id === id);
          if (o) actions.toggleObject(id, o.visible === false);
        } else if (type === "img") {
          const m = state.refImages.find((x) => x.id === id);
          if (m) actions.updateRefImage(id, { visible: !m.visible });
        }
        break;
      case "Enter":
        stop();
        if (type === "layer") actions.setActiveLayer(id);
        else if (type === "obj") actions.select(id);
        else if (type === "img") actions.selectRefImage(id);
        break;
      case "l":
      case "L":
        if (e.metaKey || e.ctrlKey) return;
        stop();
        if (type === "layer") {
          const l = layers.find((x) => x.id === id);
          if (l) actions.setLayerLocked(id, !l.locked);
        }
        break;
      case "F2":
        stop();
        if (type === "layer" || type === "obj") setRenaming(key);
        break;
    }
  };

  const tabIndexFor = (key: string, first: boolean) => (focusKey === key || (focusKey === null && first) ? 0 : -1);

  // ---- rows ----
  const renderObjectRow = (i: number, thread: string | undefined, lockedLayer: boolean, hiddenLayer: boolean) => {
    const o = design.objects[i];
    const hidden = o.visible === false;
    const key = rowKey.object(o.id);
    const members = objectsIn(o.layerId ?? "");
    const isLast = members[members.length - 1] === i;
    const isFirst = members[0] === i;
    const num = order.numbers.get(o.id);
    const m = mark?.kind === "object" && mark.id === o.id ? mark : null;
    return (
      <li
        key={o.id}
        role="treeitem"
        data-key={key}
        aria-level={2}
        tabIndex={tabIndexFor(key, false)}
        onFocus={(e) => e.target === e.currentTarget && setFocusKey(key)}
        className={`seq-row${selectedIds.includes(o.id) ? " selected" : ""}${hidden || hiddenLayer ? " hidden" : ""}${lockedLayer ? " layer-locked" : ""}${m ? (m.after ? " drop-before" : " drop-after") : ""}`}
        draggable={!lockedLayer}
        aria-selected={selectedIds.includes(o.id)}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", `object:${o.id}`);
          setDrag({ kind: "object", id: o.id });
        }}
        onDragEnd={endDrag}
        onDragOver={(e) => overObject(e, o)}
        onDrop={(e) => dropOnObject(e, o)}
        onClick={(e) => {
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            actions.setSelection(selectedIds.includes(o.id) ? selectedIds.filter((x) => x !== o.id) : [...selectedIds, o.id]);
          } else if (selectedIds.length === 1 && selectedId === o.id) actions.select(null);
          else actions.select(o.id);
        }}
      >
        <span className="seq-num" title="Sew order: this is the number it sews at">
          {num ?? "–"}
        </span>
        <span className="swatch small" style={{ background: thread }} aria-hidden="true" />
        <EditableText value={o.name} label={o.name} editing={renaming === key} onStart={() => setRenaming(key)} onDone={(n) => (setRenaming(null), n && actions.rename(o.id, n))} />
        <span className="seq-kind">{KIND_LABEL[o.kind]}</span>
        <span className="seq-count" title="stitches">
          {(counts.get(i) ?? 0).toLocaleString()}
        </span>
        <button
          tabIndex={-1}
          className={`icon${open.has(o.id) ? " on" : ""}`}
          aria-label={`Details for ${o.name}`}
          aria-expanded={open.has(o.id)}
          title="Stitch and point counts"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(toggle(open, o.id));
          }}
        >
          ⚙
        </button>
        <button
          tabIndex={-1}
          className="icon"
          aria-label={`Move ${o.name} up`}
          title="Sew later"
          disabled={isLast}
          onClick={(e) => {
            e.stopPropagation();
            moveObjectBy(o.id, 1);
          }}
        >
          ▲
        </button>
        <button
          tabIndex={-1}
          className="icon"
          aria-label={`Move ${o.name} down`}
          title="Sew earlier"
          disabled={isFirst}
          onClick={(e) => {
            e.stopPropagation();
            moveObjectBy(o.id, -1);
          }}
        >
          ▼
        </button>
        <button
          tabIndex={-1}
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
        {open.has(o.id) && <RowDetails o={o} index={i} stitches={counts.get(i) ?? 0} sew={num} />}
      </li>
    );
  };

  const renderTextRow = (indices: number[], thread: string | undefined, hiddenLayer: boolean) => {
    const objs = indices.map((i) => design.objects[i]);
    const group = objs[0].sourceText!.group;
    const block = design.textBlocks?.find((b) => b.id === group);
    const label = block ? `Text: ${block.text.replace(/\s+/g, " ").trim().slice(0, 24)}` : `Text: ${group}`;
    const total = indices.reduce((n, i) => n + (counts.get(i) ?? 0), 0);
    const selected = objs.every((o) => selectedIds.includes(o.id));
    const hidden = objs.every((o) => o.visible === false);
    const isOpen = open.has(`text:${group}`);
    const key = rowKey.text(`${group}:${indices[0]}`);
    const first = order.numbers.get(objs[0].id);
    return (
      <li
        key={`text-${group}-${indices[0]}`}
        role="treeitem"
        data-key={key}
        aria-level={2}
        tabIndex={tabIndexFor(key, false)}
        onFocus={(e) => e.target === e.currentTarget && setFocusKey(key)}
        aria-expanded={isOpen}
        className={`seq-row text-row${selected ? " selected" : ""}${hidden || hiddenLayer ? " hidden" : ""}`}
        aria-selected={selected}
        onClick={() => actions.setSelection(selected ? [] : objs.map((o) => o.id))}
      >
        <span className="seq-num" title="Sew order: this is the number it sews at">
          {first ?? "–"}
        </span>
        <button tabIndex={-1} className="icon" aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${label}`} onClick={(e) => (e.stopPropagation(), setOpen(toggle(open, `text:${group}`)))}>
          {isOpen ? "▾" : "▸"}
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
          tabIndex={-1}
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
        {isOpen && (
          <ul className="text-letters" role="group">
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
  };

  const renderStitchChildren = (l: Layer) => {
    const members = objectsIn(l.id);
    // colour blocks inside the layer, shown last-sewn first like the layers
    const groups = groupObjects(members.map((i) => design.objects[i])).map((g) => ({ threadId: g.threadId, indices: g.indices.map((k) => members[k]) }));
    const out: React.ReactNode[] = [];
    [...groups].reverse().forEach((group, gi, all) => {
      const gIdx = groups.length - 1 - gi;
      const t = threadOf.get(group.threadId);
      const objs = group.indices.map((i) => design.objects[i]);
      const allHidden = objs.every((o) => o.visible === false);
      const later = groups[gIdx + 1]; // the block that sews after this one
      const earlier = groups[gIdx - 1];
      out.push(
        <li key={`g-${l.id}-${group.indices[0]}`} role="presentation" className="seq-group-head" aria-label={`${t?.name ?? "colour"} block`}>
          <span className="swatch" style={{ background: t?.hex }} aria-hidden="true" />
          <span className="seq-name">
            <strong>{t ? `${t.brand} ${t.code}` : "?"}</strong> {t?.name}
          </span>
          <button
            tabIndex={-1}
            className="icon"
            aria-label={`Move ${t?.name ?? "colour"} block up`}
            title="Sew this colour block later"
            disabled={!later}
            onClick={() => actions.moveObjectBlock(group.indices, later.indices[later.indices.length - 1] + 1)}
          >
            ▲
          </button>
          <button
            tabIndex={-1}
            className="icon"
            aria-label={`Move ${t?.name ?? "colour"} block down`}
            title="Sew this colour block earlier"
            disabled={!earlier}
            onClick={() => actions.moveObjectBlock(group.indices, earlier.indices[0])}
          >
            ▼
          </button>
          <button
            tabIndex={-1}
            className={`icon${allHidden ? " off" : ""}`}
            aria-label={`${allHidden ? "Show" : "Hide"} ${t?.name ?? "colour"} block`}
            aria-pressed={!allHidden}
            onClick={() => actions.updateObjects(objs.map((o) => o.id), allHidden ? "Show colour block" : "Hide colour block", (o) => void (o.visible = allHidden))}
          >
            {allHidden ? "◌" : "●"}
          </button>
        </li>,
      );
      void all;
      [...clusterText(group.indices, design.objects)].reverse().forEach((cl) => {
        if (cl.length > 1 || design.objects[cl[0]].sourceText) out.push(renderTextRow(cl, t?.hex, !l.visible));
        else out.push(renderObjectRow(cl[0], t?.hex, l.locked, !l.visible));
      });
    });
    return out;
  };

  const renderImageRow = (m: DesignImage, l: Layer) => {
    const ref = state.refImages.find((r) => r.id === m.id);
    const key = rowKey.image(m.id);
    const sel = state.selectedImageId === m.id;
    const mk = mark?.kind === "image" && mark.id === m.id ? mark : null;
    const list = imagesIn(l.id);
    const pos = list.findIndex((x) => x.id === m.id);
    return (
      <li
        key={m.id}
        role="treeitem"
        data-key={key}
        aria-level={2}
        tabIndex={tabIndexFor(key, false)}
        onFocus={(e) => e.target === e.currentTarget && setFocusKey(key)}
        className={`seq-row image-item${sel ? " selected" : ""}${!m.visible || !l.visible ? " hidden" : ""}${mk ? (mk.after ? " drop-before" : " drop-after") : ""}`}
        aria-selected={sel}
        draggable={!l.locked}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", `image:${m.id}`);
          setDrag({ kind: "image", id: m.id });
        }}
        onDragEnd={endDrag}
        onDragOver={(e) => overImage(e, m)}
        onDrop={(e) => dropOnImage(e, m)}
        onClick={() => actions.selectRefImage(sel ? null : m.id)}
      >
        <span className="seq-num" aria-hidden="true">
          ▣
        </span>
        <span className="seq-name" title={m.name}>
          {m.name}
        </span>
        <span className="seq-kind">Picture</span>
        <button tabIndex={-1} className="icon" aria-label={`Move picture ${m.name} up`} title="Draw over the one below" disabled={pos === list.length - 1} onClick={(e) => (e.stopPropagation(), moveImageBy(m.id, 1))}>
          ▲
        </button>
        <button tabIndex={-1} className="icon" aria-label={`Move picture ${m.name} down`} title="Draw under the one above" disabled={pos === 0} onClick={(e) => (e.stopPropagation(), moveImageBy(m.id, -1))}>
          ▼
        </button>
        <button
          tabIndex={-1}
          className={`icon${m.visible ? "" : " off"}`}
          aria-label={`${m.visible ? "Hide" : "Show"} picture ${m.name}`}
          aria-pressed={m.visible}
          onClick={(e) => (e.stopPropagation(), actions.updateRefImage(m.id, { visible: !m.visible }))}
        >
          {m.visible ? "●" : "◌"}
        </button>
        {ref ? null : <span className="muted small"> (missing)</span>}
      </li>
    );
  };

  const first = top[0]?.id;
  const delTarget = layers.find((l) => l.id === confirmDelete) ?? null;
  const stitchLayers = layers.filter((l) => l.kind === "stitch").length;
  const canDelete = !!active && !(active.kind === "stitch" && stitchLayers <= 1 && sizeOf(active) === 0);
  const activeAt = active ? layerIndex(active.id) : -1;
  const canMerge = !!active && activeAt > 0 && layers[activeAt - 1].kind === active.kind;
  const stitches = design.objects.length;
  const blocks = top.reduce((n, l) => n + (l.kind === "stitch" ? groupObjects(objectsIn(l.id).map((i) => design.objects[i])).length : 0), 0);

  return (
    <div className="layers">
      <p className="layers-banner" role="note">
        Bottom sews first. Top sews last and sits on top.
      </p>
      <p className="muted small">
        {stitches} objects · {blocks} colour block{blocks === 1 ? "" : "s"}. Drag to reorder, or press Alt and an arrow key.
      </p>
      <div className="hint-strip" aria-label="Layers help">
        <span>
          Views <Hint id="seq.tabs" />
        </span>
        <span>
          Order <Hint id="seq.move" />
        </span>
        <span>
          Hide <Hint id="seq.hide" />
        </span>
        <span>
          Lock <Hint id="layers.lock" />
        </span>
        <span>
          Rename <Hint id="seq.rename" />
        </span>
        <span>
          Details <Hint id="seq.details" />
        </span>
      </div>
      <div className="layer-tools" role="toolbar" aria-label="Layer actions">
        <button onClick={() => actions.addLayer("stitch")} title="Add an empty layer for stitches above the selected one">
          New stitch layer
        </button>
        <button onClick={() => actions.addLayer("picture")} title="Add an empty layer for pictures above the selected one">
          New picture layer
        </button>
        <button onClick={() => void addImage()} title="Add a picture to the selected picture layer. Pictures are not stitched.">
          Add image…
        </button>
        <button
          disabled={!canDelete}
          title="Delete the selected layer"
          onClick={() => {
            if (!active) return;
            if (sizeOf(active) === 0) actions.deleteLayer(active.id);
            else setConfirmDelete(active.id);
          }}
        >
          Delete layer
        </button>
        <button disabled={!canMerge} title="Fold the selected layer into the one below it. The sew order stays the same." onClick={() => active && actions.mergeLayerDown(active.id)}>
          Merge down
        </button>
        <Hint id="layers.merge" />
      </div>
      {delTarget && (
        <div className="layer-confirm" role="alertdialog" aria-label="Delete layer?">
          <p className="small">
            Delete <strong>{delTarget.name}</strong> and the {sizeOf(delTarget)} {delTarget.kind === "stitch" ? "shape" : "picture"}
            {sizeOf(delTarget) === 1 ? "" : "s"} in it? You can undo this.
          </p>
          <button className="primary" autoFocus onClick={() => (actions.deleteLayer(delTarget.id), setConfirmDelete(null))}>
            Delete
          </button>
          <button onClick={() => setConfirmDelete(null)}>Keep it</button>
        </div>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      <ul ref={treeRef} className="seq layer-tree" role="tree" aria-label="Layers, top sews last" onKeyDown={onKeyDown} onDragLeave={() => setMark(null)}>
        {top.map((l) => {
          const isCollapsed = collapsed.has(l.id);
          const key = rowKey.layer(l.id);
          const mk = mark?.kind === "layer" && mark.id === l.id ? mark.where : null;
          const range = order.ranges.get(l.id) ?? null;
          const i = layerIndex(l.id);
          const isActive = l.id === activeId;
          return (
            <li
              key={l.id}
              role="treeitem"
              data-key={key}
              aria-level={1}
              aria-expanded={!isCollapsed}
              aria-selected={isActive}
              aria-label={`${l.kind === "stitch" ? "Stitch" : "Picture"} layer ${l.name}`}
              tabIndex={tabIndexFor(key, l.id === first)}
              onFocus={(e) => e.target === e.currentTarget && setFocusKey(key)}
              className={`seq-group layer${l.visible ? "" : " layer-hidden"}${l.locked ? " layer-locked" : ""}`}
            >
              <div
                className={`seq-group-head layer-head${isActive ? " active" : ""}${mk === "above" ? " drop-before" : mk === "below" ? " drop-after" : mk === "into" ? " drop-into" : ""}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", `layer:${l.id}`);
                  setDrag({ kind: "layer", id: l.id });
                }}
                onDragEnd={endDrag}
                onDragOver={(e) => overLayer(e, l)}
                onDrop={(e) => dropOnLayer(e, l)}
                onClick={() => actions.setActiveLayer(l.id)}
              >
                <button
                  tabIndex={-1}
                  className="icon caret"
                  aria-label={`${isCollapsed ? "Expand" : "Collapse"} layer ${l.name}`}
                  aria-expanded={!isCollapsed}
                  onClick={(e) => (e.stopPropagation(), setCollapsed(toggle(collapsed, l.id)))}
                >
                  {isCollapsed ? "▸" : "▾"}
                </button>
                <button
                  tabIndex={-1}
                  className={`icon${l.visible ? "" : " off"}`}
                  aria-label={`${l.visible ? "Hide" : "Show"} layer ${l.name}`}
                  aria-pressed={l.visible}
                  title={l.visible ? "Hide this layer. A hidden stitch layer is not sewn." : "Show this layer"}
                  onClick={(e) => (e.stopPropagation(), actions.setLayerVisible(l.id, !l.visible))}
                >
                  {l.visible ? "●" : "◌"}
                </button>
                <button
                  tabIndex={-1}
                  className={`icon${l.locked ? " on" : ""}`}
                  aria-label={`${l.locked ? "Unlock" : "Lock"} layer ${l.name}`}
                  aria-pressed={l.locked}
                  title={l.locked ? "Locked: nothing in it can be picked or changed" : "Lock this layer"}
                  onClick={(e) => (e.stopPropagation(), actions.setLayerLocked(l.id, !l.locked))}
                >
                  {l.locked ? "\u{1F512}" : "\u{1F513}"}
                </button>
                <span className="layer-kind" aria-hidden="true" title={l.kind === "stitch" ? "Stitch layer" : "Picture layer"}>
                  {l.kind === "stitch" ? "≋" : "▣"}
                </span>
                <EditableText value={l.name} label={`layer ${l.name}`} editing={renaming === key} onStart={() => setRenaming(key)} onDone={(n) => (setRenaming(null), n && actions.renameLayer(l.id, n))} />
                <button tabIndex={-1} className="icon" aria-label={`Move layer ${l.name} up`} title="Sew later (on top)" disabled={i === layers.length - 1} onClick={(e) => (e.stopPropagation(), moveLayerBy(l.id, 1))}>
                  ▲
                </button>
                <button tabIndex={-1} className="icon" aria-label={`Move layer ${l.name} down`} title="Sew earlier (underneath)" disabled={i === 0} onClick={(e) => (e.stopPropagation(), moveLayerBy(l.id, -1))}>
                  ▼
                </button>
                <div className="layer-sub">
                <span className="layer-range" title="Where this layer sits in the sew order">
                  {sewRangeText(l, range)}
                </span>

                {l.kind === "picture" && (
                  <label className="layer-opacity" onClick={(e) => e.stopPropagation()}>
                    <span className="sr-only">{l.name} opacity</span>
                    <input
                      type="range"
                      min={0.05}
                      max={1}
                      step={0.05}
                      tabIndex={-1}
                      value={l.opacity ?? 1}
                      aria-label={`${l.name} opacity`}
                      onChange={(e) => actions.setLayerOpacity(l.id, Number(e.target.value))}
                      onPointerUp={actions.endGroup}
                      onKeyUp={actions.endGroup}
                      onBlur={actions.endGroup}
                    />
                    <output>{Math.round((l.opacity ?? 1) * 100)}%</output>
                  </label>
                )}
                </div>
              </div>
              {!isCollapsed && (
                <ul role="group" className="layer-children">
                  {l.kind === "stitch" ? renderStitchChildren(l) : [...imagesIn(l.id)].reverse().map((m) => renderImageRow(m, l))}
                  {sizeOf(l) === 0 && (
                    <li role="none" className="muted small layer-empty">
                      {l.kind === "stitch" ? "Empty. Draw a shape or drag one here." : "Empty. Add an image or drag one here."}
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Per-object numbers behind the gear button. */
function RowDetails({ o, index, stitches, sew }: { o: DesignObject; index: number; stitches: number; sew: number | undefined }) {
  const nodes = editRings(o).reduce((n, r) => n + r.nodes.length, 0);
  const b = objectBox(o);
  return (
    <dl className="row-details" onClick={(e) => e.stopPropagation()} data-testid={`details-${index}`}>
      <dt>Sews at</dt>
      <dd>{sew ?? "not sewn"}</dd>
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
