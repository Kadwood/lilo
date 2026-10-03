import { useSyncExternalStore } from "react";
import type { ShapeMode } from "../state/editorStore";
import { selectionBox } from "../state/editorStore";
import { useEditor } from "../state/store";
import type { CanvasController } from "./controller";
import type { View } from "./viewport";

interface Item {
  id: string;
  label: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  run: () => void;
}

/** The contextual toolbar that floats above the selection: shape actions for whatever is selected. */
export function ShapeBar({ controller, view, width, height }: { controller: CanvasController; view: View; width: number; height: number }) {
  const { state, actions } = useEditor();
  const model = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { design, selectedIds, mode, tool } = state;
  const objs = design ? design.objects.filter((o) => selectedIds.includes(o.id)) : [];
  const box = selectionBox(design, selectedIds);
  if (!box || objs.length === 0 || tool !== "select" || model.drag || model.draft) return null;

  const single = objs.length === 1 ? objs[0] : null;
  const allLocked = objs.every((o) => o.locked);
  const mode_ = (m: ShapeMode) => () => actions.setMode(mode === m ? "none" : m);
  const closedish = objs.every((o) => o.kind === "fill" || (o.kind === "run" && o.geometry.closed && o.params.type !== "manual"));
  const hasPathAndShape = objs.some((o) => o.kind === "run" && !o.geometry.closed) && objs.length > 1;

  const items: Item[] = [
    { id: "reshape", label: "Reshape", title: "Move, add and delete points. Double-click a point to toggle curve. (Double-click a shape to start)", active: mode === "reshape", disabled: !single || allLocked, run: mode_("reshape") },
    { id: "hole", label: "Cut hole", title: "Draw a closed shape inside the fill to cut it out as a hole.", active: mode === "hole", disabled: !single || single.kind !== "fill" || allLocked, run: mode_("hole") },
    { id: "knife", label: "Knife", title: "Drag a line across the shape to slice it in two.", active: mode === "knife", disabled: allLocked, run: mode_("knife") },
    { id: "start", label: "Start", title: "Click on the canvas to choose where sewing starts. Drag the green marker to adjust.", active: mode === "setStart", disabled: !single || allLocked, run: mode_("setStart") },
    { id: "end", label: "End", title: "Click on the canvas to choose where sewing ends. Drag the red marker to adjust.", active: mode === "setEnd", disabled: !single || allLocked, run: mode_("setEnd") },
    { id: "angle", label: "Angle", title: "Edit the stitch angle with a dial on the canvas.", active: mode === "angle", disabled: !objs.some((o) => o.kind === "fill") || allLocked, run: mode_("angle") },
    { id: "map", label: hasPathAndShape ? "Map to path" : "Map…", title: "Repeat the selection along an open path (P). Select the shapes and an open line together, or choose a path afterwards.", disabled: allLocked, run: () => actions.openMapDraft() },
    { id: "convert", label: closedish && objs[0].kind === "fill" ? "Outline" : "Fill", title: "Convert between an outlined shape and a filled one.", disabled: !closedish || allLocked, run: actions.convertSelectionOutline },
    { id: "redwork", label: "Redwork", title: "Add an outline run along every edge of the selection, routed to keep jumps short.", disabled: allLocked, run: actions.redworkSelection },
    { id: "lock", label: allLocked ? "Unlock" : "Lock", title: "Lock the selection so it can't be moved or edited.", active: allLocked, run: actions.toggleLockSelection },
    { id: "dup", label: "Duplicate", title: "Duplicate (⌘D)", run: actions.duplicateSelection },
    { id: "del", label: "Delete", title: "Delete (Backspace)", disabled: allLocked, run: actions.deleteSelection },
  ];

  const cx = view.x + ((box.minX + box.maxX) / 2) * view.zoom;
  const top = view.y + box.minY * view.zoom - 46 - 30;
  const left = Math.max(8, Math.min(width - 8, cx));
  const style = { left, top: Math.max(8, Math.min(height - 60, top < 8 ? view.y + box.maxY * view.zoom + 44 : top)) };

  return (
    <div className="shape-bar" role="toolbar" aria-label="Shape actions" style={style}>
      {items.map((it) => (
        <button key={it.id} className={it.active ? "active" : ""} aria-pressed={it.active} title={it.title} disabled={it.disabled} onClick={it.run} data-action={it.id}>
          {it.label}
        </button>
      ))}
    </div>
  );
}
