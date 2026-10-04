import { applyAffine, compose, isObjectLocked, lockedLayerIds, objectBox, unionBox, type Affine, type Design, type DesignObject, type Pt, type TextBlock } from "@lilo/engine/light";

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

const IDENTITY_LINEAR = [1, 0, 0, 1] as const;

/** Where a text block's letters are centred now: the stored centre, else the middle of their box. */
function blockCentre(d: Design, b: TextBlock): Pt | null {
  if (b.centre) return b.centre;
  const box = unionBox(d.objects.filter((o) => o.sourceText?.group === b.id).map(objectBox));
  return box ? [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2] : null;
}

/**
 * Call inside a commit recipe BEFORE the objects `moved` are transformed by `m`: records the move on
 * every text block whose letters all move (a word moves as one), so editing the text later re-lays it
 * out with the same rotation, scale, flip and position. Blocks that only partly move are left alone.
 */
export function transformTextBlocks(d: Design, moved: ReadonlySet<string>, m: Affine): void {
  if (!d.textBlocks?.length) return;
  const layerLocks = lockedLayerIds(d);
  d.textBlocks = d.textBlocks.map((b) => {
    const members = d.objects.filter((o) => o.sourceText?.group === b.id);
    if (members.length === 0 || !members.every((o) => moved.has(o.id) && !isObjectLocked(o, layerLocks))) return b;
    const c = blockCentre(d, b);
    if (!c) return b;
    const l = b.linear ?? IDENTITY_LINEAR;
    const [a0, a1, a2, a3] = compose([l[0], l[1], l[2], l[3], 0, 0], m);
    return { ...b, centre: applyAffine(m, c), linear: [a0, a1, a2, a3] as const };
  });
}

/**
 * The transform that puts a freshly laid-out block (centred on `layoutCentre`) where the block it
 * replaces is: same centre, same rotation/scale/flip. Null for a block with no record of either
 * (older files): those keep the old behaviour of centring on the letters. Curved text is kept the same way.
 */
export function relayoutAffine(d: Design, old: TextBlock | undefined, _next: { path?: unknown }, layoutCentre: Pt): Affine | null {
  if (!old) return null;
  const c = blockCentre(d, old);
  if (!c) return null;
  const l = old.linear ?? IDENTITY_LINEAR;
  return [l[0], l[1], l[2], l[3], c[0] - (l[0] * layoutCentre[0] + l[2] * layoutCentre[1]), c[1] - (l[1] * layoutCentre[0] + l[3] * layoutCentre[1])];
}
