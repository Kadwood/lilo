import type { EditorState } from "../state/editorStore";
import type { GuideState } from "./guideStore";

/** What a tour step can look at: the editor, the guide's own state and which screen is showing. */
export interface TourContext {
  editor: Pick<EditorState, "design" | "tool" | "dialog">;
  guide: Pick<GuideState, "played" | "sewingOpen">;
  view: string;
}

/**
 * The conditions a tour step can advance on (the names in `docs/guide/tour.json`; the list is validated
 * by `scripts/guide-lib.mjs`). Each answers "has the user done the thing yet?" from real state.
 */
export const CONDITIONS: Record<string, (c: TourContext) => boolean> = {
  "has-objects": (c) => (c.editor.design?.objects.length ?? 0) > 0,
  "tool:closed": (c) => c.editor.tool === "closed",
  "tool:text": (c) => c.editor.tool === "text",
  "dialog:any": (c) => c.editor.dialog === "send" || c.editor.dialog === "export",
  played: (c) => c.guide.played,
  "view:editor": (c) => c.view === "editor",
  "sewing-open": (c) => c.guide.sewingOpen,
};

export const evalCondition = (cond: string, c: TourContext): boolean => CONDITIONS[cond]?.(c) ?? false;
