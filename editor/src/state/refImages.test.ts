import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDesign } from "@lilo/engine/light";
import { createInlineEngine } from "../engine/client";
import { createEditorStore, type EditorStore } from "./editorStore";

// no canvas in node: the decoded picture is a stand-in object
vi.mock("../io/decode", async (orig) => ({
  ...(await orig<typeof import("../io/decode")>()),
  decodeFile: vi.fn(async (f: { name: string }) => ({ kind: "raster", image: { width: 100, height: 50, data: new Uint8ClampedArray(100 * 50 * 4) }, reference: { width: 100, height: 50, name: f.name } })),
}));

const stores: EditorStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
});
function setup() {
  const core = createEditorStore(createInlineEngine());
  stores.push(core);
  core.store.setState({ design: emptyDesign() });
  return { ...core, st: core.store.getState };
}
const png = (n = 4) => ({ name: "ref.png", bytes: new Uint8Array(n).fill(7), type: "image/png" });

describe("reference images belong to the design", () => {
  it("adding one puts its placement in the design and is undoable and redoable", async () => {
    const t = setup();
    await t.actions.addRefImage(png());
    const d = t.st().design!;
    expect(d.images).toHaveLength(1);
    expect(d.images![0]).toMatchObject({ name: "ref.png", mime: "image/png", w: 100, h: 50, widthMm: 60, opacity: 0.6, visible: true, locked: false });
    expect(t.st().refImages.map((r) => r.id)).toEqual([d.images![0].id]);
    expect(t.st().undoLabel).toBe("Add reference image");
    t.actions.undo();
    expect(t.st().design!.images ?? []).toEqual([]);
    expect(t.st().refImages).toEqual([]);
    t.actions.redo();
    expect(t.st().refImages).toHaveLength(1); // the pixels were kept, so redo brings the picture back
  });

  it("opacity, size, visibility and lock are undoable edits; a slider drag is one step", async () => {
    const t = setup();
    await t.actions.addRefImage(png());
    const id = t.st().refImages[0].id;
    for (const v of [0.5, 0.4, 0.3]) t.actions.updateRefImage(id, { opacity: v });
    t.actions.endGroup();
    expect(t.st().refImages[0].opacity).toBe(0.3);
    expect(t.st().undoLabel).toBe("Image opacity");
    t.actions.undo();
    expect(t.st().refImages[0].opacity).toBe(0.6);
    t.actions.redo();
    t.actions.updateRefImage(id, { widthMm: 90 });
    t.actions.updateRefImage(id, { visible: false });
    t.actions.updateRefImage(id, { locked: true });
    expect(t.st().refImages[0]).toMatchObject({ widthMm: 90, visible: false, locked: true });
    t.actions.undo();
    expect(t.st().refImages[0].locked).toBe(false);
    t.actions.undo();
    expect(t.st().refImages[0].visible).toBe(true);
  });

  it("reordering and removing are undoable", async () => {
    const t = setup();
    await t.actions.addRefImage(png());
    await t.actions.addRefImage({ ...png(), name: "two.png" });
    const [a, b] = t.st().refImages.map((r) => r.id);
    expect(a).not.toBe(b);
    t.actions.moveRefImage(a, 1);
    expect(t.st().refImages.map((r) => r.id)).toEqual([b, a]);
    t.actions.undo();
    expect(t.st().refImages.map((r) => r.id)).toEqual([a, b]);
    t.actions.removeRefImage(a);
    expect(t.st().refImages.map((r) => r.id)).toEqual([b]);
    t.actions.undo();
    expect(t.st().refImages.map((r) => r.id)).toEqual([a, b]);
  });

  it("images don't trigger a re-stitch", async () => {
    const t = setup();
    await t.actions.addRefImage(png());
    expect(t.st().planning).toBe(false);
  });

  it("the bytes of the images the design uses are available to save; removed ones are not", async () => {
    const t = setup();
    await t.actions.addRefImage(png(5));
    await t.actions.addRefImage({ ...png(6), name: "two.jpg", type: "image/jpeg" });
    const [a, b] = t.st().refImages.map((r) => r.id);
    expect(t.actions.imageAssets().map((x) => [x.id, x.mime, x.bytes.length])).toEqual([[a, "image/png", 5], [b, "image/jpeg", 6]]);
    t.actions.removeRefImage(a);
    expect(t.actions.imageAssets().map((x) => x.id)).toEqual([b]);
  });

  it("loading a design with images and their bytes restores them", async () => {
    const t = setup();
    const d = { ...emptyDesign(), images: [{ id: "img7", name: "logo.png", mime: "image/png", w: 100, h: 50, x: 1, y: 2, widthMm: 33, opacity: 0.4, locked: false, visible: true }] };
    await t.actions.loadDesign(d, { name: "Crest", images: { img7: { bytes: new Uint8Array([1, 2, 3]), mime: "image/png" } } });
    expect(t.st().projectName).toBe("Crest");
    expect(t.st().refImages[0]).toMatchObject({ id: "img7", x: 1, y: 2, widthMm: 33, opacity: 0.4 });
    expect(t.st().canUndo).toBe(false);
    await t.actions.addRefImage(png()); // new ids don't collide with loaded ones
    expect(new Set(t.st().refImages.map((r) => r.id)).size).toBe(2);
  });
});
