import { designBounds, emptyDesign, getCatalogue, toDesignThread, type Design, type DesignObject, type TextBlock, type Thread } from "@lilo/engine/light";
import { useEditor } from "../state/store";
import type { LayoutResponse } from "./fonts";

/**
 * THE integration point between lettering and the editor store. Everything here talks to the store
 * through its public API only (`state.design`, `actions.loadDesign`), so when the store is replaced
 * (M3) this is the one file to re-wire.
 */

/** The thread new text is sewn in: the design's last thread, else Black from the default catalogue. */
export function textThread(design: Design | null): Thread {
  const last = design?.threads[design.threads.length - 1];
  if (last) return last;
  const t = getCatalogue().threads;
  return toDesignThread(t.find((x) => x.name === "Black") ?? t[0]);
}

/** Next free text group id (`text-1`, `text-2`...), unique among objects and text blocks. */
export function nextTextGroup(design: Design | null): string {
  const used = new Set([...(design?.textBlocks ?? []).map((b) => b.id), ...(design?.objects ?? []).map((o) => o.sourceText?.group ?? "")]);
  let n = 1;
  while (used.has(`text-${n}`)) n++;
  return `text-${n}`;
}

const move = (o: DesignObject, dx: number, dy: number): DesignObject => {
  const mv = ([x, y]: readonly [number, number]): [number, number] => [x + dx, y + dy];
  switch (o.kind) {
    case "satin":
      return { ...o, geometry: { strip: o.geometry.strip.map(mv) } };
    case "fill":
      return { ...o, geometry: { shell: o.geometry.shell.map(mv), holes: o.geometry.holes.map((h) => h.map(mv)) } };
    case "run":
      return { ...o, geometry: { ...o.geometry, path: o.geometry.path.map(mv) } };
  }
};

/**
 * Pure: the design with a laid-out text block appended. The text is centred on the existing design
 * (or on 0,0 for an empty one). Objects keep the engine's sewing order and sit on top of the stack.
 */
export function withText(design: Design | null, layout: LayoutResponse, block: Omit<TextBlock, "origin">, thread: Thread): Design {
  const base = design ?? emptyDesign();
  const b = design ? designBounds(design) : null;
  const target: [number, number] = b ? [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] : [0, 0];
  const dx = target[0] - layout.centre[0];
  const dy = target[1] - layout.centre[1];
  const threads = base.threads.some((t) => t.id === thread.id) ? base.threads : [...base.threads, thread];
  return {
    ...base,
    threads,
    objects: [...base.objects, ...layout.objects.map((o) => move(o, dx, dy))],
    textBlocks: [...(base.textBlocks ?? []), { ...block, origin: [dx, dy] }],
  };
}

/** Hook used by the Text panel: current design plus a way to add text to it. */
export function useTextTarget() {
  const { state, actions } = useEditor();
  return {
    design: state.design,
    insert: (layout: LayoutResponse, block: Omit<TextBlock, "origin">, thread: Thread) => actions.loadDesign(withText(state.design, layout, block, thread)),
  };
}
