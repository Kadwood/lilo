// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Design, DesignObject } from "@lilo/engine/light";
import { lastEditor, renderEditor, testDesign } from "../test/helpers";
import { BeforeYouSew } from "../sewing/BeforeYouSew";
import { Sequencer } from "./Sequencer";

// jsdom can't decode images; hand the store a canvas-like source for reference images.
vi.mock("../io/decode", async (orig) => {
  const real = await orig<typeof import("../io/decode")>();
  return {
    ...real,
    decodeFile: vi.fn(async (f: { name: string }) => ({ kind: "raster", image: { width: 100, height: 50, data: new Uint8ClampedArray(100 * 50 * 4) }, reference: { width: 100, height: 50, name: f.name } })),
  };
});
vi.mock("../platform", async (orig) => {
  const real = await orig<typeof import("../platform")>();
  return { ...real, getPlatform: () => ({ ...real.getPlatform(), openFile: async () => ({ name: "ref.png", bytes: new Uint8Array(4) }) }) };
});

afterEach(cleanup);
const T = { timeout: 20_000 };
const loaded = () => waitFor(() => expect(lastEditor?.state.planResult).not.toBeNull(), T);
const rowNames = () => [...document.querySelectorAll("li.seq-row")].map((li) => li.querySelector(".seq-name")?.textContent);
const layerNames = () => [...document.querySelectorAll(".layer-head .seq-name")].map((e) => e.textContent);
const layersOf = () => lastEditor!.state.design!.layers!;
const ids = () => lastEditor!.state.design!.objects.map((o) => o.id);
const layerOfObj = (id: string) => lastEditor!.state.design!.objects.find((o) => o.id === id)!.layerId;

/** testDesign (Frame, Line, Bar) split over layers "Back" (bottom: Frame, Line) and "Front" (top: Bar). */
function twoLayerDesign(): Design {
  const d = testDesign();
  const objects = d.objects.map((o, i) => ({ ...o, layerId: i < 2 ? "back" : "front" })) as DesignObject[];
  return {
    ...d,
    objects,
    layers: [
      { id: "back", name: "Back", kind: "stitch", visible: true, locked: false },
      { id: "front", name: "Front", kind: "stitch", visible: true, locked: false },
    ],
  };
}
const dt = { setData: () => {}, effectAllowed: "" } as unknown as DataTransfer;

describe("Layers panel", () => {
  it("shows the banner, the top layer first, and each layer's sew range", async () => {
    renderEditor(<Sequencer />, { design: twoLayerDesign() });
    await loaded();
    expect(screen.getByText("Bottom sews first. Top sews last and sits on top.")).toBeTruthy();
    expect(layerNames()).toEqual(["Front", "Back"]); // top of the list = the layer that sews last
    expect(screen.getByText("sews 3")).toBeTruthy();
    expect(screen.getByText("sews 1–2")).toBeTruthy();
    expect(screen.getAllByRole("tree")).toHaveLength(1);
    expect(screen.getAllByRole("treeitem", { name: /layer/ }).length).toBe(2);
  });

  it("an old design gets a Stitches layer when it loads", async () => {
    renderEditor(<Sequencer />, { design: testDesign() });
    await loaded();
    expect(layerNames()).toEqual(["Stitches"]);
    expect(lastEditor!.state.design!.objects.every((o) => o.layerId === "layer-stitches")).toBe(true);
  });

  it("numbers the shapes in sew order", async () => {
    renderEditor(<Sequencer />, { design: twoLayerDesign() });
    await loaded();
    const nums = [...document.querySelectorAll("li.seq-row")].map((li) => li.querySelector(".seq-num")!.textContent);
    expect(rowNames()).toEqual(["Bar", "Line", "Frame"]);
    expect(nums).toEqual(["3", "2", "1"]);
  });

  it("adds layers above the selected one and makes them the active layer", async () => {
    renderEditor(<Sequencer />, { design: twoLayerDesign() });
    await loaded();
    fireEvent.click(screen.getByText("Back"));
    fireEvent.click(screen.getByRole("button", { name: "New stitch layer" }));
    expect(layersOf().map((l) => l.name)).toEqual(["Back", "Stitches", "Front"]);
    expect(lastEditor!.state.activeLayerId).toBe(layersOf()[1].id);
    act(() => lastEditor!.actions.undo());
    expect(layersOf().map((l) => l.name)).toEqual(["Back", "Front"]);
  });

  it("new shapes land in the active layer", async () => {
    renderEditor(<Sequencer />, { design: twoLayerDesign() });
    await loaded();
    fireEvent.click(screen.getByText("Back"));
    const t = lastEditor!.state.design!.threads[0].id;
    act(() =>
      lastEditor!.actions.addObjects(
        [{ id: "n1", name: "New", kind: "run", threadId: t, geometry: { path: [[0, 0], [5, 5]], closed: false }, params: { stitchLengthMm: 2.5, repeats: 1 } }],
        "Add",
      ),
    );
    expect(layerOfObj("n1")).toBe("back");
    expect(ids()).toEqual(["f1", "r1", "n1", "s1"]); // still grouped by layer, bottom layer first
  });

  it("renames a layer by double-click and Enter; it is undoable", async () => {
    renderEditor(<Sequencer />, { design: twoLayerDesign() });
    await loaded();
    fireEvent.doubleClick(screen.getByText("Front"));
    const input = screen.getByLabelText("Rename layer Front");
    fireEvent.change(input, { target: { value: "Details" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(layerNames()).toEqual(["Details", "Back"]);
    act(() => lastEditor!.actions.undo());
    expect(layerNames()).toEqual(["Front", "Back"]);
  });

  it("moving a layer up sews it later: its shapes follow, and the sew order flips", async () => {
    renderEditor(<Sequencer />, { design: twoLayerDesign() });
    await loaded();
    fireEvent.click(screen.getByLabelText("Move layer Back up"));
    expect(layersOf().map((l) => l.id)).toEqual(["front", "back"]);
    expect(ids()).toEqual(["s1", "f1", "r1"]);
    await waitFor(() => {
      const objectIndexes = lastEditor!.state.planResult!.plan.stitches.filter((s) => s.objectIndex >= 0).map((s) => s.objectIndex);
      expect(objectIndexes[0]).toBe(0); // Bar (now the bottom layer) is sewn first
    }, T);
    act(() => lastEditor!.actions.undo());
    expect(ids()).toEqual(["f1", "r1", "s1"]);
  });

  it("drags a shape onto another layer: one undo step puts it back", async () => {
    renderEditor(<Sequencer />, { design: twoLayerDesign() });
    await loaded();
    const bar = screen.getByText("Bar").closest("li")!;
    const back = screen.getByText("Back").closest(".layer-head")!;
    fireEvent.dragStart(bar, { dataTransfer: dt });
    await act(async () => {
      fireEvent.dragOver(back, { dataTransfer: dt });
      fireEvent.drop(back, { dataTransfer: dt });
    });
    expect(layerOfObj("s1")).toBe("back");
    expect(ids()).toEqual(["f1", "r1", "s1"]); // end of the Back layer: it sews last in it
    act(() => lastEditor!.actions.undo());
    expect(layerOfObj("s1")).toBe("front");
  });

  it("hides a layer: it stays in the list, leaves the plan, and the plan warns", async () => {
    renderEditor(<Sequencer />, { design: twoLayerDesign() });
    await loaded();
    const before = lastEditor!.state.planResult!.stats.stitchCount;
    fireEvent.click(screen.getByLabelText("Hide layer Front"));
    await waitFor(() => expect(lastEditor!.state.planResult!.stats.stitchCount).toBeLessThan(before), T);
    const warning = lastEditor!.state.planResult!.warnings.find((w) => w.code === "hidden-layer");
    expect(warning?.message).toBe("1 layer is hidden — it won't be sewn: Front");
    expect(screen.getByText("hidden, not sewn")).toBeTruthy();
    expect(screen.getByLabelText("Show layer Front")).toBeTruthy();
    // the hidden layer's objects are not drawn or sewn but keep their own switches
    expect(lastEditor!.state.design!.objects.find((o) => o.id === "s1")!.visible).toBeUndefined();
    act(() => lastEditor!.actions.undo());
    await waitFor(() => expect(lastEditor!.state.planResult!.stats.stitchCount).toBe(before), T);
  });

  it("Before you sew says a layer is hidden", async () => {
    renderEditor(<BeforeYouSew />, { design: twoLayerDesign() });
    await loaded();
    expect(screen.queryByText(/is hidden/)).toBeNull();
    act(() => lastEditor!.actions.setLayerVisible("front", false));
    await waitFor(() => expect(screen.getByText("1 layer is hidden — it won't be sewn: Front")).toBeTruthy(), T);
  });

  it("locks a layer: select-all skips it, and moves and deletes leave it alone", async () => {
    renderEditor(<Sequencer />, { design: twoLayerDesign() });
    await loaded();
    fireEvent.click(screen.getByLabelText("Lock layer Front"));
    expect(layersOf()[1].locked).toBe(true);
    act(() => lastEditor!.actions.selectAll());
    expect(lastEditor!.state.selectedIds).toEqual(["f1", "r1"]);
    const bar = () => JSON.stringify(lastEditor!.state.design!.objects.find((o) => o.id === "s1")!.geometry);
    const was = bar();
    act(() => lastEditor!.actions.transformObjects(["s1", "f1"], [1, 0, 0, 1, 5, 5], "Move"));
    expect(bar()).toBe(was);
    act(() => {
      lastEditor!.actions.setSelection(["s1"]);
      lastEditor!.actions.deleteSelection();
    });
    expect(ids()).toContain("s1");
  });

  it("merges a layer down: the sew order does not change", async () => {
    renderEditor(<Sequencer />, { design: twoLayerDesign() });
    await loaded();
    fireEvent.click(screen.getByText("Front"));
    fireEvent.click(screen.getByRole("button", { name: "Merge down" }));
    expect(layersOf().map((l) => l.id)).toEqual(["back"]);
    expect(ids()).toEqual(["f1", "r1", "s1"]);
    expect(lastEditor!.state.design!.objects.every((o) => o.layerId === "back")).toBe(true);
    act(() => lastEditor!.actions.undo());
    expect(layersOf()).toHaveLength(2);
  });

  it("merging a hidden layer keeps its shapes hidden", async () => {
    const d = twoLayerDesign();
    d.layers![1].visible = false;
    renderEditor(<Sequencer />, { design: d });
    await loaded();
    act(() => lastEditor!.actions.mergeLayerDown("front"));
    expect(lastEditor!.state.design!.objects.find((o) => o.id === "s1")!.visible).toBe(false);
  });

  it("asks before deleting a layer that has things in it, and deletes an empty one straight away", async () => {
    renderEditor(<Sequencer />, { design: twoLayerDesign() });
    await loaded();
    fireEvent.click(screen.getByText("Front"));
    fireEvent.click(screen.getByRole("button", { name: "Delete layer" }));
    const ask = screen.getByRole("alertdialog");
    expect(ask.textContent).toMatch(/Delete Front and the 1 shape/);
    fireEvent.click(within(ask).getByRole("button", { name: "Keep it" }));
    expect(layersOf()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Delete layer" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    expect(layersOf().map((l) => l.id)).toEqual(["back"]);
    expect(ids()).toEqual(["f1", "r1"]);
    act(() => lastEditor!.actions.undo());
    expect(ids()).toEqual(["f1", "r1", "s1"]);
    // an empty layer goes without a question
    fireEvent.click(screen.getByRole("button", { name: "New stitch layer" }));
    const n = layersOf().length;
    fireEvent.click(screen.getByRole("button", { name: "Delete layer" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(layersOf().length).toBe(n - 1);
  });

  it("a picture goes into the selected picture layer, and the layer's opacity multiplies the picture's", async () => {
    renderEditor(<Sequencer />, { design: twoLayerDesign() });
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "New picture layer" }));
    const pic = layersOf().find((l) => l.kind === "picture")!;
    expect(lastEditor!.state.activeLayerId).toBe(pic.id);
    await act(() => lastEditor!.actions.addRefImage({ name: "ref.png", bytes: new Uint8Array(4) }));
    expect(lastEditor!.state.design!.images![0].layerId).toBe(pic.id);
    // the picture layer sits above Front, so the order is back, front, picture
    expect(layersOf().map((l) => l.kind)).toEqual(["stitch", "stitch", "picture"]);
    const slider = screen.getByLabelText(`${pic.name} opacity`);
    fireEvent.change(slider, { target: { value: "0.5" } });
    expect(layersOf().find((l) => l.id === pic.id)!.opacity).toBe(0.5);
    expect(lastEditor!.state.refImages[0].layerOpacity).toBe(0.5);
    expect(lastEditor!.state.refImages[0].opacity).toBe(0.6);
    // dragging the slider is one undo step
    fireEvent.change(slider, { target: { value: "0.3" } });
    act(() => lastEditor!.actions.undo());
    expect(layersOf().find((l) => l.id === pic.id)!.opacity).toBeUndefined();
  });

  it("a hidden picture layer hides its pictures and does not change the stitches", async () => {
    renderEditor(<Sequencer />, { design: twoLayerDesign() });
    await loaded();
    await act(() => lastEditor!.actions.addRefImage({ name: "ref.png", bytes: new Uint8Array(4) }));
    const pic = layersOf().find((l) => l.kind === "picture")!;
    const stitches = lastEditor!.state.planResult!.stats.stitchCount;
    fireEvent.click(screen.getByLabelText(`Hide layer ${pic.name}`));
    expect(lastEditor!.state.refImages[0].layerVisible).toBe(false);
    await new Promise((r) => setTimeout(r, 300));
    expect(lastEditor!.state.planResult!.stats.stitchCount).toBe(stitches);
    expect(lastEditor!.state.planResult!.warnings.some((w) => w.code === "hidden-layer")).toBe(false);
  });

  it("pictures cannot be dropped into a stitch layer", async () => {
    renderEditor(<Sequencer />, { design: twoLayerDesign() });
    await loaded();
    await act(() => lastEditor!.actions.addRefImage({ name: "ref.png", bytes: new Uint8Array(4) }));
    const img = lastEditor!.state.design!.images![0];
    act(() => lastEditor!.actions.moveImageToLayer(img.id, "front"));
    expect(lastEditor!.state.design!.images![0].layerId).toBe(layersOf().find((l) => l.kind === "picture")!.id);
    act(() => lastEditor!.actions.moveObjectsToLayer(["s1"], layersOf().find((l) => l.kind === "picture")!.id));
    expect(layerOfObj("s1")).toBe("front");
  });
});

describe("Layers panel: keyboard", () => {
  const item = (name: RegExp | string) => screen.getByRole("treeitem", { name });

  it("arrow keys move between rows, Right and Left open and close a layer", async () => {
    renderEditor(<Sequencer />, { design: twoLayerDesign() });
    await loaded();
    const front = item("Stitch layer Front");
    front.focus();
    fireEvent.keyDown(front, { key: "ArrowDown" });
    expect(document.activeElement!.getAttribute("data-key")).toBe("obj:s1");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" }); // from a child: back to its layer
    expect(document.activeElement).toBe(front);
    fireEvent.keyDown(front, { key: "ArrowLeft" }); // collapse
    expect(front.getAttribute("aria-expanded")).toBe("false");
    expect(rowNames()).toEqual(["Line", "Frame"]);
    fireEvent.keyDown(front, { key: "ArrowRight" });
    expect(front.getAttribute("aria-expanded")).toBe("true");
  });

  it("Alt+arrow moves a layer, one undo step", async () => {
    renderEditor(<Sequencer />, { design: twoLayerDesign() });
    await loaded();
    const back = item("Stitch layer Back");
    back.focus();
    fireEvent.keyDown(back, { key: "ArrowUp", altKey: true });
    expect(layersOf().map((l) => l.id)).toEqual(["front", "back"]);
    expect(screen.getByRole("status").textContent).toMatch(/Moved layer Back up/);
    expect(document.activeElement!.getAttribute("data-key")).toBe("layer:back"); // focus stays on the moved layer
    act(() => lastEditor!.actions.undo());
    expect(layersOf().map((l) => l.id)).toEqual(["back", "front"]);
  });

  it("Alt+arrow moves a shape inside its layer and stops at the edge", async () => {
    renderEditor(<Sequencer />, { design: twoLayerDesign() });
    await loaded();
    const frame = [...document.querySelectorAll<HTMLElement>("[data-key='obj:f1']")][0];
    frame.focus();
    fireEvent.keyDown(frame, { key: "ArrowUp", altKey: true });
    expect(ids()).toEqual(["r1", "f1", "s1"]);
    const again = [...document.querySelectorAll<HTMLElement>("[data-key='obj:f1']")][0];
    fireEvent.keyDown(again, { key: "ArrowUp", altKey: true }); // already the last sewn in Back
    expect(ids()).toEqual(["r1", "f1", "s1"]);
    act(() => lastEditor!.actions.undo());
    expect(ids()).toEqual(["f1", "r1", "s1"]);
  });

  it("Space shows or hides the focused row; L locks a layer; Enter selects", async () => {
    renderEditor(<Sequencer />, { design: twoLayerDesign() });
    await loaded();
    const front = item("Stitch layer Front");
    front.focus();
    fireEvent.keyDown(front, { key: " " });
    expect(layersOf()[1].visible).toBe(false);
    fireEvent.keyDown(front, { key: "l" });
    expect(layersOf()[1].locked).toBe(true);
    const bar = document.querySelector<HTMLElement>("[data-key='obj:s1']")!;
    fireEvent.keyDown(bar, { key: " " });
    expect(lastEditor!.state.design!.objects.find((o) => o.id === "s1")!.visible).toBe(false);
    fireEvent.keyDown(bar, { key: "Enter" });
    expect(lastEditor!.state.selectedId).toBe("s1");
  });

  it("only one row is in the tab order, and rows have tree roles", async () => {
    renderEditor(<Sequencer />, { design: twoLayerDesign() });
    await loaded();
    const tabbable = [...document.querySelectorAll("[role=treeitem]")].filter((e) => e.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(screen.getByRole("tree").getAttribute("aria-label")).toMatch(/Layers/);
    expect(document.querySelectorAll("[role=group]").length).toBeGreaterThan(0);
  });

  it("F2 renames the focused layer", async () => {
    renderEditor(<Sequencer />, { design: twoLayerDesign() });
    await loaded();
    const back = item("Stitch layer Back");
    back.focus();
    fireEvent.keyDown(back, { key: "F2" });
    expect(screen.getByLabelText("Rename layer Back")).toBeTruthy();
  });
});
