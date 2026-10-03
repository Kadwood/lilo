// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { lastEditor, renderEditor, testDesign } from "../test/helpers";
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
const names = () => screen.getAllByRole("listitem").filter((li) => li.classList.contains("seq-row")).map((li) => li.querySelector(".seq-name")?.textContent ?? li.querySelector("input")?.getAttribute("aria-label"));

describe("Sequencer: shapes tab", () => {
  it("renames an object by double-clicking its name; Enter saves and it is undoable", async () => {
    renderEditor(<Sequencer />, { design: testDesign() });
    await loaded();
    fireEvent.doubleClick(screen.getByText("Frame"));
    const input = screen.getByLabelText("Rename Frame");
    fireEvent.change(input, { target: { value: "Badge outline" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(names()).toEqual(["Badge outline", "Line", "Bar"]);
    act(() => lastEditor!.actions.undo());
    expect(names()).toEqual(["Frame", "Line", "Bar"]);
  });

  it("Escape cancels a rename", async () => {
    renderEditor(<Sequencer />, { design: testDesign() });
    await loaded();
    fireEvent.doubleClick(screen.getByText("Line"));
    const input = screen.getByLabelText("Rename Line");
    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(names()).toEqual(["Frame", "Line", "Bar"]);
  });

  it("the gear shows the stitch count, node count and size", async () => {
    renderEditor(<Sequencer />, { design: testDesign() });
    await loaded();
    fireEvent.click(screen.getByLabelText("Details for Frame"));
    const dl = screen.getByTestId("details-0");
    expect(within(dl).getByText("Nodes").nextElementSibling!.textContent).toBe("8"); // 4 shell + 4 hole
    expect(Number(within(dl).getByText("Stitches").nextElementSibling!.textContent!.replace(/,/g, ""))).toBeGreaterThan(100);
    expect(within(dl).getByText(/30\.0 × 20\.0 mm/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Details for Frame"));
    expect(screen.queryByTestId("details-0")).toBeNull();
  });

  it("shift-click adds to the selection", async () => {
    renderEditor(<Sequencer />, { design: testDesign() });
    await loaded();
    fireEvent.click(screen.getByText("Frame"));
    fireEvent.click(screen.getByText("Bar"), { shiftKey: true });
    expect(lastEditor!.state.selectedIds).toEqual(["f1", "s1"]);
  });
});

describe("Sequencer: colours tab", () => {
  it("lists each colour with object and stitch counts", async () => {
    renderEditor(<Sequencer />, { design: testDesign() });
    await loaded();
    fireEvent.click(screen.getByRole("tab", { name: "Colours" }));
    expect(screen.getByText(/2 colours · 2 colour blocks/)).toBeTruthy();
    const rows = document.querySelectorAll(".colour-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Blue");
    expect(rows[0].textContent).toContain("2 ·"); // frame + line
  });

  it("merges one colour into another", async () => {
    renderEditor(<Sequencer />, { design: testDesign() });
    await loaded();
    fireEvent.click(screen.getByRole("tab", { name: "Colours" }));
    fireEvent.change(screen.getByLabelText("Merge Red into"), { target: { value: lastEditor!.state.design!.threads[0].id } });
    expect(new Set(lastEditor!.state.design!.objects.map((o) => o.threadId)).size).toBe(1);
    expect(lastEditor!.state.design!.threads).toHaveLength(1);
    act(() => lastEditor!.actions.undo());
    expect(new Set(lastEditor!.state.design!.objects.map((o) => o.threadId)).size).toBe(2);
  });

  it("groups objects by colour to cut thread changes", async () => {
    const d = testDesign();
    d.objects = [d.objects[0], d.objects[2], d.objects[1]]; // blue, red, blue: 3 blocks
    renderEditor(<Sequencer />, { design: d });
    await loaded();
    fireEvent.click(screen.getByRole("tab", { name: "Colours" }));
    expect(screen.getByText(/2 colours · 3 colour blocks/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Group by colour" }));
    expect(lastEditor!.state.design!.objects.map((o) => o.id)).toEqual(["f1", "r1", "s1"]);
    await waitFor(() => expect(lastEditor!.state.planResult!.stats.colorChanges).toBe(1), T);
  });

  it("selects every object of a colour", async () => {
    renderEditor(<Sequencer />, { design: testDesign() });
    await loaded();
    fireEvent.click(screen.getByRole("tab", { name: "Colours" }));
    fireEvent.click(screen.getByLabelText("Select Blue objects"));
    expect(lastEditor!.state.selectedIds).toEqual(["f1", "r1"]);
  });
});

describe("Sequencer: images tab", () => {
  it("adds reference images, reorders, fades, locks and removes them", async () => {
    renderEditor(<Sequencer />, { design: testDesign() });
    fireEvent.click(screen.getByRole("tab", { name: "Images" }));
    expect(screen.getByText("No images yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add image…" }));
    await waitFor(() => expect(lastEditor!.state.refImages).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Add image…" }));
    await waitFor(() => expect(lastEditor!.state.refImages).toHaveLength(2));
    const [a, b] = lastEditor!.state.refImages;
    expect(a.widthMm).toBe(60);
    expect(b.id).not.toBe(a.id);

    // the newest image is on top of the list; move it down to send it back
    const rows = document.querySelectorAll(".image-row");
    expect(rows).toHaveLength(2);
    fireEvent.click(within(rows[0] as HTMLElement).getByLabelText(/^Move ref\.png down/));
    expect(lastEditor!.state.refImages.map((i) => i.id)).toEqual([b.id, a.id]);

    fireEvent.change(screen.getAllByLabelText("ref.png opacity")[0], { target: { value: "0.25" } });
    expect(lastEditor!.state.refImages.some((i) => i.opacity === 0.25)).toBe(true);

    fireEvent.click(screen.getAllByLabelText("Lock ref.png")[0]);
    expect(lastEditor!.state.refImages.filter((i) => i.locked)).toHaveLength(1);
    fireEvent.click(screen.getAllByLabelText("Hide ref.png")[0]);
    expect(lastEditor!.state.refImages.filter((i) => !i.visible)).toHaveLength(1);

    fireEvent.click(screen.getAllByLabelText("Remove ref.png")[0]);
    expect(lastEditor!.state.refImages).toHaveLength(1);
  });
});

describe("Sequencer: text blocks", () => {
  it("shows a word as one expandable 'Text: ...' row", async () => {
    const d = testDesign();
    const sat = (id: string, ch: string, i: number) => ({ ...d.objects[2], id, name: ch, sourceText: { group: "text-1", char: ch, index: i } });
    d.objects = [...d.objects, sat("text-1-0", "H", 0), sat("text-1-1", "i", 1)];
    d.textBlocks = [{ id: "text-1", text: "Hi", fontId: "geneva_simple", heightMm: 10, letterSpacingMm: 0, lineSpacing: 1, align: "center", origin: [0, 0] }];
    renderEditor(<Sequencer />, { design: d });
    await loaded();
    expect(screen.getByText("Text: Hi")).toBeTruthy();
    expect(document.querySelectorAll(".text-row")).toHaveLength(1);
    expect(screen.queryByText("H")).toBeNull();
    fireEvent.click(screen.getByLabelText("Expand Text: Hi"));
    expect(screen.getByText("H")).toBeTruthy();
    fireEvent.click(screen.getByText("Text: Hi"));
    expect(lastEditor!.state.selectedIds).toEqual(["text-1-0", "text-1-1"]);
    fireEvent.click(screen.getByLabelText("Hide Text: Hi"));
    expect(lastEditor!.state.design!.objects.filter((o) => o.sourceText).every((o) => o.visible === false)).toBe(true);
  });
});
