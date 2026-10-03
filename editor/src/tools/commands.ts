import { FILL_PATTERNS, HOOPS, patternInfo, type RunType } from "@lilo/engine/light";
import type { EditorActions, EditorState, ShapeMode } from "../state/editorStore";
import { TOOLS } from "./registry";

export interface Command {
  id: string;
  label: string;
  /** Shown on the right, e.g. "⌘Z". */
  shortcut?: string;
  /** Extra search words. */
  keywords?: string;
  group: "Tools" | "Edit" | "Shape" | "Stitch" | "Fill pattern" | "View" | "File";
  enabled: boolean;
  run: () => void;
}

const RUN_TYPE_LABELS: [RunType, string][] = [
  ["single", "Single"],
  ["triple", "Triple"],
  ["satin", "Satin"],
  ["estitch", "E-stitch"],
  ["doublerope", "Double rope"],
  ["triplerope", "Triple rope"],
  ["manual", "Manual"],
];

export interface CommandHost {
  state: EditorState;
  actions: EditorActions;
  /** Open the file picker for an image. */
  openImage: () => void;
  fit: () => void;
}

/** Every action and tool the palette can run. Rebuilt on each open, so `enabled` reflects the selection. */
export function buildCommands({ state, actions, openImage, fit }: CommandHost): Command[] {
  const objs = state.design ? state.design.objects.filter((o) => state.selectedIds.includes(o.id)) : [];
  const has = objs.length > 0;
  const single = objs.length === 1;
  const fills = objs.filter((o) => o.kind === "fill");
  const runs = objs.filter((o) => o.kind === "run");
  const unlocked = has && !objs.every((o) => o.locked);
  const closedish = has && objs.every((o) => o.kind === "fill" || (o.kind === "run" && o.geometry.closed && o.params.type !== "manual"));
  const cmds: Command[] = [];
  const add = (c: Omit<Command, "enabled"> & { enabled?: boolean }) => cmds.push({ enabled: true, ...c });
  const mode = (m: ShapeMode) => () => actions.setMode(state.mode === m ? "none" : m);

  for (const t of TOOLS) {
    add({ id: `tool.${t.id}`, group: "Tools", label: `${t.label} tool`, shortcut: t.key === " " ? "Space" : t.key.toUpperCase(), keywords: "tool draw", enabled: t.enabled, run: () => actions.setTool(t.id) });
  }

  add({ id: "edit.undo", group: "Edit", label: "Undo", shortcut: "⌘Z", enabled: state.canUndo, run: actions.undo });
  add({ id: "edit.redo", group: "Edit", label: "Redo", shortcut: "⇧⌘Z", enabled: state.canRedo, run: actions.redo });
  add({ id: "edit.selectAll", group: "Edit", label: "Select all", shortcut: "⌘A", enabled: (state.design?.objects.length ?? 0) > 0, run: actions.selectAll });
  add({ id: "edit.deselect", group: "Edit", label: "Deselect", shortcut: "Esc", enabled: has, run: () => actions.setSelection([]) });
  add({ id: "edit.duplicate", group: "Edit", label: "Duplicate", shortcut: "⌘D", enabled: has, run: actions.duplicateSelection });
  add({ id: "edit.delete", group: "Edit", label: "Delete", shortcut: "⌫", enabled: unlocked, run: actions.deleteSelection });
  add({ id: "edit.lock", group: "Edit", label: objs.length && objs.every((o) => o.locked) ? "Unlock" : "Lock", keywords: "lock unlock", enabled: has, run: actions.toggleLockSelection });
  add({ id: "edit.flipH", group: "Edit", label: "Flip horizontally", keywords: "mirror", enabled: unlocked, run: () => actions.flipSelection("h") });
  add({ id: "edit.flipV", group: "Edit", label: "Flip vertically", keywords: "mirror", enabled: unlocked, run: () => actions.flipSelection("v") });
  add({ id: "edit.rotate90", group: "Edit", label: "Rotate 90°", enabled: unlocked, run: () => actions.rotateSelection(90) });
  add({ id: "edit.groupColour", group: "Edit", label: "Group objects by colour", keywords: "sequence order thread changes", enabled: (state.design?.objects.length ?? 0) > 1, run: actions.groupByColour });

  add({ id: "shape.reshape", group: "Shape", label: "Reshape points", keywords: "nodes edit", enabled: single && unlocked, run: mode("reshape") });
  add({ id: "shape.hole", group: "Shape", label: "Cut hole", keywords: "subtract", enabled: single && fills.length === 1 && unlocked, run: mode("hole") });
  add({ id: "shape.knife", group: "Shape", label: "Knife: split a shape", keywords: "cut slice", enabled: unlocked, run: mode("knife") });
  add({ id: "shape.start", group: "Shape", label: "Set start point", enabled: single && unlocked, run: mode("setStart") });
  add({ id: "shape.end", group: "Shape", label: "Set end point", enabled: single && unlocked, run: mode("setEnd") });
  add({ id: "shape.angle", group: "Shape", label: "Edit stitch angle", keywords: "dial direction", enabled: fills.length > 0 && unlocked, run: mode("angle") });
  add({ id: "shape.map", group: "Shape", label: "Map to path", shortcut: "P", keywords: "repeat along", enabled: unlocked, run: () => actions.openMapDraft() });
  add({ id: "shape.convert", group: "Shape", label: "Convert outline ↔ fill", keywords: "outlined filled", enabled: closedish && unlocked, run: actions.convertSelectionOutline });
  add({ id: "shape.redwork", group: "Shape", label: "Auto redwork", keywords: "outline edges", enabled: has, run: actions.redworkSelection });

  for (const [id, label] of RUN_TYPE_LABELS) {
    add({
      id: `run.${id}`,
      group: "Stitch",
      label: `Run type: ${label}`,
      keywords: "line stitch",
      enabled: runs.length > 0 && unlocked,
      run: () =>
        actions.updateObjects(
          runs.map((o) => o.id),
          "Run type",
          (o) => {
            if (o.kind === "run") {
              o.params.type = id;
              o.params.repeats = id === "triple" ? 3 : 1;
            }
          },
        ),
    });
  }
  for (const p of FILL_PATTERNS) {
    add({
      id: `fill.${p.id}`,
      group: "Fill pattern",
      label: `Fill pattern: ${p.label}`,
      keywords: `${p.family} ${p.help}`,
      enabled: fills.length > 0 && unlocked,
      run: () =>
        actions.updateObjects(
          fills.map((o) => o.id),
          "Fill pattern",
          (o) => {
            if (o.kind === "fill") {
              o.params.pattern = p.id;
              o.params.angleDeg = patternInfo(p.id).defaultAngleDeg;
              delete o.params.patternParams;
              if (!p.gradient) delete o.params.gradient;
            }
          },
        ),
    });
  }

  add({ id: "view.realistic", group: "View", label: `${state.view.realistic ? "Hide" : "Show"} realistic view`, keywords: "thread shading", run: () => actions.setView({ realistic: !state.view.realistic }) });
  add({ id: "view.grid", group: "View", label: `${state.view.grid ? "Hide" : "Show"} grid`, run: () => actions.setView({ grid: !state.view.grid }) });
  add({ id: "view.reference", group: "View", label: `${state.view.reference ? "Hide" : "Show"} reference images`, run: () => actions.setView({ reference: !state.view.reference }) });
  add({ id: "view.jumps", group: "View", label: `${state.view.jumps ? "Hide" : "Show"} jump stitches`, run: () => actions.setView({ jumps: !state.view.jumps }) });
  add({ id: "view.fit", group: "View", label: "Fit to window", run: fit });
  add({ id: "view.units", group: "View", label: `Units: switch to ${state.units === "mm" ? "inches" : "millimetres"}`, keywords: "mm in cm", run: () => actions.setUnits(state.units === "mm" ? "in" : "mm") });
  for (const h of HOOPS) add({ id: `hoop.${h.name}`, group: "View", label: `Hoop: ${h.name}`, keywords: "nv2700 size", run: () => actions.setHoop(h) });
  add({ id: "view.seq.images", group: "View", label: "Sequencer: reference images", run: () => actions.setSeqTab("images") });
  add({ id: "view.seq.colours", group: "View", label: "Sequencer: colours", run: () => actions.setSeqTab("colours") });
  add({ id: "view.seq.shapes", group: "View", label: "Sequencer: shapes", run: () => actions.setSeqTab("shapes") });

  add({ id: "file.open", group: "File", label: "Open image to auto-digitize…", keywords: "import png jpg svg", run: openImage });
  add({ id: "file.export", group: "File", label: "Export…", keywords: "pes dst jef save", enabled: (state.planResult?.stats.stitchCount ?? 0) > 0, run: () => actions.setDialog("export") });
  add({ id: "file.send", group: "File", label: "Send to machine…", keywords: "brother wifi", enabled: (state.planResult?.stats.stitchCount ?? 0) > 0, run: () => actions.setDialog("send") });
  return cmds;
}

/** Rank commands for a query: every word must appear in the label or keywords; label matches and earlier matches first. */
export function searchCommands(cmds: Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return cmds;
  const scored: { c: Command; score: number }[] = [];
  for (const c of cmds) {
    const label = c.label.toLowerCase();
    const hay = `${label} ${c.group.toLowerCase()} ${c.keywords?.toLowerCase() ?? ""}`;
    let score = 0;
    let ok = true;
    for (const w of words) {
      const at = label.indexOf(w);
      if (at >= 0) score += at === 0 ? 0 : label[at - 1] === " " ? 1 : 3;
      else if (hay.includes(w)) score += 6;
      else {
        ok = false;
        break;
      }
    }
    if (ok) scored.push({ c, score: score + (c.enabled ? 0 : 20) });
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.c);
}
