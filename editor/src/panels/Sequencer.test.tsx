// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { lastEditor, renderEditor, testDesign } from "../test/helpers";
import { Sequencer } from "./Sequencer";

afterEach(cleanup);
const T = { timeout: 20_000 };

const names = () => [...document.querySelectorAll("li.seq-row")].map((li) => li.querySelector(".seq-name")!.textContent);
const loaded = () => waitFor(() => expect(lastEditor?.state.planResult).not.toBeNull(), T);

describe("Sequencer", () => {
  it("lists objects grouped by colour with swatch name, kind and stitch count", async () => {
    renderEditor(<Sequencer />, { design: testDesign() });
    await loaded();
    expect(screen.getByText(/3 objects · 2 colour blocks/)).toBeTruthy();
    expect(screen.getByText("Brother 800")).toBeTruthy(); // red group heading
    expect(names()).toEqual(["Bar", "Line", "Frame"]); // last sewn on top, like the layers
    const row = screen.getByText("Frame").closest("li")!;
    expect(within(row).getByText("Fill")).toBeTruthy();
    expect(Number(within(row).getByTitle("stitches").textContent!.replace(/,/g, ""))).toBeGreaterThan(100);
  });

  it("selects on click and toggles off on a second click", async () => {
    renderEditor(<Sequencer />, { design: testDesign() });
    await loaded();
    fireEvent.click(screen.getByText("Line"));
    expect(lastEditor?.state.selectedId).toBe("r1");
    expect(screen.getByText("Line").closest("li")!.className).toMatch(/selected/);
    fireEvent.click(screen.getByText("Line"));
    expect(lastEditor?.state.selectedId).toBeNull();
  });

  it("hides an object: it stays in the list but drops out of the plan", async () => {
    renderEditor(<Sequencer />, { design: testDesign() });
    await loaded();
    const before = lastEditor!.state.planResult!.stats.stitchCount;
    fireEvent.click(screen.getByLabelText("Hide Frame"));
    await waitFor(() => expect(lastEditor!.state.planResult!.stats.stitchCount).toBeLessThan(before), T);
    expect(screen.getByLabelText("Show Frame")).toBeTruthy();
    expect(screen.getByText("Frame").closest("li")!.className).toMatch(/hidden/);
  });

  it("reorders objects with the arrow buttons (up sews later) and recomputes the plan", async () => {
    renderEditor(<Sequencer />, { design: testDesign() });
    await loaded();
    fireEvent.click(screen.getByLabelText("Move Line up"));
    expect(names()).toEqual(["Line", "Bar", "Frame"]);
    expect(lastEditor!.state.design!.objects.map((o) => o.id)).toEqual(["f1", "s1", "r1"]);
    expect((screen.getByLabelText("Move Line up") as HTMLButtonElement).disabled).toBe(true); // already the last one sewn
    await waitFor(() => expect(lastEditor!.state.planResult!.plan.stitches.filter((s) => s.objectIndex >= 0).pop()!.objectIndex).toBe(2), T);
    expect(lastEditor!.state.design!.objects[2].id).toBe("r1");
  });

  it("moves a whole colour block", async () => {
    renderEditor(<Sequencer />, { design: testDesign() });
    await loaded();
    fireEvent.click(screen.getByLabelText("Move Blue block up")); // up = sews later
    expect(names()).toEqual(["Line", "Frame", "Bar"]);
    await waitFor(() => expect(lastEditor!.state.planResult!.plan.threads.map((t) => t.name)).toEqual(["Red", "Blue"]), T);
  });

  it("reorders by drag and drop", async () => {
    renderEditor(<Sequencer />, { design: testDesign() });
    await loaded();
    const bar = screen.getByText("Bar").closest("li")!;
    const frame = screen.getByText("Frame").closest("li")!;
    const dt = { setData: () => {}, effectAllowed: "" } as unknown as DataTransfer;
    fireEvent.dragStart(bar, { dataTransfer: dt });
    // the list is shown last-sewn first, so the lower half of a row means "sews just before it"
    // (jsdom drag events carry no clientY, so the row is placed far above the pointer: the pointer is in its lower half)
    frame.getBoundingClientRect = () => ({ top: -100, height: 20, bottom: -80, left: 0, right: 100, width: 100, x: 0, y: -100, toJSON() {} });
    await act(async () => {
      fireEvent.dragOver(frame, { dataTransfer: dt });
      fireEvent.drop(frame, { dataTransfer: dt });
    });
    expect(lastEditor!.state.design!.objects.map((o) => o.id)).toEqual(["s1", "f1", "r1"]);
    expect(names()).toEqual(["Line", "Frame", "Bar"]);
  });

  it("shows a placeholder before anything is digitized", () => {
    renderEditor(<Sequencer />);
    expect(screen.getByText(/will appear here/)).toBeTruthy();
  });
});
