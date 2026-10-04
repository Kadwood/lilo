/**
 * Layers (v1.3). `Design.layers` is the Layers panel: bottom first, and the list IS the sew order, so the
 * bottom layer is sewn first and the top layer last (it sits on top, like Photoshop).
 *
 * The one rule everything leans on: `design.objects` is always grouped by layer, in layer order, bottom layer
 * first. Stitch generation therefore never needs to know about layers except to skip hidden ones.
 * `normalizeLayers` is the single function that enforces it. Call it after anything that adds, removes,
 * moves or re-parents objects, images or layers. It returns the same design object when there is nothing to fix.
 */
import type { Design, DesignImage, DesignObject, Layer } from "./types";

export const DEFAULT_STITCH_LAYER_NAME = "Stitches";
export const DEFAULT_PICTURE_LAYER_NAME = "Picture";

export interface NormalizeOptions {
  /** Where brand-new (unlabelled) objects at the end of the list go. Default: the layer of the object before them. */
  stitchLayerId?: string | null;
  /** Where unlabelled images go. Default: the lowest picture layer. */
  pictureLayerId?: string | null;
}

/** A layer id not used by `layers`: `layer-stitches`, `layer-picture` for the defaults, else `layer-<n>`. */
export function newLayerId(layers: readonly Layer[], hint?: string): string {
  const used = new Set(layers.map((l) => l.id));
  if (hint && !used.has(hint)) return hint;
  let n = layers.length + 1;
  while (used.has(`layer-${n}`)) n++;
  return `layer-${n}`;
}

/** A readable name not used by `layers` yet: "Stitches", "Stitches 2", ... */
export function newLayerName(layers: readonly Layer[], base: string): string {
  const used = new Set(layers.map((l) => l.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export function makeLayer(layers: readonly Layer[], kind: Layer["kind"], name?: string): Layer {
  const base = kind === "stitch" ? DEFAULT_STITCH_LAYER_NAME : DEFAULT_PICTURE_LAYER_NAME;
  return {
    id: newLayerId(layers, kind === "stitch" ? "layer-stitches" : "layer-picture"),
    name: name ?? newLayerName(layers, base),
    kind,
    visible: true,
    locked: false,
  };
}

const sameLayer = (a: Layer, b: Layer) => a.id === b.id && a.name === b.name && a.kind === b.kind && a.visible === b.visible && a.locked === b.locked && a.opacity === b.opacity;

/** A layer with every field in shape (older or hand-edited files may miss some). Returns `l` itself when fine. */
function tidyLayer(l: Layer): Layer {
  const fixed: Layer = {
    id: l.id,
    name: typeof l.name === "string" && l.name.trim() ? l.name : l.kind === "picture" ? DEFAULT_PICTURE_LAYER_NAME : DEFAULT_STITCH_LAYER_NAME,
    kind: l.kind === "picture" ? "picture" : "stitch",
    visible: l.visible !== false,
    locked: l.locked === true,
  };
  if (fixed.kind === "picture" && typeof l.opacity === "number" && Number.isFinite(l.opacity)) fixed.opacity = Math.min(1, Math.max(0, l.opacity));
  return sameLayer(l, fixed) && Object.keys(l).length === Object.keys(fixed).length ? l : fixed;
}

/** Make `design` obey the layer rules (see the file comment). Same object back when it already does. */
export function normalizeLayers(design: Design, opts: NormalizeOptions = {}): Design {
  const objects = design.objects;
  const images = design.images ?? [];
  let layers: Layer[] = [];
  let layersChanged = !Array.isArray(design.layers);
  const seen = new Set<string>();
  for (const l of design.layers ?? []) {
    if (!l || typeof l.id !== "string" || seen.has(l.id)) {
      layersChanged = true;
      continue;
    }
    seen.add(l.id);
    const t = tidyLayer(l);
    if (t !== l) layersChanged = true;
    layers.push(t);
  }
  // an implicit layer for whatever has none: pictures sit at the bottom, stitches on top
  if (!layers.some((l) => l.kind === "stitch")) {
    layers = [...layers, makeLayer(layers, "stitch")];
    layersChanged = true;
  }
  if (images.length > 0 && !layers.some((l) => l.kind === "picture")) {
    layers = [makeLayer(layers, "picture"), ...layers];
    layersChanged = true;
  }
  const byId = new Map(layers.map((l, i) => [l.id, { l, i }]));
  const topStitch = [...layers].reverse().find((l) => l.kind === "stitch")!;
  const lowPicture = layers.find((l) => l.kind === "picture");

  // ---- objects ----
  const okObj = (o: DesignObject) => !!o.layerId && byId.get(o.layerId)?.l.kind === "stitch";
  let tail = objects.length; // first index after which every object is unlabelled
  while (tail > 0 && !okObj(objects[tail - 1])) tail--;
  const activeStitch = opts.stitchLayerId && byId.get(opts.stitchLayerId)?.l.kind === "stitch" ? opts.stitchLayerId : null;
  const objLayer: string[] = new Array<string>(objects.length);
  let prev: string | null = null;
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    let id: string;
    if (okObj(o)) id = o.layerId!;
    else if (i >= tail && activeStitch) id = activeStitch;
    else if (prev) id = prev;
    else {
      const next = objects.slice(i + 1).find(okObj);
      id = next ? next.layerId! : topStitch.id;
    }
    objLayer[i] = id;
    prev = id;
  }
  const objOrder = objects.map((_, i) => i).sort((a, b) => byId.get(objLayer[a])!.i - byId.get(objLayer[b])!.i || a - b);
  let objChanged = false;
  const nextObjects = objOrder.map((i, pos) => {
    if (i !== pos) objChanged = true;
    const o = objects[i];
    if (o.layerId === objLayer[i]) return o;
    objChanged = true;
    return { ...o, layerId: objLayer[i] } as DesignObject;
  });

  // ---- images ----
  const okImg = (m: DesignImage) => !!m.layerId && byId.get(m.layerId)?.l.kind === "picture";
  const activePicture = opts.pictureLayerId && byId.get(opts.pictureLayerId)?.l.kind === "picture" ? opts.pictureLayerId : null;
  const imgLayer = images.map((m) => (okImg(m) ? m.layerId! : (activePicture ?? lowPicture?.id ?? "")));
  const imgOrder = images.map((_, i) => i).sort((a, b) => (byId.get(imgLayer[a])?.i ?? 0) - (byId.get(imgLayer[b])?.i ?? 0) || a - b);
  let imgChanged = false;
  const nextImages = imgOrder.map((i, pos) => {
    if (i !== pos) imgChanged = true;
    const m = images[i];
    if (m.layerId === imgLayer[i]) return m;
    imgChanged = true;
    return { ...m, layerId: imgLayer[i] };
  });

  if (!layersChanged && !objChanged && !imgChanged) return design;
  return {
    ...design,
    layers,
    ...(objChanged ? { objects: nextObjects } : {}),
    ...(imgChanged ? { images: nextImages } : {}),
  };
}

/** Bring a version-1 design (no layers) to version 2: a "Picture" layer under a "Stitches" layer. Nothing else changes. */
export function migrateDesignToLayers(design: Design): Design {
  const d = normalizeLayers({ ...design, version: 2 });
  return d.version === 2 ? d : { ...d, version: 2 };
}

// ---- reading layers ----------------------------------------------------------------------------

const idsWhere = (design: Design, test: (l: Layer) => boolean): Set<string> => new Set((design.layers ?? []).filter(test).map((l) => l.id));
/** Ids of layers that are switched off (eye closed). */
export const hiddenLayerIds = (design: Design): Set<string> => idsWhere(design, (l) => !l.visible);
/** Ids of layers that are locked. */
export const lockedLayerIds = (design: Design): Set<string> => idsWhere(design, (l) => l.locked);

/** Drawn and sewn: not hidden itself and not in a hidden layer. */
export function isObjectVisible(o: DesignObject, hidden: ReadonlySet<string>): boolean {
  return o.visible !== false && !(o.layerId && hidden.has(o.layerId));
}
/** Can't be edited: locked itself or in a locked layer. */
export function isObjectLocked(o: DesignObject, locked: ReadonlySet<string>): boolean {
  return o.locked === true || !!(o.layerId && locked.has(o.layerId));
}

/** Hidden stitch layers that would have sewn something: what the "won't be sewn" warning names. */
export function hiddenStitchLayers(design: Design): Layer[] {
  const used = new Set<string>();
  for (const o of design.objects) if (o.layerId && o.visible !== false) used.add(o.layerId);
  return (design.layers ?? []).filter((l) => l.kind === "stitch" && !l.visible && used.has(l.id));
}

/** The warning text for `hiddenStitchLayers`, or null when nothing is hidden. */
export function hiddenLayerMessage(hidden: readonly Layer[]): string | null {
  if (hidden.length === 0) return null;
  const names = hidden.map((l) => l.name).join(", ");
  return hidden.length === 1 ? `1 layer is hidden — it won't be sewn: ${names}` : `${hidden.length} layers are hidden — they won't be sewn: ${names}`;
}

/** Where a layer sits in the sew order. `first`/`last` are 1-based sew numbers; null when it sews nothing. */
export interface SewOrder {
  /** Sew number (1-based, among sewn objects) by object id. Hidden objects have none. */
  numbers: Map<string, number>;
  /** Per layer id: the range of sew numbers, or null. */
  ranges: Map<string, { first: number; last: number } | null>;
}

/** Number the objects that will be sewn, in order, and give each layer its range ("sews 4–7"). */
export function sewOrder(design: Design): SewOrder {
  const hidden = hiddenLayerIds(design);
  const numbers = new Map<string, number>();
  const ranges = new Map<string, { first: number; last: number } | null>();
  for (const l of design.layers ?? []) ranges.set(l.id, null);
  let n = 0;
  for (const o of design.objects) {
    if (!isObjectVisible(o, hidden)) continue;
    n++;
    numbers.set(o.id, n);
    if (o.layerId) {
      const r = ranges.get(o.layerId);
      ranges.set(o.layerId, r ? { first: r.first, last: n } : { first: n, last: n });
    }
  }
  return { numbers, ranges };
}
