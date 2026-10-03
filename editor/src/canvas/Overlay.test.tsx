// @vitest-environment jsdom
import { useMemo } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createInlineEngine } from "../engine/client";
import { EngineProvider } from "../engine/context";
import { EditorProvider, useEditor } from "../state/store";
import { testDesign } from "../test/helpers";
import { CanvasController } from "./controller";
import { Overlay } from "./Overlay";
import { ShapeBar } from "./ShapeBar";
import type { View } from "./viewport";

afterEach(cleanup);

let ed: ReturnType<typeof useEditor> | null = null;
let ctl: CanvasController | null = null;
const view: View = { x: 400, y: 300, zoom: 10 };

function Harness() {
  const e = useEditor();
  ed = e;
  const controller = useMemo(() => new CanvasController({ api: e.api, actions: e.actions, getView: () => view, setView: () => {}, fit: () => {} }), [e.api, e.actions]);
  ctl = controller;
  return (
    <div>
      <Overlay controller={controller} view={view} />
      <ShapeBar controller={controller} view={view} width={800} height={600} />
    </div>
  );
}

function mount() {
  return render(
    <EngineProvider engine={createInlineEngine()}>
      <EditorProvider initialDesign={testDesign()}>
        <Harness />
      </EditorProvider>
    </EngineProvider>,
  );
}

const ready = () => waitFor(() => expect(ed?.state.design).not.toBeNull(), { timeout: 20_000 });
const q = (sel: string) => document.querySelectorAll(sel);

describe("canvas overlay", () => {
  it("draws nothing without a selection", async () => {
    mount();
    await ready();
    expect(q(".ov-handle")).toHaveLength(0);
    expect(screen.queryByRole("toolbar", { name: "Shape actions" })).toBeNull();
  });

  it("a selection gets an outline, a box, 8 resize handles and a rotate handle", async () => {
    mount();
    await ready();
    act(() => ed!.actions.setSelection(["f1"]));
    expect(q(".ov-outline")).toHaveLength(1);
    expect(q(".ov-box").length).toBeGreaterThanOrEqual(1);
    expect(q("rect.ov-handle")).toHaveLength(8);
    expect(q("circle.ov-handle")).toHaveLength(1);
  });

  it("locked selections show the box but no handles", async () => {
    mount();
    await ready();
    act(() => ed!.actions.setSelection(["f1"]));
    act(() => ed!.actions.toggleLockSelection());
    expect(q("rect.ov-handle")).toHaveLength(0);
    expect(q(".ov-box")).toHaveLength(1);
  });

  it("the shape bar offers every shape action for a single fill", async () => {
    mount();
    await ready();
    act(() => ed!.actions.setSelection(["f1"]));
    const bar = screen.getByRole("toolbar", { name: "Shape actions" });
    const labels = [...bar.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toEqual(["Reshape", "Cut hole", "Knife", "Start", "End", "Angle", "Map…", "Outline", "Redwork", "Lock", "Duplicate", "Delete"]);
    expect([...bar.querySelectorAll("button")].filter((b) => b.disabled)).toHaveLength(0);
  });

  it("some actions only make sense for some selections", async () => {
    mount();
    await ready();
    act(() => ed!.actions.setSelection(["r1"])); // an open line
    const bar = screen.getByRole("toolbar", { name: "Shape actions" });
    const disabled = [...bar.querySelectorAll("button")].filter((b) => b.disabled).map((b) => b.textContent);
    expect(disabled).toEqual(expect.arrayContaining(["Cut hole", "Angle", "Fill"]));
    act(() => ed!.actions.setSelection(["f1", "r1"]));
    const multi = [...screen.getByRole("toolbar", { name: "Shape actions" }).querySelectorAll("button")].filter((b) => b.disabled).map((b) => b.textContent);
    expect(multi).toEqual(expect.arrayContaining(["Reshape", "Start", "End"]));
  });

  it("clicking Reshape shows the outline's points: squares for corners", async () => {
    mount();
    await ready();
    act(() => ed!.actions.setSelection(["f1"]));
    act(() => screen.getByRole("button", { name: "Reshape" }).click());
    expect(ed!.state.mode).toBe("reshape");
    expect(q(".ov-node")).toHaveLength(8); // shell 4 + hole 4
    expect(q("rect.ov-handle")).toHaveLength(0);
  });

  it("the knife action and its line", async () => {
    mount();
    await ready();
    act(() => ed!.actions.setSelection(["f1"]));
    act(() => screen.getByRole("button", { name: "Knife" }).click());
    expect(ed!.state.mode).toBe("knife");
    act(() => {
      ctl!.pointerDown({ x: 400, y: 200, button: 0, shift: false, ctrl: false, alt: false, detail: 1 });
      ctl!.pointerMove({ x: 400, y: 400, shift: false, ctrl: false });
    });
    expect(q(".ov-knife")).toHaveLength(1);
  });

  it("a half-drawn shape shows its points", async () => {
    mount();
    await ready();
    act(() => ed!.actions.setTool("open"));
    const ev = (x: number, y: number, o = {}) => ({ x, y, button: 0, shift: false, ctrl: false, alt: false, detail: 1, ...o });
    act(() => {
      ctl!.pointerDown(ev(400, 300));
      ctl!.pointerUp(ev(400, 300));
      ctl!.pointerDown(ev(500, 300, { button: 2 }));
      ctl!.pointerUp(ev(500, 300));
    });
    expect(q(".ov-node")).toHaveLength(2);
    expect(q(".ov-node.curve")).toHaveLength(1);
  });

  it("measure shows the distance in the chosen units", async () => {
    mount();
    await ready();
    act(() => ed!.actions.setTool("measure"));
    const ev = (x: number, y: number) => ({ x, y, button: 0, shift: false, ctrl: false, alt: false, detail: 1 });
    act(() => {
      ctl!.pointerDown(ev(400, 300));
      ctl!.pointerMove({ x: 700, y: 700, shift: false, ctrl: false }); // 30 x 40 mm
      ctl!.pointerUp({ x: 700, y: 700, shift: false, ctrl: false });
    });
    expect(screen.getByTestId("measure-label").textContent).toBe("50.00 mm");
    act(() => ed!.actions.setUnits("in"));
    expect(screen.getByTestId("measure-label").textContent).toBe("1.969 in");
  });

  it("the angle dial and start / end markers appear for their modes", async () => {
    mount();
    await ready();
    act(() => ed!.actions.setSelection(["f1"]));
    act(() => ed!.actions.setMode("angle"));
    expect(q(".ov-dial").length).toBeGreaterThan(10);
    expect(screen.getByText("45°")).toBeTruthy();
    act(() => ed!.actions.updateObjects(["f1"], "markers", (o) => void ((o.startPoint = [0, 0]), (o.endPoint = [5, 5]))));
    expect(q(".ov-start")).toHaveLength(1);
    expect(q(".ov-end")).toHaveLength(1);
  });

  it("a movable centre cross shows for centred patterns only", async () => {
    mount();
    await ready();
    act(() => ed!.actions.setSelection(["f1"]));
    expect(q(".ov-centre")).toHaveLength(0);
    act(() => ed!.actions.updateObjects(["f1"], "pattern", (o) => void (o.kind === "fill" && (o.params.pattern = "circular"))));
    expect(q(".ov-centre").length).toBeGreaterThan(0);
  });

  it("map to path previews a ghost of each copy", async () => {
    mount();
    await ready();
    act(() => ed!.actions.setSelection(["f1", "r1"]));
    act(() => ed!.actions.openMapDraft());
    act(() => ed!.actions.updateMapDraft({ count: 4 }));
    expect(q(".ov-ghost")).toHaveLength(4);
    act(() => ed!.actions.updateMapDraft({ count: 7 }));
    expect(q(".ov-ghost")).toHaveLength(7);
  });
});
