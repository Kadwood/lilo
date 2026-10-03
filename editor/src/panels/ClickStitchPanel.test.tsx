// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { addEntry, emptyShelf, exportShelf, getCatalogue, toDesignThread, type TraceRegion } from "@lilo/engine/light";
import { createMockPlatform } from "../platform/mock";
import { setPlatform } from "../platform";
import { DEFAULT_UI_OPTIONS, toEngineOptions } from "../state/editorStore";
import { resetShelfStore } from "../state/shelfStore";
import { lastEditor, renderEditor } from "../test/helpers";
import { ClickStitchPanel } from "./ClickStitchPanel";
import { DigitizePanel } from "./DigitizePanel";

const RED = toDesignThread(getCatalogue().threads.find((t) => t.name === "Red")!);
const region = (id: string, x: number): TraceRegion => ({ id, hex: RED.hex, thread: RED, shell: [[x, 0], [x + 10, 0], [x + 10, 10], [x, 10]], holes: [], areaMm2: 100, box: { minX: x, minY: 0, maxX: x + 10, maxY: 10 } });

beforeEach(() => {
  resetShelfStore();
  setPlatform(createMockPlatform().platform);
});
afterEach(() => {
  cleanup();
  setPlatform(null);
  resetShelfStore();
});

describe("Click to stitch panel", () => {
  it("asks for an image when there is no trace yet", () => {
    renderEditor(<ClickStitchPanel onOpen={() => {}} />);
    expect(screen.getByText(/Open a picture first/)).toBeTruthy();
  });

  it("has the fill controls, switches to outline, and feeds the settings the clicks use", () => {
    renderEditor(<ClickStitchPanel onOpen={() => {}} />);
    act(() => lastEditor!.api.setState({ trace: { regions: [region("r1", 0), region("r2", 20)], svg: "", source: "x.png" } }));
    expect(screen.getByText(/2 regions in the trace/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Angle"), { target: { value: "30" } });
    expect(lastEditor!.state.stitchSettings.fill.angleDeg).toBe(30);
    fireEvent.click(within(screen.getByRole("listbox", { name: "Fill pattern" })).getAllByRole("option")[3]);
    expect(lastEditor!.state.stitchSettings.fill.pattern).not.toBe("tatami");
    fireEvent.click(screen.getByRole("button", { name: "Outlined" }));
    expect(lastEditor!.state.stitchSettings.style).toBe("outline");
    const run = screen.getByRole("listbox", { name: "Run type" });
    fireEvent.click(within(run).getByRole("option", { name: "Triple" }));
    expect(lastEditor!.state.stitchSettings.run).toMatchObject({ type: "triple", repeats: 3 });
    act(() => lastEditor!.actions.stitchRegions(["r2"]));
    const o = lastEditor!.state.design!.objects[0];
    expect(o.kind).toBe("run");
  });

  it("shows the batch button and stitches the batch", () => {
    renderEditor(<ClickStitchPanel onOpen={() => {}} />);
    act(() => lastEditor!.api.setState({ trace: { regions: [region("r1", 0), region("r2", 20)], svg: "", source: "x.png" } }));
    act(() => {
      lastEditor!.actions.togglePendingRegion("r1");
      lastEditor!.actions.togglePendingRegion("r2");
    });
    fireEvent.click(screen.getByRole("button", { name: "Stitch 2 selected" }));
    expect(lastEditor!.state.design!.objects).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /selected/ })).toBeNull();
  });

  it("Clear the automatic stitches empties the design (and Done leaves the tool)", async () => {
    renderEditor(<ClickStitchPanel onOpen={() => {}} />);
    act(() => lastEditor!.api.setState({ trace: { regions: [region("r1", 0)], svg: "", source: "x.png" }, tool: "clickstitch" }));
    act(() => lastEditor!.actions.stitchRegions(["r1"]));
    fireEvent.click(screen.getByRole("button", { name: "Clear the automatic stitches" }));
    expect(lastEditor!.state.design!.objects).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(lastEditor!.state.tool).toBe("select");
  });
});

describe("Use my threads", () => {
  it("is a toggle on the Auto digitize panel that turns into engine thread options", async () => {
    renderEditor(<DigitizePanel onOpen={() => {}} />);
    const shelf = addEntry(emptyShelf(), { brand: "Local Mill", code: "A7", name: "Plum", hex: "#aa3366" });
    expect(toEngineOptions(DEFAULT_UI_OPTIONS, shelf).threads).toBeUndefined();
    fireEvent.click(screen.getByLabelText("Use my threads"));
    expect(lastEditor!.state.options.useMyThreads).toBe(true);
    expect(toEngineOptions(lastEditor!.state.options, shelf).threads?.map((t) => t.code)).toEqual(["A7"]);
    // an empty shelf means the brand is used
    expect(toEngineOptions(lastEditor!.state.options, emptyShelf()).threads).toBeUndefined();
    await waitFor(() => expect(screen.getByText(/Your shelf is empty/)).toBeTruthy());
  });

  it("says how many spools it matches to", async () => {
    const m = createMockPlatform({ shelfJson: exportShelf(addEntry(emptyShelf(), { brand: "Local Mill", code: "A7", hex: "#aa3366" })) });
    setPlatform(m.platform);
    renderEditor(<DigitizePanel onOpen={() => {}} />);
    fireEvent.click(screen.getByLabelText("Use my threads"));
    expect(await screen.findByText(/Matching to 1 spool on your shelf/, undefined, { timeout: 10_000 })).toBeTruthy();
  });
});
