// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { objectBox, type FillObject } from "@lilo/engine/light";
import { lastEditor, renderEditor, testDesign } from "../test/helpers";
import { buildCommands, searchCommands } from "../tools/commands";
import { TOOLS, toolForKey } from "../tools/registry";
import { EditorShell } from "./EditorShell";

afterEach(cleanup);
const T = { timeout: 20_000 };
const loaded = () => waitFor(() => expect(lastEditor?.state.planResult).not.toBeNull(), T);
const key = (k: string, o: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: k, ...o });
const palOptions = () => within(screen.getByRole("listbox", { name: "Commands" })).getAllByRole("option");
const paletteBox = () => within(screen.getByRole("dialog", { name: "Command palette" })).getByRole("combobox");

describe("bottom toolbar", () => {
  it("has every tool, the text tool included", () => {
    renderEditor(<EditorShell />);
    const bar = screen.getByRole("toolbar", { name: "Tools" });
    for (const t of TOOLS) expect(within(bar).getByRole("button", { name: t.label })).toBeTruthy();
    expect((within(bar).getByRole("button", { name: "Text" }) as HTMLButtonElement).disabled).toBe(false);
    expect(TOOLS.map((t) => t.key)).toEqual(expect.arrayContaining(["s", " ", "m", "1", "2", "3", "4", "5", "6", "t"]));
  });

  it("clicking a tool selects it and marks it pressed", () => {
    renderEditor(<EditorShell />);
    fireEvent.click(screen.getByRole("button", { name: "Rectangle" }));
    expect(lastEditor!.state.tool).toBe("rect");
    expect(screen.getByRole("button", { name: "Rectangle" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Select" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("undo and redo buttons follow the history", async () => {
    renderEditor(<EditorShell />, { design: testDesign() });
    await loaded();
    const undo = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    act(() => lastEditor!.actions.setSelection(["f1"]));
    act(() => lastEditor!.actions.nudgeSelection(1, 0));
    expect(undo.disabled).toBe(false);
    fireEvent.click(undo);
    expect((screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("keyboard shortcuts", () => {
  it("letters and digits pick tools, T opens the text tool", () => {
    renderEditor(<EditorShell />);
    for (const [k, tool] of [["1", "open"], ["2", "closed"], ["3", "circle"], ["4", "rect"], ["5", "pen"], ["6", "satin"], ["m", "measure"], ["7", "manual"], ["s", "select"]] as const) {
      key(k);
      expect(lastEditor!.state.tool).toBe(tool);
    }
    key("t");
    expect(lastEditor!.state.tool).toBe("text");
    expect(toolForKey("t")).toBe("text");
  });

  it("⌘Z / ⇧⌘Z undo and redo; ⌘A selects all; ⌘D duplicates; Backspace deletes", async () => {
    renderEditor(<EditorShell />, { design: testDesign() });
    await loaded();
    key("a", { metaKey: true });
    expect(lastEditor!.state.selectedIds).toEqual(["f1", "r1", "s1"]);
    key("d", { metaKey: true });
    expect(lastEditor!.state.design!.objects).toHaveLength(6);
    key("Backspace");
    expect(lastEditor!.state.design!.objects).toHaveLength(3);
    key("z", { metaKey: true });
    expect(lastEditor!.state.design!.objects).toHaveLength(6);
    key("z", { metaKey: true, shiftKey: true });
    expect(lastEditor!.state.design!.objects).toHaveLength(3);
    key("z", { ctrlKey: true });
    expect(lastEditor!.state.design!.objects).toHaveLength(6);
  });

  it("arrow keys nudge the selection 0.1 mm, Shift 1 mm", async () => {
    renderEditor(<EditorShell />, { design: testDesign() });
    await loaded();
    act(() => lastEditor!.actions.setSelection(["f1"]));
    key("ArrowRight");
    expect(objectBox(lastEditor!.state.design!.objects[0])!.minX).toBeCloseTo(-14.9);
    key("ArrowDown", { shiftKey: true });
    expect(objectBox(lastEditor!.state.design!.objects[0])!.minY).toBeCloseTo(-9);
  });

  it("typing in a text box doesn't trigger tool shortcuts", () => {
    renderEditor(<EditorShell />);
    const name = screen.getByLabelText("Project name");
    fireEvent.keyDown(name, { key: "4" });
    expect(lastEditor!.state.tool).toBe("select");
  });

  it("P opens map to path for the selection", async () => {
    renderEditor(<EditorShell />, { design: testDesign() });
    await loaded();
    act(() => lastEditor!.actions.setSelection(["f1"]));
    key("p");
    expect(screen.getByRole("dialog", { name: "Map to path" })).toBeTruthy();
    expect(screen.getByText(/Draw the path/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Map to path" })).toBeNull();
  });
});

describe("contextual settings panel", () => {
  it("shows Auto digitize when nothing is selected and the selection's settings when something is", async () => {
    renderEditor(<EditorShell />, { design: testDesign() });
    await loaded();
    expect(screen.getByText("Auto digitize")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Hoop:/ }).length).toBeGreaterThan(0);
    act(() => lastEditor!.actions.setSelection(["f1"]));
    expect(screen.queryByText("Auto digitize")).toBeNull();
    expect(screen.getByRole("listbox", { name: "Fill pattern" })).toBeTruthy();
    act(() => lastEditor!.actions.setSelection([]));
    expect(screen.getByText("Auto digitize")).toBeTruthy();
  });

  it("the hoop picker changes the design's hoop (undoable); the custom form adds a size of your own", async () => {
    renderEditor(<EditorShell />, { design: testDesign() });
    await loaded();
    fireEvent.click(screen.getAllByRole("button", { name: /^Hoop:/ })[0]);
    const dialog = screen.getByRole("dialog", { name: "Choose a hoop" });
    fireEvent.change(within(dialog).getByLabelText("Search hoops"), { target: { value: "nv2700 130" } });
    fireEvent.click(within(within(dialog).getByRole("list", { name: "Search results" })).getByRole("button", { name: /NV2700 130 x 180/ }));
    expect(screen.queryByRole("dialog", { name: "Choose a hoop" })).toBeNull();
    expect(lastEditor!.state.design!.hoop).toMatchObject({ widthMm: 130, heightMm: 180, id: "brother-nv2700-130x180" });
    act(() => lastEditor!.actions.undo());
    expect(lastEditor!.state.design!.hoop.widthMm).toBe(160);
    // a hoop of your own, with a size and a shape
    fireEvent.click(screen.getAllByRole("button", { name: /^Hoop:/ })[0]);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Choose a hoop" })).getByRole("button", { name: /My custom hoops/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add a hoop…" }));
    const form = screen.getByRole("dialog", { name: "Add a hoop" });
    fireEvent.change(within(form).getByPlaceholderText(/Jacket back/), { target: { value: "Cap test" } });
    fireEvent.change(within(form).getByLabelText(/^Width/), { target: { value: "100" } });
    fireEvent.change(within(form).getByLabelText(/^Height/), { target: { value: "60" } });
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: "Add hoop" }));
    });
    await waitFor(() => expect(lastEditor!.state.design!.hoop).toMatchObject({ name: "Cap test", widthMm: 100, heightMm: 60, shape: "rect" }));
  });
});

describe("command palette", () => {
  it("⌘K opens it, typing filters, Enter runs the first match, Esc closes", async () => {
    renderEditor(<EditorShell />, { design: testDesign() });
    await loaded();
    act(() => lastEditor!.actions.setSelection(["f1"]));
    key("k", { metaKey: true });
    const box = paletteBox();
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: "hearts m" } });
    const items = palOptions();
    expect(items[0].textContent).toContain("Fill pattern: Hearts M");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
    expect((lastEditor!.state.design!.objects[0] as FillObject).params.pattern).toBe("hearts-m");
    key("k", { metaKey: true });
    fireEvent.keyDown(paletteBox(), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
  });

  it("finds tools and actions, with their shortcuts", async () => {
    renderEditor(<EditorShell />, { design: testDesign() });
    act(() => lastEditor!.actions.setPaletteOpen(true));
    const box = paletteBox();
    fireEvent.change(box, { target: { value: "knife" } });
    expect(palOptions()[0].textContent).toContain("Knife");
    fireEvent.change(box, { target: { value: "rectangle" } });
    const rect = palOptions()[0];
    expect(rect.textContent).toContain("Rectangle tool");
    expect(rect.textContent).toContain("4");
    fireEvent.click(rect);
    expect(lastEditor!.state.tool).toBe("rect");
  });

  it("arrow keys move the highlight; disabled commands don't run", async () => {
    renderEditor(<EditorShell />, { design: testDesign() });
    await loaded();
    act(() => lastEditor!.actions.setPaletteOpen(true));
    const box = paletteBox();
    fireEvent.change(box, { target: { value: "tool" } });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(palOptions()[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.change(box, { target: { value: "cut hole" } });
    const hole = palOptions()[0];
    expect(hole.getAttribute("aria-disabled")).toBe("true"); // nothing selected
    fireEvent.click(hole);
    expect(lastEditor!.state.mode).toBe("none");
  });

  it("every Ember tool, run type, fill pattern and shape action is a command", () => {
    renderEditor(<div />, { design: testDesign() });
    const cmds = buildCommands({ state: lastEditor!.state, actions: lastEditor!.actions, openImage: () => {}, fit: () => {} });
    const labels = cmds.map((c) => c.label);
    for (const l of ["Select tool", "Pan tool", "Measure tool", "Open shape tool", "Closed shape tool", "Circle tool", "Rectangle tool", "Pen tool", "Satin blocks tool", "Manual stitch tool"]) expect(labels).toContain(l);
    expect(cmds.filter((c) => c.group === "Fill pattern")).toHaveLength(36);
    expect(cmds.filter((c) => c.id.startsWith("run."))).toHaveLength(7);
    for (const l of ["Undo", "Redo", "Select all", "Duplicate", "Delete", "Map to path", "Auto redwork", "Edit stitch angle", "Set start point", "Set end point", "Reshape points", "Cut hole"]) expect(labels).toContain(l);
    expect(new Set(cmds.map((c) => c.id)).size).toBe(cmds.length);
  });

  it("search ranks label-start matches first and needs every word", () => {
    renderEditor(<div />);
    const cmds = buildCommands({ state: lastEditor!.state, actions: lastEditor!.actions, openImage: () => {}, fit: () => {} });
    expect(searchCommands(cmds, "undo")[0].label).toBe("Undo");
    expect(searchCommands(cmds, "fill hearts").every((c) => /hearts/i.test(c.label))).toBe(true);
    expect(searchCommands(cmds, "zzzz")).toEqual([]);
    expect(searchCommands(cmds, "")).toBe(cmds);
  });
});
