import { minLetterHeightFor, objectBox, type Design, type DesignObject, type Hoop } from "@lilo/engine/light";
import { pickFor } from "../hoops/autoPick";
import { rememberHoop } from "../state/hoopStore";
import { setHoopView } from "../state/hoopViewStore";
import type { EditorActions, EditorState } from "../state/editorStore";
import { LIVE_HINTS, type LiveHint } from "./data";

/**
 * Live warnings: real engine signals turned into the notes in `docs/guide/live-hints.json`. `liveFindings`
 * is pure (state in, findings out) so it is easy to test; `applyLiveFix` runs a note's one-click fix.
 */

export interface LiveFinding {
  hint: LiveHint;
  /** Changes when the problem changes, so a dismissed note comes back for a different problem. */
  key: string;
  /** Objects the fix would touch (tiny shapes, wide satin columns). */
  objectIds: string[];
}

const SATIN_DEFAULT_RUN_WIDTH = 2.5;

/** A satin column wider than `maxMm` that has no split turned on. */
export function wideSatin(design: Design, maxMm: number): DesignObject[] {
  const out: DesignObject[] = [];
  for (const o of design.objects) {
    if (o.visible === false) continue;
    if (o.kind === "satin") {
      if ((o.params.widthMm ?? 0) > maxMm && !((o.params.splitMaxWidthMm ?? 0) > 0)) out.push(o);
    } else if (o.kind === "run" && o.params.type === "satin") {
      const w = o.params.widthMm ?? SATIN_DEFAULT_RUN_WIDTH;
      if (w > maxMm && !((o.params.satin?.splitMaxWidthMm ?? 0) > 0)) out.push(o);
    }
  }
  return out;
}

/** Filled shapes whose narrowest side is under `minMm`. Text is left alone (lettering has its own checks). */
export function tinyFills(design: Design, minMm: number): DesignObject[] {
  return design.objects.filter((o) => {
    if (o.kind !== "fill" || o.visible === false || o.sourceText) return false;
    const b = objectBox(o);
    return !!b && Math.min(b.maxX - b.minX, b.maxY - b.minY) < minMm;
  });
}

/** Text blocks shorter than the thread allows. */
export function smallLetters(design: Design): { id: string; heightMm: number }[] {
  const min = minLetterHeightFor(design.sewing?.threadWeight);
  return (design.textBlocks ?? []).filter((b) => b.heightMm < min - 1e-6).map((b) => ({ id: b.id, heightMm: b.heightMm }));
}

export function liveFindings(state: Pick<EditorState, "design" | "planResult">, hints: readonly LiveHint[] = LIVE_HINTS): LiveFinding[] {
  const { design, planResult } = state;
  if (!design || design.objects.length === 0) return [];
  const out: LiveFinding[] = [];
  const warn = (code: string) => planResult?.warnings.find((w) => w.code === code);
  for (const hint of hints) {
    const t = hint.threshold ?? 0;
    let key: string | null = null;
    let objectIds: string[] = [];
    switch (hint.signal) {
      case "plan:outside-hoop":
      case "plan:density":
      case "plan:stitch-too-long":
      case "plan:thin-satin":
      case "plan:long-stitch-snag":
      case "plan:object-failed": {
        const w = warn(hint.signal.slice("plan:".length));
        if (w) key = w.message;
        break;
      }
      case "colour-changes":
        if (planResult && planResult.stats.colorChanges > t) key = String(planResult.stats.colorChanges);
        break;
      case "stitch-count":
        if (planResult && planResult.stats.stitchCount > t) key = String(Math.round(planResult.stats.stitchCount / 1000));
        break;
      case "sewing-time":
        if (planResult && planResult.stats.estimatedSeconds / 60 > t) key = String(Math.round(planResult.stats.estimatedSeconds / 600));
        break;
      case "tiny-region": {
        const tiny = tinyFills(design, t);
        if (tiny.length) (key = String(tiny.length)), (objectIds = tiny.map((o) => o.id));
        break;
      }
      case "satin-too-wide": {
        const wide = wideSatin(design, t);
        if (wide.length) (key = String(wide.length)), (objectIds = wide.map((o) => o.id));
        break;
      }
      case "letters-small": {
        const small = smallLetters(design);
        if (small.length) key = small.map((s) => `${s.id}:${s.heightMm}`).join(",");
        break;
      }
    }
    if (key !== null) out.push({ hint, key: `${hint.id}|${key}`, objectIds });
  }
  return out;
}

/** The fix button is hidden when it would change nothing (already on 60 wt, say). */
export function fixApplies(f: LiveFinding, design: Design | null): boolean {
  if (!f.hint.fix || !design) return false;
  if (f.hint.fix.action === "set-60wt") return (design.sewing?.threadWeight ?? 40) !== 60;
  return true;
}

export interface FixContext {
  state: EditorState;
  actions: EditorActions;
  hoop: Hoop;
  customHoops: readonly Hoop[];
}

const LOOSEN = 1.15;

/** Run a note's fix. Returns a short plain-words result for the screen reader and the note. */
export function applyLiveFix(f: LiveFinding, ctx: FixContext): string {
  const { actions, state } = ctx;
  const design = state.design;
  if (!design || !f.hint.fix) return "";
  switch (f.hint.fix.action) {
    case "smallest-hoop": {
      const r = pickFor(design, ctx.hoop, ctx.customHoops);
      if (r && r.kind === "fit") {
        actions.setHoop(r.hoop);
        rememberHoop(r.hoop);
        return `Hoop changed to ${r.hoop.name}.`;
      }
      setHoopView({ pickerOpen: true });
      return "No saved hoop is big enough. Choose or add a bigger one.";
    }
    case "group-by-colour":
      actions.groupByColour();
      return "Shapes grouped by colour.";
    case "set-60wt":
      actions.setSewing({ threadWeight: 60 });
      return "Thread weight set to 60 wt.";
    case "enable-split":
      actions.updateObjects(
        f.objectIds,
        "Split satin",
        (o) => {
          if (o.kind === "satin") o.params.splitMaxWidthMm = 5;
          else if (o.kind === "run") o.params.satin = { ...o.params.satin, splitMaxWidthMm: 5 };
        },
      );
      return "Wide satin columns now split above 5 mm.";
    case "loosen-spacing":
      actions.updateObjects(
        design.objects.map((o) => o.id),
        "Loosen spacing",
        (o) => {
          if (o.kind === "fill") o.params.rowSpacingMm = Math.min(2, Math.round(o.params.rowSpacingMm * LOOSEN * 100) / 100);
          else if (o.kind === "satin") o.params.densityMm = Math.min(1.5, Math.round(o.params.densityMm * LOOSEN * 100) / 100);
          else if (o.kind === "run" && o.params.type === "satin" && o.params.satin?.densityMm) o.params.satin = { ...o.params.satin, densityMm: Math.min(1.5, Math.round(o.params.satin.densityMm * LOOSEN * 100) / 100) };
        },
      );
      return "Spacing loosened by 15 percent.";
    case "delete-tiny":
      actions.setSelection(f.objectIds);
      actions.deleteSelection();
      return "Tiny shapes removed.";
    default:
      return "";
  }
}
