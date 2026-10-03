import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDesign, makeFill, objectBox, rectNodes, type DesignObject, type FillObject, type RunObject, type SatinObject } from "@lilo/engine/light";
import { createInlineEngine } from "../engine/client";
import { createEditorStore, defaultThread, type EditorStore } from "../state/editorStore";
import type { ToolId } from "../tools/registry";
import { CanvasController, type PointerInput } from "./controller";
import type { View } from "./viewport";

const stores: EditorStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
});

/** 10 px per mm, origin at the screen origin: pointer coordinates are mm * 10. */
function setup(objects: DesignObject[] = [], tool: ToolId = "select") {
  const core = createEditorStore(createInlineEngine());
  stores.push(core);
  const t = defaultThread();
  const d = emptyDesign();
  d.threads = [t];
  d.objects = objects;
  core.store.setState({ design: d, tool, threadId: t.id });
  let view: View = { x: 0, y: 0, zoom: 10 };
  let fitted = 0;
  const c = new CanvasController({ api: core.store, actions: core.actions, getView: () => view, setView: (v) => (view = v), fit: () => fitted++ });
  const ev = (mmX: number, mmY: number, o: Partial<PointerInput> = {}): PointerInput & { ctrl: boolean } => ({ x: mmX * 10, y: mmY * 10, button: 0, shift: false, ctrl: false, alt: false, detail: 1, ...o });
  const st = () => core.store.getState();
  const click = (x: number, y: number, o: Partial<PointerInput> = {}) => {
    c.pointerDown(ev(x, y, o));
    c.pointerUp(ev(x, y, o));
  };
  const drag = (x0: number, y0: number, x1: number, y1: number, o: Partial<PointerInput> = {}) => {
    c.pointerDown(ev(x0, y0, o));
    c.pointerMove(ev(x1, y1, o));
    c.pointerUp(ev(x1, y1, o));
  };
  return { core, c, st, t, ev, click, drag, view: () => view, fitted: () => fitted, objs: () => st().design!.objects };
}

const sq = (id: string, x = 0, y = 0, w = 10, h = 10): FillObject => makeFill(id, id, defaultThread().id, rectNodes(x, y, x + w, y + h));

describe("select tool", () => {
  it("click selects the topmost object; click on empty space clears; shift toggles", () => {
    const t = setup([sq("a"), sq("b", 5, 5)]);
    t.click(7, 7); // overlap: b is on top
    expect(t.st().selectedIds).toEqual(["b"]);
    t.click(1, 1);
    expect(t.st().selectedIds).toEqual(["a"]);
    t.click(2, 2, { shift: true }); // already selected -> toggles it off
    expect(t.st().selectedIds).toEqual([]);
    t.click(1, 1);
    t.click(13, 13, { shift: true });
    expect(t.st().selectedIds).toEqual(["a", "b"]);
    t.click(50, 50);
    expect(t.st().selectedIds).toEqual([]);
  });

  it("box-selects what the marquee touches; shift adds", () => {
    const t = setup([sq("a"), sq("b", 30, 0), sq("c", 60, 0)]);
    t.drag(-5, -5, 35, 12);
    expect(t.st().selectedIds).toEqual(["a", "b"]);
    t.drag(55, -5, 75, 12, { shift: true });
    expect(t.st().selectedIds).toEqual(["a", "b", "c"]);
  });

  it("drags to move, as one undo step; Ctrl locks to an axis", () => {
    const t = setup([sq("a")]);
    t.drag(5, 5, 15, 8);
    expect(objectBox(t.objs()[0])).toMatchObject({ minX: 10, minY: 3 });
    t.core.actions.undo();
    expect(objectBox(t.objs()[0])).toMatchObject({ minX: 0, minY: 0 });
    t.drag(5, 5, 15, 7, { ctrl: true });
    expect(objectBox(t.objs()[0])).toMatchObject({ minX: 10, minY: 0 });
  });

  it("a move drag shows a ghost but changes nothing until release", () => {
    const t = setup([sq("a")]);
    t.c.pointerDown(t.ev(5, 5));
    t.c.pointerMove(t.ev(9, 5));
    expect(objectBox(t.objs()[0])!.minX).toBe(0);
    expect(objectBox(t.c.previewObjects()[0])!.minX).toBe(4);
    t.c.pointerUp(t.ev(9, 5));
    expect(objectBox(t.objs()[0])!.minX).toBe(4);
  });

  it("moves every selected object together; a plain click on one of several narrows to it", () => {
    const t = setup([sq("a"), sq("b", 30, 0)]);
    t.core.actions.setSelection(["a", "b"]);
    t.drag(5, 5, 8, 5);
    expect(objectBox(t.objs()[1])!.minX).toBe(33);
    t.click(34, 1);
    expect(t.st().selectedIds).toEqual(["b"]);
  });

  it("resizes from a corner handle, keeping the aspect ratio; Ctrl inverts the lock", () => {
    const t = setup([sq("a", 0, 0, 10, 10)]);
    t.core.actions.setSelection(["a"]);
    t.drag(10, 10, 20, 15); // se corner, locked: grows to 20 x 20
    let b = objectBox(t.objs()[0])!;
    expect(b.maxX - b.minX).toBeCloseTo(20);
    expect(b.maxY - b.minY).toBeCloseTo(20);
    t.core.actions.undo();
    t.drag(10, 10, 20, 15, { ctrl: true }); // lock inverted: free resize
    b = objectBox(t.objs()[0])!;
    expect(b.maxX - b.minX).toBeCloseTo(20);
    expect(b.maxY - b.minY).toBeCloseTo(15);
  });

  it("an edge handle scales one way about the opposite edge", () => {
    const t = setup([sq("a", 0, 0, 10, 10)]);
    t.core.actions.setAspectLock(false);
    t.core.actions.setSelection(["a"]);
    t.drag(10, 5, 25, 5); // east handle
    const b = objectBox(t.objs()[0])!;
    expect([b.minX, b.maxX, b.minY, b.maxY]).toEqual([0, 25, 0, 10]);
  });

  it("rotates from the rotate handle; Ctrl snaps to 15 degrees", () => {
    const t = setup([sq("a", 0, 0, 10, 10)]);
    t.core.actions.setSelection(["a"]);
    // rotate handle sits 2.6 mm above the top edge at x = 5; drag it round to the right of the centre
    t.drag(5, -2.6, 5 + 9.2, 5 + 3, { ctrl: true }); // ~ +77 deg -> snaps to 75
    const o = t.objs()[0] as FillObject;
    const [x0, y0] = o.geometry.shell[0];
    const ang = (Math.atan2(y0 - 5, x0 - 5) * 180) / Math.PI;
    expect(Math.abs(Math.round(ang) % 15)).toBe(0);
    expect(Math.abs(Math.round(ang) - -135)).toBeGreaterThan(1); // it did rotate
  });

  it("locked objects select but don't move or show handles", () => {
    const t = setup([{ ...sq("a"), locked: true }]);
    t.click(5, 5);
    expect(t.st().selectedIds).toEqual(["a"]);
    expect(t.c.hitHandle(t.ev(10, 10))).toBeNull();
    t.drag(5, 5, 20, 20);
    expect(objectBox(t.objs()[0])).toMatchObject({ minX: 0, minY: 0 });
  });

  it("arrow keys nudge 0.1 mm, Shift 1 mm", () => {
    const t = setup([sq("a")]);
    t.core.actions.setSelection(["a"]);
    t.c.key({ key: "ArrowRight", shift: false, ctrl: false, meta: false, alt: false });
    expect(objectBox(t.objs()[0])!.minX).toBeCloseTo(0.1);
    t.c.key({ key: "ArrowDown", shift: true, ctrl: false, meta: false, alt: false });
    expect(objectBox(t.objs()[0])!.minY).toBeCloseTo(1);
  });

  it("Delete removes the selection; double-click enters reshape; double-click on nothing fits the view", () => {
    const t = setup([sq("a")]);
    t.click(5, 5, { detail: 2 });
    expect(t.st().mode).toBe("reshape");
    t.core.actions.setMode("none");
    t.c.key({ key: "Delete", shift: false, ctrl: false, meta: false, alt: false });
    expect(t.objs()).toHaveLength(0);
    t.click(50, 50, { detail: 2 });
    expect(t.fitted()).toBe(1);
  });

  it("pan tool and middle button drag the view instead", () => {
    const t = setup([sq("a")], "pan");
    t.drag(5, 5, 6, 6);
    expect(t.view().x).toBeCloseTo(10);
    expect(t.st().selectedIds).toEqual([]);
    t.core.actions.setTool("select");
    t.drag(0, 0, 1, 0, { button: 1 });
    expect(t.view().x).toBeCloseTo(20);
  });

  it("holding Space pans with any tool", () => {
    const t = setup([], "closed");
    t.c.setSpace(true);
    t.drag(0, 0, 3, 0);
    expect(t.view().x).toBeCloseTo(30);
    expect(t.objs()).toHaveLength(0);
  });
});

describe("drawing tools", () => {
  it("open shape: clicks add points, Enter finishes a path", () => {
    const t = setup([], "open");
    t.click(0, 0);
    t.click(10, 0);
    t.click(10, 10);
    t.c.key({ key: "Enter", shift: false, ctrl: false, meta: false, alt: false });
    const o = t.objs()[0] as RunObject;
    expect(o.kind).toBe("run");
    expect(o.geometry.closed).toBe(false);
    expect(o.geometry.path).toEqual([[0, 0], [10, 0], [10, 10]]);
    expect(t.st().selectedIds).toEqual([o.id]);
  });

  it("closed shape: Enter closes it into a fill; clicking the first point also closes", () => {
    const t = setup([], "closed");
    t.click(0, 0);
    t.click(10, 0);
    t.click(10, 10);
    t.click(0.2, 0.1); // near the start
    expect(t.objs()).toHaveLength(1);
    const o = t.objs()[0] as FillObject;
    expect(o.kind).toBe("fill");
    expect(o.geometry.shell).toHaveLength(3);
    expect(t.st().tool).toBe("select"); // a finished shape returns to Select
    t.core.actions.setTool("closed");
    t.click(30, 0);
    t.click(40, 0);
    t.click(40, 10);
    t.c.key({ key: "Enter", shift: false, ctrl: false, meta: false, alt: false });
    expect(t.objs()).toHaveLength(2);
  });

  it("right-click and double-click make curve points", () => {
    const t = setup([], "open");
    t.click(0, 0);
    t.click(10, 10, { button: 2 });
    t.click(20, 0, { detail: 1 });
    t.click(20, 0, { detail: 2 });
    t.c.key({ key: "Enter", shift: false, ctrl: false, meta: false, alt: false });
    const o = t.objs()[0] as RunObject;
    expect(o.geometry.nodes!.map((n) => !!n.curve)).toEqual([false, true, true]);
    expect(o.geometry.path.length).toBeGreaterThan(10); // the curve is flattened into many points
  });

  it("Ctrl constrains the next segment to a 15 degree step", () => {
    const t = setup([], "open");
    t.click(0, 0);
    t.click(10, 2.2, { ctrl: true }); // ~12.4 deg -> 15 deg
    t.c.key({ key: "Enter", shift: false, ctrl: false, meta: false, alt: false });
    const [, p1] = (t.objs()[0] as RunObject).geometry.path;
    expect((Math.atan2(p1[1], p1[0]) * 180) / Math.PI).toBeCloseTo(15, 5);
  });

  it("Escape cancels, Backspace removes the last point, one point is not a shape", () => {
    const t = setup([], "open");
    t.click(0, 0);
    t.click(10, 0);
    t.click(20, 0);
    t.c.key({ key: "Backspace", shift: false, ctrl: false, meta: false, alt: false });
    t.c.key({ key: "Enter", shift: false, ctrl: false, meta: false, alt: false });
    expect((t.objs()[0] as RunObject).geometry.path).toHaveLength(2);
    t.click(0, 30);
    t.c.key({ key: "Escape", shift: false, ctrl: false, meta: false, alt: false });
    t.click(5, 30);
    t.c.key({ key: "Enter", shift: false, ctrl: false, meta: false, alt: false });
    expect(t.objs()).toHaveLength(1); // the single point never became anything
  });

  it("rectangle drags a box; Ctrl makes a square", () => {
    const t = setup([], "rect");
    t.drag(0, 0, 20, 10);
    expect(objectBox(t.objs()[0])).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 10 });
    t.core.actions.setTool("rect");
    t.drag(30, 0, 50, 10, { ctrl: true });
    expect(objectBox(t.objs()[1])).toEqual({ minX: 30, minY: 0, maxX: 50, maxY: 20 });
  });

  it("circle drags an ellipse box; Ctrl makes it round; a tiny drag makes nothing", () => {
    const t = setup([], "circle");
    t.drag(0, 0, 20, 10);
    const e = objectBox(t.objs()[0])!;
    expect(e.maxX - e.minX).toBeCloseTo(20, 0);
    expect(e.maxY - e.minY).toBeCloseTo(10, 0);
    t.core.actions.setTool("circle");
    t.drag(40, 0, 60, 10, { ctrl: true });
    const c = objectBox(t.objs()[1])!;
    expect(c.maxX - c.minX).toBeCloseTo(c.maxY - c.minY, 0);
    t.core.actions.setTool("circle");
    t.drag(0, 0, 0.01, 0.01);
    expect(t.objs()).toHaveLength(2);
  });

  it("pen smooths a freehand stroke into a few curve nodes; ending near the start closes it", () => {
    const t = setup([], "pen");
    t.c.pointerDown(t.ev(0, 0));
    for (let i = 1; i <= 40; i++) t.c.pointerMove(t.ev(i, Math.sin(i / 6) * 3 + (i % 2 ? 0.02 : -0.02)));
    t.c.pointerUp(t.ev(40, 0));
    const run = t.objs()[0] as RunObject;
    expect(run.kind).toBe("run");
    expect(run.geometry.nodes!.length).toBeLessThan(25);
    // a closed loop
    t.core.actions.setTool("pen");
    t.c.pointerDown(t.ev(10, 20));
    for (let k = 1; k <= 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      t.c.pointerMove(t.ev(5 * Math.cos(a) + 5 - 5 + 5, 20 + 5 * Math.sin(a)));
    }
    t.c.pointerUp(t.ev(10, 20));
    expect(t.objs()[1].kind).toBe("fill");
  });

  it("satin blocks: left, right, left, right ... Enter makes a column of rungs", () => {
    const t = setup([], "satin");
    for (const [x, y] of [[0, 0], [0, 4], [10, 0], [10, 4], [20, 0], [20, 4]]) t.click(x, y);
    t.c.key({ key: "Enter", shift: false, ctrl: false, meta: false, alt: false });
    const o = t.objs()[0] as SatinObject;
    expect(o.kind).toBe("satin");
    expect(o.geometry.strip).toHaveLength(6);
  });

  it("manual stitch: each click is one needle point", () => {
    const t = setup([], "manual");
    for (const [x, y] of [[0, 0], [2, 1], [5, 0]]) t.click(x, y);
    t.c.key({ key: "Enter", shift: false, ctrl: false, meta: false, alt: false });
    const o = t.objs()[0] as RunObject;
    expect(o.params.type).toBe("manual");
    expect(o.geometry.path).toEqual([[0, 0], [2, 1], [5, 0]]);
  });

  it("measure: drag reads out the distance and keeps it until the next drag", () => {
    const t = setup([], "measure");
    t.drag(0, 0, 30, 40);
    expect(t.c.getSnapshot().measure).toEqual({ a: [0, 0], b: [30, 40] });
    t.c.clearMeasure();
    expect(t.c.getSnapshot().measure).toBeNull();
  });

  it("the text tool is a stub: it exists but does nothing yet", () => {
    const t = setup([], "text");
    t.click(5, 5);
    expect(t.objs()).toHaveLength(0);
  });

  it("new shapes use the active thread and add it to the design", () => {
    const t = setup([], "rect");
    const pink = { id: "pink", brand: "X", code: "9", name: "Pink", hex: "#ff66aa" };
    t.core.actions.setThread(pink.id);
    t.core.store.setState((s) => ({ design: { ...s.design!, threads: [...s.design!.threads, pink] } }));
    t.drag(0, 0, 10, 10);
    expect(t.objs()[0].threadId).toBe("pink");
  });
});

describe("shape actions", () => {
  it("reshape: drag a node, insert on an edge, delete a node, toggle curve", () => {
    const t = setup([sq("a")]);
    t.core.actions.setSelection(["a"]);
    t.core.actions.setMode("reshape");
    t.drag(10, 10, 14, 14); // drag the se node
    expect((t.objs()[0] as FillObject).geometry.shell[2]).toEqual([14, 14]);
    t.drag(7, 0, 7, -3); // grab the top edge: inserts a node there and drags it
    expect((t.objs()[0] as FillObject).geometry.shell).toHaveLength(5);
    expect((t.objs()[0] as FillObject).geometry.shell[1]).toEqual([7, -3]);
    // delete the selected node
    t.c.key({ key: "Delete", shift: false, ctrl: false, meta: false, alt: false });
    expect((t.objs()[0] as FillObject).geometry.shell).toHaveLength(4);
    // toggle curve with a double-click on a node
    t.click(0, 0, { detail: 2 });
    expect((t.objs()[0] as FillObject).geometry.shellNodes![0].curve).toBe(true);
    t.core.actions.undo();
    expect((t.objs()[0] as FillObject).geometry.shellNodes![0].curve).toBeFalsy();
  });

  it("reshape drag is a single undo step", () => {
    const t = setup([sq("a")]);
    t.core.actions.setSelection(["a"]);
    t.core.actions.setMode("reshape");
    t.drag(10, 10, 14, 14);
    t.core.actions.undo();
    expect((t.objs()[0] as FillObject).geometry.shell[2]).toEqual([10, 10]);
  });

  it("knife: drag a line across the selection to split it", async () => {
    const t = setup([sq("a", 0, 0, 20, 10)]);
    t.core.actions.setSelection(["a"]);
    t.core.actions.setMode("knife");
    t.drag(10, -3, 10, 13);
    await vi.waitFor(() => expect(t.objs()).toHaveLength(2), { timeout: 10_000 });
    expect(t.st().mode).toBe("none");
  });

  it("cut holes: draw a closed shape inside the selected fill", async () => {
    const t = setup([sq("a", 0, 0, 30, 30)]);
    t.core.actions.setSelection(["a"]);
    t.core.actions.setMode("hole");
    t.click(5, 5);
    t.click(15, 5);
    t.click(15, 15);
    t.c.key({ key: "Enter", shift: false, ctrl: false, meta: false, alt: false });
    await vi.waitFor(() => expect((t.objs()[0] as FillObject).geometry.holes).toHaveLength(1), { timeout: 10_000 });
  });

  it("set start / end point: the next click places the marker; markers can be dragged", () => {
    const t = setup([sq("a")]);
    t.core.actions.setSelection(["a"]);
    t.core.actions.setMode("setStart");
    t.click(2, 2);
    expect(t.objs()[0].startPoint).toEqual([2, 2]);
    expect(t.st().mode).toBe("none");
    t.drag(2, 2, 6, 3);
    expect(t.objs()[0].startPoint).toEqual([6, 3]);
    t.core.actions.setMode("setEnd");
    t.click(8, 8);
    expect(t.objs()[0].endPoint).toEqual([8, 8]);
  });

  it("edit stitch angle: the dial sets the angle live, Ctrl snaps to 15 degrees", () => {
    const t = setup([sq("a")]);
    t.core.actions.setSelection(["a"]);
    t.core.actions.setMode("angle");
    t.c.pointerDown(t.ev(5, 5)); // at the centre: any angle, but then move to the right of it
    t.c.pointerMove(t.ev(15, 5));
    expect((t.objs()[0] as FillObject).params.angleDeg).toBe(0);
    t.c.pointerMove(t.ev(15, 9, { ctrl: true })); // ~ 21.8 deg -> 15
    t.c.pointerUp(t.ev(15, 9, { ctrl: true }));
    expect((t.objs()[0] as FillObject).params.angleDeg).toBe(15);
    t.core.actions.undo(); // the whole drag is one step
    expect((t.objs()[0] as FillObject).params.angleDeg).toBe(45);
  });

  it("a reference image can be dragged when it is unlocked", () => {
    const t = setup([]);
    t.core.store.setState({ refImages: [{ id: "i1", name: "i", src: {} as HTMLCanvasElement, w: 100, h: 50, x: 0, y: 0, widthMm: 40, opacity: 0.5, locked: false, visible: true }] });
    t.drag(10, 10, 15, 12);
    expect(t.st().refImages[0]).toMatchObject({ x: 5, y: 2 });
    t.core.actions.updateRefImage("i1", { locked: true });
    t.drag(10, 10, 15, 12);
    expect(t.st().refImages[0]).toMatchObject({ x: 5, y: 2 });
  });

  it("map-to-path: pickPath mode takes a drawn open path for the draft", () => {
    const t = setup([sq("a")]);
    t.core.actions.setSelection(["a"]);
    t.core.actions.openMapDraft();
    t.core.actions.setMode("pickPath");
    t.click(0, 30);
    t.click(30, 30);
    t.c.key({ key: "Enter", shift: false, ctrl: false, meta: false, alt: false });
    expect(t.st().mapDraft!.path).toEqual([[0, 30], [30, 30]]);
    expect(t.objs()).toHaveLength(1); // the path isn't added as an object
  });
});
