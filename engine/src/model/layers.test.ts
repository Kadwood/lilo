import { describe, expect, it } from "vitest";
import { designToEmbroidery, designToPes } from "../export";
import { readEmbroidery } from "../formats";
import { migrateProjectDoc } from "../project/migrate";
import { PROJECT_FORMAT, PROJECT_VERSION, ProjectError } from "../project/types";
import { designToStitchPlan } from "../stitch";
import { sampleDesign } from "../stitch/sample-design";
import {
  DESIGN_VERSION,
  hiddenLayerMessage,
  hiddenStitchLayers,
  makeLayer,
  migrateDesignToLayers,
  newLayerId,
  normalizeLayers,
  parseDesign,
  sewOrder,
  type Design,
  type DesignImage,
  type DesignObject,
  type Layer,
} from "../model";

const img = (id: string, layerId?: string): DesignImage => ({ id, name: `${id}.png`, mime: "image/png", w: 10, h: 10, x: 0, y: 0, widthMm: 20, opacity: 0.6, locked: false, visible: true, ...(layerId ? { layerId } : {}) });
const L = (id: string, kind: Layer["kind"], over: Partial<Layer> = {}): Layer => ({ id, name: id, kind, visible: true, locked: false, ...over });
const ids = (list: readonly { id: string }[]) => list.map((x) => x.id);
/** The sample design (f1 fill, s1 satin, r1 run) with its objects split over layers A (bottom) and B (top). */
function twoLayers(): Design {
  const d = sampleDesign();
  const [f1, s1, r1] = d.objects;
  return { ...d, layers: [L("A", "stitch"), L("B", "stitch")], objects: [{ ...f1, layerId: "A" }, { ...s1, layerId: "B" }, { ...r1, layerId: "B" }] as DesignObject[] };
}

describe("normalizeLayers", () => {
  it("gives an old design one Stitches layer and changes nothing else", () => {
    const d = sampleDesign();
    const n = normalizeLayers(d);
    expect(n.layers).toEqual([{ id: "layer-stitches", name: "Stitches", kind: "stitch", visible: true, locked: false }]);
    expect(ids(n.objects)).toEqual(ids(d.objects));
    expect(n.objects.every((o) => o.layerId === "layer-stitches")).toBe(true);
    expect({ ...n, layers: undefined, objects: [] }).toEqual({ ...d, layers: undefined, objects: [] });
  });

  it("is the same object back when there is nothing to fix", () => {
    const n = normalizeLayers(sampleDesign());
    expect(normalizeLayers(n)).toBe(n);
  });

  it("puts a Picture layer at the bottom when there are images", () => {
    const n = normalizeLayers({ ...sampleDesign(), images: [img("i1"), img("i2")] });
    expect(n.layers!.map((l) => [l.name, l.kind])).toEqual([["Picture", "picture"], ["Stitches", "stitch"]]);
    expect(n.images!.every((m) => m.layerId === "layer-picture")).toBe(true);
  });

  it("groups objects by layer, bottom layer first, keeping the order inside a layer", () => {
    const d = twoLayers();
    const [f1, s1, r1] = d.objects;
    const mixed = { ...d, objects: [s1, f1, r1] }; // B, A, B
    expect(ids(normalizeLayers(mixed).objects)).toEqual(["f1", "s1", "r1"]);
  });

  it("flips the sew order when the layers swap", () => {
    const d = twoLayers();
    const flipped = normalizeLayers({ ...d, layers: [d.layers![1], d.layers![0]] });
    expect(ids(flipped.objects)).toEqual(["s1", "r1", "f1"]);
  });

  it("gives an unlabelled object the layer of the one before it; one with no neighbours goes to the top stitch layer", () => {
    const d = twoLayers();
    const orphan = { ...d.objects[0], id: "new1", layerId: undefined } as DesignObject;
    expect(ids(normalizeLayers({ ...d, objects: [d.objects[0], orphan, d.objects[1], d.objects[2]] }).objects)).toEqual(["f1", "new1", "s1", "r1"]);
    const n = normalizeLayers({ ...d, objects: [orphan] });
    expect(n.objects[0].layerId).toBe("B");
  });

  it("sends new objects at the end to the active stitch layer", () => {
    const d = twoLayers();
    const orphan = { ...d.objects[0], id: "new1", layerId: undefined } as DesignObject;
    const n = normalizeLayers({ ...d, objects: [...d.objects, orphan] }, { stitchLayerId: "A" });
    expect(ids(n.objects)).toEqual(["f1", "new1", "s1", "r1"]);
    expect(n.objects[1].layerId).toBe("A");
  });

  it("keeps pictures out of stitch layers and shapes out of picture layers", () => {
    const d = { ...twoLayers(), layers: [L("P", "picture"), L("A", "stitch"), L("B", "stitch")], images: [img("i1", "A"), img("i2", "nope")] };
    const n = normalizeLayers({ ...d, objects: [{ ...d.objects[0], layerId: "P" } as DesignObject, d.objects[1], d.objects[2]] });
    expect(n.images!.map((m) => m.layerId)).toEqual(["P", "P"]);
    expect(n.objects.find((o) => o.id === "f1")!.layerId).toBe("B"); // had no valid layer: top stitch layer after its neighbour
  });

  it("drops a layer id that is used twice and repairs a layer with missing fields", () => {
    const d = { ...twoLayers(), layers: [L("A", "stitch"), L("A", "stitch", { name: "dup" }), { id: "B", kind: "stitch" } as unknown as Layer] };
    const n = normalizeLayers(d);
    expect(ids(n.layers!)).toEqual(["A", "B"]);
    expect(n.layers![1]).toEqual({ id: "B", name: "Stitches", kind: "stitch", visible: true, locked: false });
  });

  it("keeps empty layers", () => {
    const d = { ...twoLayers(), layers: [L("A", "stitch"), L("empty", "stitch"), L("B", "stitch")] };
    expect(ids(normalizeLayers(d).layers!)).toEqual(["A", "empty", "B"]);
  });

  it("makes ids and names that are not taken", () => {
    const layers = [L("layer-stitches", "stitch", { name: "Stitches" })];
    expect(newLayerId(layers, "layer-stitches")).toBe("layer-2");
    expect(makeLayer(layers, "stitch").name).toBe("Stitches 2");
  });
});

describe("version 1 designs", () => {
  const v1 = (): Design => ({ ...sampleDesign(), version: 1 as unknown as typeof DESIGN_VERSION, images: [img("i1")] });

  it("migrate without changing a stitch", () => {
    const before = designToStitchPlan(v1());
    const migrated = migrateDesignToLayers(v1());
    expect(migrated.version).toBe(DESIGN_VERSION);
    expect(designToStitchPlan(migrated)).toEqual(before);
    expect(ids(migrated.objects)).toEqual(ids(v1().objects));
    expect(migrated.layers!.map((l) => l.name)).toEqual(["Picture", "Stitches"]);
  });

  it("parseDesign reads them and writes version 2", () => {
    const d = parseDesign(JSON.stringify(v1()));
    expect(d.version).toBe(2);
    expect(d.layers).toHaveLength(2);
  });

  it("a v1 project file migrates once and is then stable (lossless round trip)", () => {
    const doc = { format: PROJECT_FORMAT, version: 1, title: "Old", design: v1() };
    const a = migrateProjectDoc(doc);
    expect(a.migrated).toBe(true);
    expect(a.doc.version).toBe(PROJECT_VERSION);
    expect(a.doc.design.version).toBe(2);
    const text = JSON.stringify(a.doc);
    const b = migrateProjectDoc(JSON.parse(text));
    expect(b.migrated).toBe(false);
    expect(JSON.stringify(b.doc)).toBe(text);
    // the shapes are untouched apart from the layer label
    const strip = (d: Design) => d.objects.map(({ layerId: _l, ...o }) => o);
    expect(strip(a.doc.design)).toEqual(strip(v1()));
  });

  it("an older Lilo refuses a newer project with the 'newer version' message", () => {
    const doc = { format: PROJECT_FORMAT, version: PROJECT_VERSION, design: sampleDesign() };
    expect(() => migrateProjectDoc(doc, {}, PROJECT_VERSION - 1)).toThrow(/newer version of Lilo/);
    try {
      migrateProjectDoc(doc, {}, PROJECT_VERSION - 1);
    } catch (e) {
      expect((e as ProjectError).code).toBe("unsupported-version");
    }
  });
});

describe("sew order", () => {
  it("sews every stitch of the bottom layer before the top layer", () => {
    const d = twoLayers();
    const layerOfObject = (i: number) => d.objects[i].layerId;
    const order = designToStitchPlan(d).stitches.filter((s) => s.objectIndex >= 0).map((s) => layerOfObject(s.objectIndex));
    expect(order.lastIndexOf("A")).toBeLessThan(order.indexOf("B"));
  });

  it("reordering the layers flips it", () => {
    const d = twoLayers();
    const flipped = normalizeLayers({ ...d, layers: [d.layers![1], d.layers![0]] });
    const order = designToStitchPlan(flipped).stitches.filter((s) => s.objectIndex >= 0).map((s) => flipped.objects[s.objectIndex].layerId);
    expect(order.lastIndexOf("B")).toBeLessThan(order.indexOf("A"));
  });

  it("numbers the objects that will be sewn and gives each layer its range", () => {
    const d = twoLayers();
    d.layers![1].visible = false;
    const o = sewOrder(d);
    expect(o.ranges.get("A")).toEqual({ first: 1, last: 1 });
    expect(o.ranges.get("B")).toBeNull();
    expect(o.numbers.get("f1")).toBe(1);
    expect(o.numbers.has("s1")).toBe(false);
  });
});

describe("hidden layers", () => {
  const hideB = (): Design => {
    const d = twoLayers();
    return { ...d, layers: [d.layers![0], { ...d.layers![1], visible: false }] };
  };

  it("drop out of the plan and the stitch count, and the plan says so", () => {
    const all = designToStitchPlan(twoLayers());
    const part = designToStitchPlan(hideB());
    expect(part.stitches.length).toBeLessThan(all.stitches.length);
    expect(part.stitches.every((s) => s.objectIndex < 1)).toBe(true);
    expect(part.warnings.find((w) => w.code === "hidden-layer")?.message).toBe("1 layer is hidden — it won't be sewn: B");
    expect(all.warnings.some((w) => w.code === "hidden-layer")).toBe(false);
  });

  it("are left out of the PES and DST bytes", () => {
    const full = designToPes(twoLayers());
    const part = designToPes(hideB());
    expect(part.pes.length).toBeLessThan(full.pes.length);
    expect(part.stats.stitchCount).toBeLessThan(full.stats.stitchCount);
    expect(part.stats.colorChanges).toBeLessThanOrEqual(full.stats.colorChanges);
    expect(part.warnings.some((w) => w.code === "hidden-layer")).toBe(true);
    const dstFull = designToEmbroidery(twoLayers(), "dst");
    const dstPart = designToEmbroidery(hideB(), "dst");
    expect(dstPart.bytes.length).toBeLessThan(dstFull.bytes.length);
    expect(dstPart.warnings.some((w) => w.code === "hidden-layer")).toBe(true);
    // what a reader sees in the file is only the visible layer's stitches
    expect(readEmbroidery(dstPart.bytes, "dst").plan.stitches.filter((s) => s.type === "stitch").length).toBeGreaterThan(0);
  });

  it("drop their colour from the thread list when it is only used there", () => {
    const part = designToPes(hideB());
    expect(part.plan.threads.map((t) => t.name)).toEqual(["Blue"]);
  });

  it("name every hidden layer; an empty hidden layer is not worth a warning", () => {
    const d = twoLayers();
    d.layers = [{ ...d.layers![0], visible: false }, { ...d.layers![1], visible: false }, L("empty", "stitch", { visible: false })];
    const hidden = hiddenStitchLayers({ ...d, layers: d.layers });
    expect(hidden.map((l) => l.id)).toEqual(["A", "B"]);
    expect(hiddenLayerMessage(hidden)).toBe("2 layers are hidden — they won't be sewn: A, B");
    expect(hiddenLayerMessage([])).toBeNull();
  });

  it("a hidden picture layer changes nothing in the export", () => {
    const d = { ...twoLayers(), layers: [L("P", "picture"), ...twoLayers().layers!], images: [img("i1", "P")] };
    const hiddenPic = { ...d, layers: d.layers.map((l) => (l.id === "P" ? { ...l, visible: false } : l)) };
    const a = designToPes(d);
    const b = designToPes(hiddenPic);
    expect(Buffer.from(b.pes).equals(Buffer.from(a.pes))).toBe(true);
    expect(b.warnings.some((w) => w.code === "hidden-layer")).toBe(false);
  });

  it("an object hidden on its own still works as before", () => {
    const d = twoLayers();
    d.objects = d.objects.map((o) => (o.id === "s1" ? { ...o, visible: false } : o)) as DesignObject[];
    expect(designToStitchPlan(d).stitches.some((s) => d.objects[s.objectIndex]?.id === "s1")).toBe(false);
  });
});
