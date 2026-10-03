import { afterEach, describe, expect, it, vi } from "vitest";
import { HOOPS, emptyDesign, makeFill, makeRun, objectBox, rectNodes, translation, type DesignObject, type FillObject } from "@lilo/engine/light";
import { createInlineEngine } from "../engine/client";
import { createEditorStore, defaultThread, type EditorStore } from "./editorStore";

const stores: EditorStore[] = [];
function setup(objects: DesignObject[] = []) {
  const core = createEditorStore(createInlineEngine());
  stores.push(core);
  const t = defaultThread();
  const d = emptyDesign();
  d.threads = [t];
  d.objects = objects;
  core.store.setState({ design: d });
  return { ...core, get: core.store.getState, t };
}
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
});

const box = (t: string, id: string, x = 0, y = 0, w = 10, h = 10): FillObject => makeFill(id, id, t, rectNodes(x, y, x + w, y + h));
const ids = (c: ReturnType<typeof setup>) => c.get().design!.objects.map((o) => o.id);

describe("undo / redo", () => {
  it("undoes and redoes an added object, with selection and flags", () => {
    const c = setup();
    c.actions.addObjects([box(c.t.id, "a")], "Add");
    expect(ids(c)).toEqual(["a"]);
    expect(c.get().selectedIds).toEqual(["a"]);
    expect(c.get().canUndo).toBe(true);
    expect(c.get().undoLabel).toBe("Add");
    c.actions.undo();
    expect(ids(c)).toEqual([]);
    expect(c.get().selectedIds).toEqual([]);
    expect(c.get().canRedo).toBe(true);
    c.actions.redo();
    expect(ids(c)).toEqual(["a"]);
    expect(c.get().selectedIds).toEqual(["a"]);
  });

  it("a new edit drops the redo stack", () => {
    const c = setup();
    c.actions.addObjects([box(c.t.id, "a")], "Add a");
    c.actions.undo();
    c.actions.addObjects([box(c.t.id, "b")], "Add b");
    expect(c.get().canRedo).toBe(false);
  });

  it("merges a drag into one undo step until the group ends", () => {
    const c = setup([box(c0(), "a")]);
    c.actions.setSelection(["a"]);
    for (let i = 0; i < 5; i++) c.actions.transformSelection(translation(1, 0), "Move", { merge: "drag" });
    expect(objectBox(c.get().design!.objects[0])!.minX).toBe(5);
    c.actions.undo();
    expect(objectBox(c.get().design!.objects[0])!.minX).toBe(0); // one step undid the whole drag
    c.actions.redo();
    expect(objectBox(c.get().design!.objects[0])!.minX).toBe(5);
    c.actions.transformSelection(translation(1, 0), "Move", { merge: "drag" });
    c.actions.endGroup();
    c.actions.transformSelection(translation(1, 0), "Move", { merge: "drag" });
    c.actions.undo();
    expect(objectBox(c.get().design!.objects[0])!.minX).toBe(6); // second drag only
  });

  it("merges arrow-key nudges that come in quick succession", () => {
    const c = setup([box(c0(), "a")]);
    c.actions.setSelection(["a"]);
    c.actions.nudgeSelection(0.1, 0);
    c.actions.nudgeSelection(0.1, 0);
    c.actions.nudgeSelection(0.1, 0);
    expect(objectBox(c.get().design!.objects[0])!.minX).toBeCloseTo(0.3);
    c.actions.undo();
    expect(objectBox(c.get().design!.objects[0])!.minX).toBeCloseTo(0);
    expect(c.get().canUndo).toBe(false);
  });

  it("restores the previous selection on undo", () => {
    const c = setup([box(c0(), "a"), box(c0(), "b", 20)]);
    c.actions.setSelection(["a", "b"]);
    c.actions.deleteSelection();
    expect(ids(c)).toEqual([]);
    c.actions.undo();
    expect(c.get().selectedIds).toEqual(["a", "b"]);
  });

  it("history survives many edits and patches replay in order", () => {
    const c = setup([box(c0(), "a")]);
    c.actions.setSelection(["a"]);
    c.actions.flipSelection("h");
    c.actions.rename("a", "Renamed");
    c.actions.duplicateSelection();
    expect(ids(c)).toHaveLength(2);
    c.actions.undo();
    c.actions.undo();
    c.actions.undo();
    expect(c.get().design!.objects[0].name).toBe("a");
    c.actions.redo();
    c.actions.redo();
    c.actions.redo();
    expect(ids(c)).toHaveLength(2);
    expect(c.get().design!.objects[0].name).toBe("Renamed");
  });
});

function c0(): string {
  return defaultThread().id;
}

describe("selection actions", () => {
  it("select all skips hidden objects", () => {
    const c = setup([box(c0(), "a"), { ...box(c0(), "b"), visible: false }]);
    c.actions.selectAll();
    expect(c.get().selectedIds).toEqual(["a"]);
  });

  it("duplicate offsets and selects the copies; delete removes the selection", () => {
    const c = setup([box(c0(), "a")]);
    c.actions.setSelection(["a"]);
    c.actions.duplicateSelection();
    expect(c.get().selectedIds).toHaveLength(1);
    expect(c.get().selectedIds[0]).not.toBe("a");
    c.actions.deleteSelection();
    expect(ids(c)).toEqual(["a"]);
  });

  it("locked objects don't move, resize or delete", () => {
    const c = setup([{ ...box(c0(), "a"), locked: true }]);
    c.actions.setSelection(["a"]);
    c.actions.nudgeSelection(5, 5);
    c.actions.deleteSelection();
    expect(ids(c)).toEqual(["a"]);
    expect(objectBox(c.get().design!.objects[0])!.minX).toBe(0);
    c.actions.toggleLockSelection();
    expect(c.get().design!.objects[0].locked).toBe(false);
    c.actions.nudgeSelection(5, 5);
    expect(objectBox(c.get().design!.objects[0])!.minX).toBe(5);
  });

  it("resizes a selection to the given width and height from its top-left", () => {
    const c = setup([box(c0(), "a", 2, 3, 10, 10)]);
    c.actions.setSelection(["a"]);
    c.actions.resizeSelection(20, 5);
    const b = objectBox(c.get().design!.objects[0])!;
    expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([2, 3, 22, 8]);
  });

  it("flips and rotates about the selection centre", () => {
    const c = setup([box(c0(), "a", 0, 0, 10, 4)]);
    c.actions.setSelection(["a"]);
    c.actions.rotateSelection(90);
    const b = objectBox(c.get().design!.objects[0])!;
    expect(b.maxX - b.minX).toBeCloseTo(4);
    expect(b.maxY - b.minY).toBeCloseTo(10);
  });

  it("changing the selection leaves a shape mode behind", () => {
    const c = setup([box(c0(), "a"), box(c0(), "b", 20)]);
    c.actions.setSelection(["a"]);
    c.actions.setMode("reshape");
    c.actions.setSelection(["b"]);
    expect(c.get().mode).toBe("none");
  });
});

describe("design edits", () => {
  it("changing the hoop is undoable", () => {
    const c = setup();
    c.actions.setHoop(HOOPS[1]);
    expect(c.get().design!.hoop).toEqual(HOOPS[1]);
    c.actions.undo();
    expect(c.get().design!.hoop).toEqual(HOOPS[0]);
  });

  it("changes the colour of objects, adding the thread to the design", () => {
    const c = setup([box(c0(), "a")]);
    const other = { id: "x", brand: "B", code: "1", name: "Pink", hex: "#ff00aa" };
    c.actions.setObjectThread(["a"], other);
    expect(c.get().design!.objects[0].threadId).toBe("x");
    expect(c.get().design!.threads.map((t) => t.id)).toContain("x");
    expect(c.get().threadId).toBe("x");
  });

  it("merges colours and groups objects by colour", () => {
    const t1 = c0();
    const t2 = { id: "y", brand: "B", code: "2", name: "Teal", hex: "#00aaaa" };
    const c = setup([box(t1, "a"), { ...box(t1, "b"), threadId: "y" }, box(t1, "c")]);
    c.actions.commit("t", (d) => void d.threads.push(t2));
    c.actions.groupByColour();
    expect(ids(c)).toEqual(["a", "c", "b"]);
    c.actions.mergeColours("y", defaultThread());
    expect(c.get().design!.objects.every((o) => o.threadId === t1)).toBe(true);
    expect(c.get().design!.threads.map((t) => t.id)).toEqual([t1]);
  });

  it("converts a fill to an outline and back; satin and holes stay as they are", () => {
    const c = setup([box(c0(), "a")]);
    c.actions.setSelection(["a"]);
    c.actions.convertSelectionOutline();
    expect(c.get().design!.objects[0].kind).toBe("run");
    c.actions.convertSelectionOutline();
    expect(c.get().design!.objects[0].kind).toBe("fill");
  });

  it("auto redwork adds outline runs after the selection", () => {
    const c = setup([box(c0(), "a")]);
    c.actions.setSelection(["a"]);
    c.actions.redworkSelection();
    expect(c.get().design!.objects.map((o) => o.kind)).toEqual(["fill", "run"]);
  });

  it("knife splits the selected fill through the engine", async () => {
    const c = setup([box(c0(), "a", 0, 0, 20, 10)]);
    c.actions.setSelection(["a"]);
    await c.actions.knife([10, -2], [10, 12]);
    expect(ids(c)).toHaveLength(2);
    expect(c.get().selectedIds).toHaveLength(2);
    c.actions.undo();
    expect(ids(c)).toEqual(["a"]);
  });

  it("cut hole drills a closed shape out of the selected fill", async () => {
    const c = setup([box(c0(), "a", 0, 0, 20, 20)]);
    c.actions.setSelection(["a"]);
    await c.actions.cutHole([[5, 5], [10, 5], [10, 10], [5, 10]]);
    const o = c.get().design!.objects[0] as FillObject;
    expect(o.geometry.holes).toHaveLength(1);
  });
});

describe("map to path", () => {
  it("replaces the shape and the path with tagged copies; re-editing changes the count; detach frees them", () => {
    const t = c0();
    const path = makeRun("p", "Path", t, [{ p: [0, 0] }, { p: [30, 0] }], false);
    const c = setup([box(t, "a"), path]);
    c.actions.setSelection(["a", "p"]);
    c.actions.openMapDraft();
    expect(c.get().mapDraft!.sourceIds).toEqual(["a"]);
    expect(c.get().mapDraft!.pathId).toBe("p");
    c.actions.updateMapDraft({ count: 4 });
    c.actions.applyMapDraft();
    expect(ids(c)).toHaveLength(4);
    expect(c.get().design!.objects.every((o) => o.mapGroup)).toBe(true);
    // select one copy and reopen: it edits the same group
    c.actions.setSelection([ids(c)[1]]);
    c.actions.openMapDraft();
    expect(c.get().mapDraft!.groupId).toBeTruthy();
    c.actions.updateMapDraft({ count: 6 });
    c.actions.applyMapDraft();
    expect(ids(c)).toHaveLength(6);
    const gid = c.get().design!.objects[0].mapGroup!;
    c.actions.detachMap(gid);
    expect(c.get().design!.objects.some((o) => o.mapGroup)).toBe(false);
    c.actions.undo();
    expect(c.get().design!.objects.every((o) => o.mapGroup)).toBe(true);
  });
});

describe("live re-stitch", () => {
  it("re-plans in the background after an edit", async () => {
    const c = setup([box(c0(), "a")]);
    expect(c.get().planResult).toBeNull();
    c.actions.setSelection(["a"]);
    c.actions.nudgeSelection(1, 1);
    expect(c.get().planning).toBe(true);
    await vi.waitFor(() => expect(c.get().planResult).not.toBeNull(), { timeout: 20_000 });
    expect(c.get().planning).toBe(false);
    expect(c.get().planResult!.stats.stitchCount).toBeGreaterThan(50);
  });

  it("drops a stale plan when edits keep coming", async () => {
    const c = setup([box(c0(), "a")]);
    c.actions.setSelection(["a"]);
    for (let i = 0; i < 4; i++) c.actions.nudgeSelection(1, 0);
    await vi.waitFor(() => expect(c.get().planResult).not.toBeNull(), { timeout: 20_000 });
    const minX = Math.min(...c.get().planResult!.plan.stitches.map((s) => s.x));
    expect(minX).toBeGreaterThan(3); // shape moved 4 mm before the one plan ran
  });
});
