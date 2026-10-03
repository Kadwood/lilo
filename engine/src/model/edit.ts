import {
  DEFAULT_FILL_PARAMS,
  DEFAULT_RUN_PARAMS,
  DEFAULT_SATIN_PARAMS,
} from "./index";
import { flattenNodes, nodesFromPolyline, type PathNode } from "./path";
import { compose, objectBox, rotation, satinOutline, transformObject, translation, unionBox, type Affine, type Box } from "./transform";
import type { Design, DesignObject, FillObject, MapGroup, MapToPathOptions, Pt, RunObject, SatinObject, Thread } from "./types";

/** Pure editing helpers shared by the tools, the shape actions and the command palette. */

/** An id generator that never collides with ids already in `design` (`o1`, `o2`, ...). */
export function makeIdGen(design: Design): () => string {
  let n = 0;
  for (const o of design.objects) {
    const m = /^o(\d+)$/.exec(o.id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return () => `o${++n}`;
}

/** Add `thread` to the design's thread list if it is not there yet. Mutates (use inside an Immer recipe). */
export function ensureThread(design: Design, thread: Thread): void {
  if (!design.threads.some((t) => t.id === thread.id)) design.threads.push(thread);
}

export function makeFill(id: string, name: string, threadId: string, shell: PathNode[], holes: Pt[][] = []): FillObject {
  return {
    id,
    name,
    kind: "fill",
    threadId,
    geometry: { shell: flattenNodes(shell, true), holes, shellNodes: shell },
    params: { ...DEFAULT_FILL_PARAMS },
  };
}

export function makeRun(id: string, name: string, threadId: string, nodes: PathNode[], closed: boolean, params = DEFAULT_RUN_PARAMS): RunObject {
  return {
    id,
    name,
    kind: "run",
    threadId,
    geometry: { path: flattenNodes(nodes, closed), closed, nodes },
    params: { ...params },
  };
}

export function makeSatin(id: string, name: string, threadId: string, strip: Pt[]): SatinObject {
  return { id, name, kind: "satin", threadId, geometry: { strip }, params: { ...DEFAULT_SATIN_PARAMS } };
}

// ---- reshape ----------------------------------------------------------------------------------

/** One editable outline of an object. */
export interface EditRing {
  nodes: PathNode[];
  closed: boolean;
  /** Can nodes be inserted and deleted? (Satin strips are rung pairs: move only.) */
  structural: boolean;
}

/** Ring 0 is the shell / path / strip; ring k >= 1 is hole k - 1. */
export function editRings(o: DesignObject): EditRing[] {
  switch (o.kind) {
    case "fill": {
      const g = o.geometry;
      return [
        { nodes: g.shellNodes ?? nodesFromPolyline(g.shell), closed: true, structural: true },
        ...g.holes.map((h, i) => ({ nodes: g.holeNodes?.[i] ?? nodesFromPolyline(h), closed: true, structural: true })),
      ];
    }
    case "satin":
      return [{ nodes: nodesFromPolyline(o.geometry.strip), closed: false, structural: false }];
    case "run":
      return [{ nodes: o.geometry.nodes ?? nodesFromPolyline(o.geometry.path), closed: o.geometry.closed, structural: o.params.type !== "manual" }];
  }
}

/** A copy of `o` whose ring `ring` has the given nodes (polyline re-flattened). */
export function withRingNodes(o: DesignObject, ring: number, nodes: PathNode[]): DesignObject {
  switch (o.kind) {
    case "fill": {
      const g = o.geometry;
      if (ring === 0) return { ...o, geometry: { ...g, shell: flattenNodes(nodes, true), shellNodes: nodes } };
      const holes = g.holes.map((h, i) => (i === ring - 1 ? flattenNodes(nodes, true) : h));
      const holeNodes = g.holes.map((_, i) => (i === ring - 1 ? nodes : g.holeNodes?.[i]));
      return { ...o, geometry: { ...g, holes, holeNodes } };
    }
    case "satin":
      return { ...o, geometry: { strip: nodes.map((n) => n.p) } };
    case "run":
      return { ...o, geometry: { ...o.geometry, path: flattenNodes(nodes, o.geometry.closed), nodes } };
  }
}

// ---- outline <-> fill, redwork ----------------------------------------------------------------

/** Closed outline of a fill, as a run (outlines of holes are dropped; redwork keeps them). */
export function fillToOutline(o: FillObject): RunObject {
  const nodes = o.geometry.shellNodes ?? nodesFromPolyline(o.geometry.shell);
  return {
    id: o.id,
    name: o.name,
    kind: "run",
    threadId: o.threadId,
    visible: o.visible,
    locked: o.locked,
    geometry: { path: o.geometry.shell, closed: true, nodes },
    params: { ...DEFAULT_RUN_PARAMS },
  };
}

/** Fill a closed run. Null when the run is open or has fewer than three points. */
export function outlineToFill(o: RunObject): FillObject | null {
  if (!o.geometry.closed || o.geometry.path.length < 3) return null;
  return {
    id: o.id,
    name: o.name,
    kind: "fill",
    threadId: o.threadId,
    visible: o.visible,
    locked: o.locked,
    geometry: { shell: o.geometry.path, holes: [], ...(o.geometry.nodes ? { shellNodes: o.geometry.nodes } : {}) },
    params: { ...DEFAULT_FILL_PARAMS },
  };
}

/** Every closed outline of an object: shell and holes of a fill, the edge of a satin column, a closed run. */
export function objectOutlines(o: DesignObject): Pt[][] {
  switch (o.kind) {
    case "fill":
      return [o.geometry.shell, ...o.geometry.holes];
    case "satin":
      return [satinOutline(o.geometry.strip)];
    case "run":
      return o.geometry.closed ? [o.geometry.path] : [];
  }
}

const d2 = (a: Pt, b: Pt) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/**
 * Auto redwork: one outline run along every edge of the given objects. Outlines are chained
 * nearest-first and each starts at the vertex closest to where the needle ended, so the whole
 * thing sews in one go with the fewest jumps this greedy order can manage.
 */
export function autoRedwork(objects: readonly DesignObject[], threadId: string, newId: () => string, from: Pt = [0, 0]): RunObject[] {
  const rings = objects.flatMap(objectOutlines).filter((r) => r.length >= 3);
  const out: RunObject[] = [];
  let cur: Pt = from;
  const left = [...rings];
  let n = 1;
  while (left.length) {
    let bi = 0;
    let bd = Infinity;
    let bk = 0;
    left.forEach((r, i) => {
      r.forEach((p, k) => {
        const dd = d2(p, cur);
        if (dd < bd) {
          bd = dd;
          bi = i;
          bk = k;
        }
      });
    });
    const ring = left.splice(bi, 1)[0];
    const rot = [...ring.slice(bk), ...ring.slice(0, bk)];
    cur = rot[0];
    out.push({
      id: newId(),
      name: `Redwork ${n++}`,
      kind: "run",
      threadId,
      geometry: { path: rot, closed: true },
      params: { ...DEFAULT_RUN_PARAMS },
    });
  }
  return out;
}

// ---- map to path ------------------------------------------------------------------------------

export const DEFAULT_MAP_OPTIONS: MapToPathOptions = { mode: "count", count: 5, spacingMm: 8, rotate: true, reverse: false };

export interface PathStop {
  p: Pt;
  /** Path direction at this stop, radians. */
  angle: number;
}

/** Evenly spaced stops along a polyline. */
export function pathStops(path: readonly Pt[], closed: boolean, o: MapToPathOptions): PathStop[] {
  const pts = closed ? [...path, path[0]] : [...path];
  if (o.reverse) pts.reverse();
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  if (total === 0) return [];
  let dists: number[];
  if (o.mode === "spacing") {
    const sp = Math.max(0.1, o.spacingMm);
    dists = [];
    for (let s = 0; s <= total + 1e-9; s += sp) dists.push(s);
    if (closed && dists.length > 1 && total - dists[dists.length - 1] < sp * 0.5) dists.pop();
  } else {
    const n = Math.max(1, Math.round(o.count));
    dists = n === 1 ? [0] : Array.from({ length: n }, (_, i) => (closed ? (i * total) / n : (i * total) / (n - 1)));
  }
  return dists.map((s) => {
    let k = 1;
    while (k < cum.length - 1 && cum[k] < s) k++;
    const a = pts[k - 1];
    const b = pts[k];
    const seg = cum[k] - cum[k - 1] || 1;
    const t = Math.max(0, Math.min(1, (s - cum[k - 1]) / seg));
    return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as Pt, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  });
}

/**
 * Repeat `sources` along `path`: the group's centre lands on each stop, and (with `rotate`) turns by
 * how far the path has turned since its start. The copies are independent objects.
 */
export function mapToPath(sources: readonly DesignObject[], path: readonly Pt[], closed: boolean, o: MapToPathOptions, newId: () => string): DesignObject[] {
  const box = unionBox(sources.map(objectBox));
  const stops = pathStops(path, closed, o);
  if (!box || stops.length === 0) return [];
  const centre: Pt = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
  const out: DesignObject[] = [];
  stops.forEach((s, i) => {
    const turn = o.rotate ? s.angle - stops[0].angle : 0;
    const m: Affine = compose(compose(translation(-centre[0], -centre[1]), rotation(turn)), translation(s.p[0], s.p[1]));
    for (const src of sources) {
      const copy = transformObject(src, m);
      out.push({ ...copy, id: newId(), name: `${src.name} ${i + 1}` });
    }
  });
  return out;
}

// ---- duplicate / box helpers ------------------------------------------------------------------

export function duplicateObjects(objects: readonly DesignObject[], newId: () => string, dx = 3, dy = 3): DesignObject[] {
  return objects.map((o) => {
    const copy = { ...transformObject(o, translation(dx, dy)), id: newId(), name: `${o.name} copy` };
    delete copy.mapGroup; // a duplicate is its own thing, not another stop on the path
    return copy;
  });
}

/** Size of a box in mm. */
export const boxSize = (b: Box): { w: number; h: number } => ({ w: b.maxX - b.minX, h: b.maxY - b.minY });

export const boxCentre = (b: Box): Pt => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];

/** Resize a selection box to `w` x `h` mm keeping its top-left corner. Returns the transform. */
export function resizeAbout(b: Box, w: number, h: number, anchor: Pt = [b.minX, b.minY]): Affine {
  const cw = b.maxX - b.minX || 1;
  const ch = b.maxY - b.minY || 1;
  return compose(translation(-anchor[0], -anchor[1]), compose([w / cw, 0, 0, h / ch, 0, 0], translation(anchor[0], anchor[1])));
}

/**
 * Create or update a live map-to-path group on a design (mutates; call inside an Immer recipe).
 * The group's copies replace the originals (new group) or the previous copies (existing group), at
 * the position of the first object they replace. Returns the ids of the copies.
 */
export function applyMapGroup(design: Design, groupId: string, group: MapGroup, newId: () => string, replaceIds: readonly string[] = []): string[] {
  const copies = mapToPath(group.sources, group.path, group.closed, group.options, newId).map((c) => ({ ...c, mapGroup: groupId }));
  const gone = new Set([...replaceIds, ...design.objects.filter((o) => o.mapGroup === groupId).map((o) => o.id)]);
  let at = design.objects.findIndex((o) => gone.has(o.id));
  if (at < 0) at = design.objects.length;
  const kept = design.objects.filter((o) => !gone.has(o.id));
  // removing earlier objects shifts the insertion point left
  const before = design.objects.slice(0, at).filter((o) => gone.has(o.id)).length;
  kept.splice(at - before, 0, ...copies);
  design.objects = kept;
  design.mapGroups = { ...design.mapGroups, [groupId]: group };
  return copies.map((c) => c.id);
}

/** Make a map group's copies ordinary objects again. Mutates (Immer recipe). */
export function detachMapGroup(design: Design, groupId: string): void {
  for (const o of design.objects) if (o.mapGroup === groupId) delete o.mapGroup;
  if (design.mapGroups) {
    const rest = { ...design.mapGroups };
    delete rest[groupId];
    design.mapGroups = Object.keys(rest).length ? rest : undefined;
    if (!design.mapGroups) delete design.mapGroups;
  }
}
