import { useMemo } from "react";
import {
  designBounds,
  ensureThread,
  getCatalogue,
  objectBox,
  toDesignThread,
  transformObject,
  translation,
  unionBox,
  type Design,
  type DesignObject,
  type Pt,
  type TextBlock,
  type Thread,
} from "@lilo/engine/light";
import { useEditor } from "../state/store";
import { nextTextGroup, singleTextGroup } from "../state/textGroups";
import type { LayoutResponse } from "./fonts";

export { nextTextGroup };

/**
 * THE integration point between lettering and the editor store. Text is inserted and re-laid out
 * through the store's `commit()`, so every change is one undo step, and text objects are ordinary
 * design objects (they select, move, resize and rotate like any other).
 */

/** The thread new text is sewn in: the active drawing thread, else the design's last, else Black. */
export function textThread(design: Design | null, preferred?: string | null): Thread {
  const pick = preferred ? design?.threads.find((t) => t.id === preferred) : undefined;
  if (pick) return pick;
  const last = design?.threads[design.threads.length - 1];
  if (last) return last;
  const t = getCatalogue().threads;
  return toDesignThread(t.find((x) => x.name === "Black") ?? t[0]);
}

const shifted = (objs: DesignObject[], dx: number, dy: number): DesignObject[] => objs.map((o) => transformObject(o, translation(dx, dy)));

/**
 * Add a laid-out block to `d` (mutates: call inside a commit recipe). The text is centred on
 * `anchor`, else on the existing design, else on 0,0. Returns the new object ids.
 */
export function placeText(d: Design, layout: LayoutResponse, block: Omit<TextBlock, "origin">, thread: Thread, anchor: Pt | null): string[] {
  const b = d.objects.length ? designBounds(d) : null;
  const target: Pt = anchor ?? (b ? [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] : [0, 0]);
  const dx = target[0] - layout.centre[0];
  const dy = target[1] - layout.centre[1];
  ensureThread(d, thread);
  const objs = shifted(layout.objects, dx, dy);
  d.objects.push(...objs);
  d.textBlocks = [...(d.textBlocks ?? []), { ...block, origin: [dx, dy] }];
  return objs.map((o) => o.id);
}

/**
 * Re-lay out an existing block in place (mutates): the new letters are centred where the old ones
 * were (so moves survive), take the old position in the sewing order and keep the old thread.
 * Returns the new object ids.
 */
export function replaceText(d: Design, group: string, layout: LayoutResponse, block: Omit<TextBlock, "origin">): string[] {
  const old = d.objects.filter((o) => o.sourceText?.group === group);
  const box = unionBox(old.map(objectBox));
  const at: Pt = box ? [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2] : layout.centre;
  const dx = at[0] - layout.centre[0];
  const dy = at[1] - layout.centre[1];
  const threadId = old[0]?.threadId;
  const objs = shifted(layout.objects, dx, dy).map((o) => (threadId ? { ...o, threadId } : o));
  const first = d.objects.findIndex((o) => o.sourceText?.group === group);
  const rest = d.objects.filter((o) => o.sourceText?.group !== group);
  rest.splice(first < 0 ? rest.length : first, 0, ...objs);
  d.objects = rest;
  const blocks = d.textBlocks ?? [];
  const i = blocks.findIndex((b) => b.id === group);
  const next = { ...block, origin: [dx, dy] as Pt };
  d.textBlocks = i >= 0 ? blocks.map((b, k) => (k === i ? next : b)) : [...blocks, next];
  return objs.map((o) => o.id);
}

/** What the Text panel needs from the store. */
export function useTextTarget() {
  const { state, actions } = useEditor();
  const { design, selectedIds, textAnchor } = state;
  const selected = useMemo(() => (design ? design.objects.filter((o) => selectedIds.includes(o.id)) : []), [design, selectedIds]);
  const group = singleTextGroup(selected);
  const block = group ? (design?.textBlocks?.find((b) => b.id === group) ?? null) : null;
  return {
    design,
    anchor: textAnchor,
    /** The text block being edited, when the selection is one word. */
    editing: block,
    threadId: state.threadId,
    insert(layout: LayoutResponse, b: Omit<TextBlock, "origin">, thread: Thread) {
      let ids: string[] = [];
      actions.commit("Add text", (d) => void (ids = placeText(d, layout, b, thread, textAnchor)), { select: () => ids });
      actions.setTextAnchor(null);
      actions.setTool("select");
    },
    replace(g: string, layout: LayoutResponse, b: Omit<TextBlock, "origin">) {
      let ids: string[] = [];
      actions.commit("Edit text", (d) => void (ids = replaceText(d, g, layout, b)), { select: () => ids });
    },
    /** Leave edit mode to type new text. */
    startNew() {
      actions.setSelection([]);
      actions.setTool("text");
    },
    actions,
  };
}
