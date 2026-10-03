import type { Design, DesignObject } from "@lilo/engine";

/** A run of consecutive objects sharing one thread: one colour block when stitched. */
export interface ObjectGroup {
  threadId: string;
  /** Indices into `design.objects`, ascending and contiguous. */
  indices: number[];
}

export function groupObjects(objects: readonly DesignObject[]): ObjectGroup[] {
  const groups: ObjectGroup[] = [];
  objects.forEach((o, i) => {
    const last = groups[groups.length - 1];
    if (last && last.threadId === o.threadId) last.indices.push(i);
    else groups.push({ threadId: o.threadId, indices: [i] });
  });
  return groups;
}

/**
 * Move object `from` so it lands before the object currently at `before` (use `objects.length` to
 * move to the end). Returns the same design when nothing changes.
 */
export function moveObject(design: Design, from: number, before: number): Design {
  const n = design.objects.length;
  if (from < 0 || from >= n || before < 0 || before > n || before === from || before === from + 1) return design;
  const objects = [...design.objects];
  const [moved] = objects.splice(from, 1);
  objects.splice(before > from ? before - 1 : before, 0, moved);
  return { ...design, objects };
}

/** Move a whole colour group before group `beforeGroup` (use `groups.length` for the end). */
export function moveGroup(design: Design, group: number, beforeGroup: number): Design {
  const groups = groupObjects(design.objects);
  if (group < 0 || group >= groups.length || beforeGroup < 0 || beforeGroup > groups.length || beforeGroup === group || beforeGroup === group + 1) {
    return design;
  }
  const order = groups.map((_, i) => i);
  order.splice(order.indexOf(group), 1);
  order.splice(beforeGroup > group ? beforeGroup - 1 : beforeGroup, 0, group);
  const objects = order.flatMap((g) => groups[g].indices.map((i) => design.objects[i]));
  return { ...design, objects };
}

export function setObjectVisible(design: Design, id: string, visible: boolean): Design {
  return { ...design, objects: design.objects.map((o) => (o.id === id ? { ...o, visible } : o)) };
}

export function setGroupVisible(design: Design, group: number, visible: boolean): Design {
  const ids = new Set(groupObjects(design.objects)[group]?.indices.map((i) => design.objects[i].id));
  return { ...design, objects: design.objects.map((o) => (ids.has(o.id) ? { ...o, visible } : o)) };
}
