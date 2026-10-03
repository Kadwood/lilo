import { afterEach, describe, expect, it, vi } from "vitest";
import { toDesignThread, getCatalogue, type TraceRegion } from "@lilo/engine/light";
import { initVtracerNode } from "@lilo/engine/node";
import { badge } from "../../../engine/test/fixtures/fixtures";
import { createInlineEngine } from "../engine/client";
import { createEditorStore, type EditorStore } from "../state/editorStore";
import { CanvasController, type PointerInput } from "./controller";
import type { View } from "./viewport";

// no canvas in node: the "decoded" picture is the engine's badge fixture
vi.mock("../io/decode", async (orig) => {
  const real = await orig<typeof import("../io/decode")>();
  const { badge: make } = await import("../../../engine/test/fixtures/fixtures");
  return { ...real, decodeFile: vi.fn(async () => ({ kind: "raster", image: make(), reference: null })) };
});

const stores: EditorStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
});

const cat = getCatalogue().threads;
const RED = toDesignThread(cat.find((t) => t.name === "Red")!);
const BLUE = toDesignThread(cat.find((t) => t.name === "Blue")!);
const square = (id: string, x: number, y: number, size: number, thread = RED, holes: TraceRegion["holes"] = []): TraceRegion => ({
  id,
  hex: thread.hex,
  thread,
  shell: [[x, y], [x + size, y], [x + size, y + size], [x, y + size]],
  holes,
  areaMm2: size * size,
  box: { minX: x, minY: y, maxX: x + size, maxY: y + size },
});

/** 10 px per mm; pointer coordinates are mm * 10. */
function setup(regions: TraceRegion[]) {
  const core = createEditorStore(createInlineEngine());
  stores.push(core);
  core.store.setState({ tool: "clickstitch", trace: { regions, svg: "", source: "test.png" } });
  let view: View = { x: 0, y: 0, zoom: 10 };
  const c = new CanvasController({ api: core.store, actions: core.actions, getView: () => view, setView: (v) => (view = v), fit: () => {} });
  const ev = (x: number, y: number, o: Partial<PointerInput> = {}): PointerInput => ({ x: x * 10, y: y * 10, button: 0, shift: false, ctrl: false, alt: false, detail: 1, ...o });
  const st = () => core.store.getState();
  const click = (x: number, y: number, o: Partial<PointerInput> = {}) => {
    c.pointerDown(ev(x, y, o));
    c.pointerUp(ev(x, y, o));
  };
  const key = (k: string) => c.key({ key: k, shift: false, ctrl: false, meta: false, alt: false });
  return { core, c, st, ev, click, key, objs: () => st().design?.objects ?? [] };
}

describe("click to stitch: hover, click, shift-click, Esc", () => {
  const regions = [square("r1", 0, 0, 10), square("r2", 20, 0, 10, BLUE), square("r3", 0, 20, 10, RED, [[[3, 23], [7, 23], [7, 27], [3, 27]]])];

  it("hovering highlights the region under the cursor and nothing over empty space or a hole", () => {
    const t = setup(regions);
    t.c.pointerMove({ x: 50, y: 50, ctrl: false, shift: false });
    expect(t.c.getSnapshot().hoverRegion).toBe("r1");
    t.c.pointerMove({ x: 250, y: 50, ctrl: false, shift: false });
    expect(t.c.getSnapshot().hoverRegion).toBe("r2");
    t.c.pointerMove({ x: 150, y: 50, ctrl: false, shift: false });
    expect(t.c.getSnapshot().hoverRegion).toBeNull();
    t.c.pointerMove({ x: 50, y: 250, ctrl: false, shift: false }); // inside r3's hole
    expect(t.c.getSnapshot().hoverRegion).toBeNull();
  });

  it("a click stitches the region with the chosen settings, in its own thread, as one undo step", () => {
    const t = setup(regions);
    t.core.actions.setStitchSettings({ fill: { ...t.st().stitchSettings.fill, angleDeg: 20, pattern: "waves" } });
    t.click(5, 5);
    expect(t.objs()).toHaveLength(1);
    const o = t.objs()[0];
    expect(o.kind).toBe("fill");
    expect(o.kind === "fill" && o.params.angleDeg).toBe(20);
    expect(o.kind === "fill" && o.params.pattern).toBe("waves");
    expect(o.threadId).toBe(RED.id);
    expect(t.st().design!.threads.map((x) => x.id)).toContain(RED.id);
    expect(t.st().undoLabel).toBe("Stitch region");
    t.click(25, 5);
    expect(t.objs()).toHaveLength(2);
    t.core.actions.undo(); // only the second click
    expect(t.objs().map((x) => x.threadId)).toEqual([RED.id]);
    t.core.actions.undo();
    expect(t.objs()).toHaveLength(0);
    t.core.actions.redo();
    expect(t.objs()).toHaveLength(1);
    expect(t.st().tool).toBe("clickstitch"); // the tool stays on for the next click
  });

  it("outline style makes closed runs (the shell and each hole) with the run settings", () => {
    const t = setup(regions);
    t.core.actions.setStitchSettings({ style: "outline", run: { stitchLengthMm: 1.5, repeats: 3, type: "triple" } });
    t.click(1, 21);
    expect(t.objs().map((o) => o.kind)).toEqual(["run", "run"]);
    expect(t.objs().every((o) => o.kind === "run" && o.geometry.closed && o.params.type === "triple" && o.params.stitchLengthMm === 1.5)).toBe(true);
    expect(t.st().undoLabel).toBe("Stitch region");
    t.core.actions.undo();
    expect(t.objs()).toHaveLength(0);
  });

  it("a thread override replaces the traced colour", () => {
    const t = setup(regions);
    t.core.actions.setStitchSettings({ thread: BLUE });
    t.click(5, 5);
    expect(t.objs()[0].threadId).toBe(BLUE.id);
  });

  it("shift-click collects regions; Enter stitches them in one undo step", () => {
    const t = setup(regions);
    t.click(5, 5, { shift: true });
    t.click(25, 5, { shift: true });
    expect(t.st().pendingRegions).toEqual(["r1", "r2"]);
    expect(t.objs()).toHaveLength(0);
    t.click(5, 5, { shift: true }); // shift-click again takes it back out
    expect(t.st().pendingRegions).toEqual(["r2"]);
    t.click(5, 5, { shift: true });
    expect(t.key("Enter")).toBe(true);
    expect(t.objs()).toHaveLength(2);
    expect(t.st().pendingRegions).toEqual([]);
    expect(t.st().undoLabel).toBe("Stitch 2 regions");
    t.core.actions.undo();
    expect(t.objs()).toHaveLength(0);
  });

  it("Esc drops the batch first, then leaves the tool", () => {
    const t = setup(regions);
    t.click(5, 5, { shift: true });
    expect(t.key("Escape")).toBe(true);
    expect(t.st().pendingRegions).toEqual([]);
    expect(t.st().tool).toBe("clickstitch");
    expect(t.key("Escape")).toBe(true);
    expect(t.st().tool).toBe("select");
  });

  it("right-click and clicks on empty space do nothing", () => {
    const t = setup(regions);
    t.click(5, 5, { button: 2 });
    t.click(15, 5);
    expect(t.objs()).toHaveLength(0);
  });

  it("undoing a stitched region frees it to be clicked again; clearing is one undo step", () => {
    const t = setup(regions);
    t.click(5, 5);
    expect(Object.keys(t.st().regionObjects)).toEqual(["r1"]);
    t.core.actions.clearStitches();
    expect(t.objs()).toHaveLength(0);
    expect(t.st().undoLabel).toBe("Clear all stitches");
    t.core.actions.undo();
    expect(t.objs()).toHaveLength(1);
  });
});

describe("click to stitch shares the trace with Auto digitize", () => {
  it("one digitize gives both the automatic design and clickable regions that stitch into valid objects", async () => {
    const digitize = vi.fn();
    const inline = createInlineEngine(() => initVtracerNode());
    const engine = { ...inline, digitize: (...a: Parameters<typeof inline.digitize>) => (digitize(), inline.digitize(...a)) };
    const core = createEditorStore(engine);
    stores.push(core);
    await core.actions.importFile({ name: "badge.png", bytes: new Uint8Array(4) });
    const s0 = core.store.getState();
    expect(s0.design!.objects.length).toBeGreaterThan(2);
    expect(s0.trace!.regions.length).toBeGreaterThan(2);
    expect(s0.regionObjects).toEqual({});

    core.actions.setTool("clickstitch");
    core.actions.clearStitches();
    expect(core.store.getState().design!.objects).toHaveLength(0);
    const big = [...s0.trace!.regions].sort((a, b) => b.areaMm2 - a.areaMm2)[0];
    core.actions.stitchRegions([big.id]);
    const d = core.store.getState().design!;
    expect(d.objects.length).toBe(1);
    expect(d.objects[0].threadId).toBe(big.thread.id);
    await vi.waitFor(() => expect(core.store.getState().planResult!.stats.stitchCount).toBeGreaterThan(100), { timeout: 20_000 });
    // no re-trace happened for any of that
    expect(digitize).toHaveBeenCalledTimes(1);
    void badge;
  }, 60_000);
});
