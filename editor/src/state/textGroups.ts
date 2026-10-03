import type { Design, DesignObject } from "@lilo/engine/light";

/** Helpers for text blocks (lettering): objects of one block share `sourceText.group`. Pure, no store. */

/** Next free text group id (`text-1`, `text-2`...), unique among objects and text blocks. */
export function nextTextGroup(design: Design | null, taken: Iterable<string> = []): string {
  const used = new Set([...taken, ...(design?.textBlocks ?? []).map((b) => b.id), ...(design?.objects ?? []).map((o) => o.sourceText?.group ?? "")]);
  let n = 1;
  while (used.has(`text-${n}`)) n++;
  return `text-${n}`;
}

/** `ids` plus every object that shares a text group with one of them (a word moves and selects as one). */
export function expandTextGroups(design: Design | null, ids: string[]): string[] {
  if (!design || ids.length === 0) return ids;
  const want = new Set<string>();
  const byId = new Map(design.objects.map((o) => [o.id, o]));
  for (const id of ids) {
    const g = byId.get(id)?.sourceText?.group;
    if (g) want.add(g);
  }
  if (want.size === 0) return ids;
  const out = [...ids];
  const have = new Set(ids);
  for (const o of design.objects) if (o.sourceText && want.has(o.sourceText.group) && !have.has(o.id)) out.push(o.id);
  return out;
}

/** The single text group the objects belong to, or null (none, mixed, or other objects too). */
export function singleTextGroup(objs: readonly DesignObject[]): string | null {
  if (objs.length === 0) return null;
  const g = objs[0].sourceText?.group;
  return g && objs.every((o) => o.sourceText?.group === g) ? g : null;
}

/** Drop text blocks that no object refers to any more. Mutates (Immer recipe). */
export function pruneTextBlocks(d: Design): void {
  if (!d.textBlocks) return;
  const used = new Set(d.objects.map((o) => o.sourceText?.group));
  d.textBlocks = d.textBlocks.filter((b) => used.has(b.id));
  if (d.textBlocks.length === 0) delete d.textBlocks;
}
