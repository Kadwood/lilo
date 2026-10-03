// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { objectBox, type FillObject, type RunObject, type SatinObject } from "@lilo/engine/light";
import { lastEditor, renderEditor, testDesign } from "../test/helpers";
import { SettingsPanel } from "./SettingsPanel";

afterEach(cleanup);
const T = { timeout: 20_000 };

const obj = <K extends "fill" | "run" | "satin">(id: string) => lastEditor!.state.design!.objects.find((o) => o.id === id) as K extends "fill" ? FillObject : K extends "run" ? RunObject : SatinObject;
const select = (...ids: string[]) => act(() => lastEditor!.actions.setSelection(ids));
const loaded = () => waitFor(() => expect(lastEditor?.state.planResult).not.toBeNull(), T);

describe("SettingsPanel: fills", () => {
  it("renders nothing without a selection", () => {
    renderEditor(<SettingsPanel />, { design: testDesign() });
    expect(screen.queryByLabelText("Settings")).toBeNull();
  });

  it("shows all 36 fill patterns with swatches and marks the current one", async () => {
    renderEditor(<SettingsPanel />, { design: testDesign() });
    await loaded();
    select("f1");
    const list = screen.getByRole("listbox", { name: "Fill pattern" });
    expect(within(list).getAllByRole("option")).toHaveLength(36);
    expect(within(list).getByRole("option", { name: /Tatami/ }).getAttribute("aria-selected")).toBe("true");
    expect(list.querySelectorAll("img").length).toBe(36);
  });

  it("picking a pattern sets it, resets the angle to the pattern's default and shows its own settings", async () => {
    renderEditor(<SettingsPanel />, { design: testDesign() });
    await loaded();
    select("f1");
    fireEvent.click(screen.getByRole("option", { name: /Waves/ }));
    expect(obj<"fill">("f1").params.pattern).toBe("waves");
    expect(obj<"fill">("f1").params.angleDeg).toBe(45);
    expect(screen.getByLabelText("Amplitude")).toBeTruthy();
    expect(screen.getByLabelText("Steps")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Amplitude"), { target: { value: "2.5" } });
    expect(obj<"fill">("f1").params.patternParams).toEqual({ amplitude: 2.5 });
    fireEvent.click(screen.getByRole("option", { name: /Hearts S/ }));
    expect(obj<"fill">("f1").params.angleDeg).toBe(0); // motifs sit upright
    expect(obj<"fill">("f1").params.patternParams).toBeUndefined();
  });

  it("a slider drag is one undo step; typing a value works too", async () => {
    renderEditor(<SettingsPanel />, { design: testDesign() });
    await loaded();
    select("f1");
    const slider = screen.getByLabelText("Row spacing");
    for (const v of ["0.5", "0.6", "0.7"]) fireEvent.change(slider, { target: { value: v } });
    expect(obj<"fill">("f1").params.rowSpacingMm).toBeCloseTo(0.7);
    fireEvent.pointerUp(slider);
    act(() => lastEditor!.actions.undo());
    expect(obj<"fill">("f1").params.rowSpacingMm).toBeCloseTo(0.4);
    fireEvent.change(screen.getByLabelText("Hand stitch value"), { target: { value: "3" } });
    expect(obj<"fill">("f1").params.handStitch).toBe(3);
  });

  it("sets hand stitch, underpath, edge outline, pull compensation and stitch length", async () => {
    renderEditor(<SettingsPanel />, { design: testDesign() });
    await loaded();
    select("f1");
    fireEvent.click(screen.getByLabelText("Underpath"));
    expect(obj<"fill">("f1").params.underpath).toBe(true);
    fireEvent.click(screen.getByLabelText("Edge outline"));
    expect(obj<"fill">("f1").params.edgeRun).toBe(false);
    fireEvent.change(screen.getByLabelText("Pull compensation", { selector: "input[type=range]" }), { target: { value: "0.5" } });
    expect(obj<"fill">("f1").params.pullCompMm).toBe(0.5);
    fireEvent.change(screen.getByLabelText("Stitch length", { selector: "input[type=range]" }), { target: { value: "2.2" } });
    expect(obj<"fill">("f1").params.stitchLengthMm).toBe(2.2);
  });

  it("gradient: ramp then plateau, with start/end spacing and reverse", async () => {
    renderEditor(<SettingsPanel />, { design: testDesign() });
    await loaded();
    select("f1");
    fireEvent.click(screen.getByRole("button", { name: "Ramp" }));
    expect(obj<"fill">("f1").params.gradient).toMatchObject({ kind: "ramp", from: 1, to: 3 });
    fireEvent.change(screen.getByLabelText("End spacing ×"), { target: { value: "4" } });
    fireEvent.click(screen.getByLabelText("Reverse"));
    expect(obj<"fill">("f1").params.gradient).toMatchObject({ to: 4, reverse: true });
    fireEvent.click(screen.getByRole("button", { name: "Plateau" }));
    expect(obj<"fill">("f1").params.gradient?.kind).toBe("plateau");
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    expect(obj<"fill">("f1").params.gradient).toBeUndefined();
  });

  it("gradient only offers itself for row patterns", async () => {
    renderEditor(<SettingsPanel />, { design: testDesign() });
    await loaded();
    select("f1");
    expect(document.querySelector('[data-section="gradient"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /Spiral/ }));
    expect(document.querySelector('[data-section="gradient"]')).toBeNull();
  });

  it("multiple underlays: customise, add a pass, edit, remove, back to simple", async () => {
    renderEditor(<SettingsPanel />, { design: testDesign() });
    await loaded();
    select("f1");
    fireEvent.click(screen.getByRole("button", { name: /Customise underlays/ }));
    expect(obj<"fill">("f1").params.underlays).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Add pass" }));
    expect(obj<"fill">("f1").params.underlays).toHaveLength(2);
    const spacing = screen.getAllByLabelText("Spacing", { selector: "input[type=range]" })[1];
    fireEvent.change(spacing, { target: { value: "4" } });
    expect(obj<"fill">("f1").params.underlays![1].spacingMm).toBe(4);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(obj<"fill">("f1").params.underlays).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Back to simple" }));
    expect(obj<"fill">("f1").params.underlays).toBeUndefined();
  });

  it("outlined / filled converts a fill to a run and back", async () => {
    renderEditor(<SettingsPanel />, { design: testDesign() });
    await loaded();
    select("f1");
    fireEvent.click(screen.getByRole("button", { name: "Outlined" }));
    expect(lastEditor!.state.design!.objects[0].kind).toBe("run");
    expect(screen.getByRole("listbox", { name: "Run type" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Filled" }));
    expect(lastEditor!.state.design!.objects[0].kind).toBe("fill");
  });

  it("changing colour picks from the catalogue and adds the thread", async () => {
    renderEditor(<SettingsPanel />, { design: testDesign() });
    await loaded();
    select("f1");
    fireEvent.click(screen.getByRole("button", { name: /Brother 513|Blue/ }));
    fireEvent.change(screen.getByLabelText("Search threads"), { target: { value: "pink" } });
    const first = screen.getAllByRole("button", { name: /Pink/i })[0];
    fireEvent.click(first);
    const t = lastEditor!.state.design!.objects[0].threadId;
    expect(lastEditor!.state.design!.threads.map((x) => x.id)).toContain(t);
    expect(t).not.toBe(testDesign().objects[0].threadId);
  });
});

describe("SettingsPanel: runs and satins", () => {
  it("run type grid has the seven types and switches the settings shown", async () => {
    renderEditor(<SettingsPanel />, { design: testDesign() });
    await loaded();
    select("r1");
    const grid = screen.getByRole("listbox", { name: "Run type" });
    expect(within(grid).getAllByRole("option").map((o) => o.textContent)).toEqual(["Single", "Triple", "Satin", "E-stitch", "Double rope", "Triple rope", "Manual"]);
    expect(screen.getByLabelText("Tolerance")).toBeTruthy();
    fireEvent.click(within(grid).getByRole("option", { name: "E-stitch" }));
    expect(obj<"run">("r1").params.type).toBe("estitch");
    expect(screen.getByLabelText("Width", { selector: "input[type=range]" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Flipped"));
    expect(obj<"run">("r1").params.flipped).toBe(true);
    fireEvent.click(within(grid).getByRole("option", { name: "Triple" }));
    expect(obj<"run">("r1").params.repeats).toBe(3);
    fireEvent.click(within(grid).getByRole("option", { name: "Manual" }));
    expect(screen.getByText(/sewn where you placed it/)).toBeTruthy();
  });

  it("satin run: width, density, pull comp, split, stagger, short stitches and underlay", async () => {
    renderEditor(<SettingsPanel />, { design: testDesign() });
    await loaded();
    select("r1");
    fireEvent.click(within(screen.getByRole("listbox", { name: "Run type" })).getByRole("option", { name: "Satin" }));
    const run = () => obj<"run">("r1");
    expect(run().params.type).toBe("satin");
    expect(run().params.widthMm).toBe(2.5);
    fireEvent.change(screen.getByLabelText("Width", { selector: "input[type=range]" }), { target: { value: "6" } });
    expect(run().params.widthMm).toBe(6);
    fireEvent.change(screen.getByLabelText("Density (spacing)", { selector: "input[type=range]" }), { target: { value: "0.6" } });
    expect(run().params.satin?.densityMm).toBe(0.6);
    // 0.6 mm same-side spacing = a stitch every 0.3 mm = about 33 per cm along the column
    expect(screen.getByLabelText("Density (spacing) hint").textContent).toBe("≈ 33 stitches/cm along the column");
    fireEvent.change(screen.getByLabelText("Split above", { selector: "input[type=range]" }), { target: { value: "4" } });
    expect(run().params.satin?.splitMaxWidthMm).toBe(4);
    fireEvent.change(screen.getByLabelText("Stagger cycles", { selector: "input[type=range]" }), { target: { value: "3" } });
    expect(run().params.satin?.staggerCycles).toBe(3);
    fireEvent.click(screen.getByLabelText("Short stitches on curves"));
    expect(run().params.satin?.shortStitches).toBe(true);
    fireEvent.change(screen.getByLabelText("Satin underlay"), { target: { value: "zigzag" } });
    expect(run().params.satin?.underlay).toBe("zigzag");
  });

  it("satin column objects edit their own params", async () => {
    renderEditor(<SettingsPanel />, { design: testDesign() });
    await loaded();
    select("s1");
    fireEvent.change(screen.getByLabelText("Pull compensation", { selector: "input[type=range]" }), { target: { value: "0.4" } });
    expect(obj<"satin">("s1").params.pullCompMm).toBe(0.4);
    fireEvent.change(screen.getByLabelText("Satin underlay"), { target: { value: "contour" } });
    expect(obj<"satin">("s1").params.underlay).toBe("contour");
  });
});

describe("Dimensions", () => {
  it("shows the selection's size in mm and resizes it from the width field, keeping the aspect ratio", async () => {
    renderEditor(<SettingsPanel />, { design: testDesign() });
    await loaded();
    select("f1"); // 30 x 20
    expect((screen.getByLabelText("Width (mm)") as HTMLInputElement).value).toBe("30");
    expect((screen.getByLabelText("Height (mm)") as HTMLInputElement).value).toBe("20");
    const w = screen.getByLabelText("Width (mm)");
    fireEvent.change(w, { target: { value: "60" } });
    fireEvent.blur(w);
    const b = objectBox(obj<"fill">("f1"))!;
    expect(b.maxX - b.minX).toBeCloseTo(60);
    expect(b.maxY - b.minY).toBeCloseTo(40);
  });

  it("with the aspect lock off, width and height are independent", async () => {
    renderEditor(<SettingsPanel />, { design: testDesign() });
    await loaded();
    select("f1");
    fireEvent.click(screen.getByLabelText("Lock aspect ratio"));
    expect(lastEditor!.state.aspectLock).toBe(false);
    const h = screen.getByLabelText("Height (mm)");
    fireEvent.change(h, { target: { value: "10" } });
    fireEvent.keyDown(h, { key: "Enter" });
    const b = objectBox(obj<"fill">("f1"))!;
    expect(b.maxX - b.minX).toBeCloseTo(30);
    expect(b.maxY - b.minY).toBeCloseTo(10);
  });

  it("switches to inches", async () => {
    renderEditor(<SettingsPanel />, { design: testDesign() });
    await loaded();
    select("f1");
    fireEvent.click(screen.getByRole("button", { name: "in" }));
    expect(lastEditor!.state.units).toBe("in");
    expect((screen.getByLabelText("Width (in)") as HTMLInputElement).value).toBe("1.181");
    const w = screen.getByLabelText("Width (in)");
    fireEvent.change(w, { target: { value: "2" } });
    fireEvent.blur(w);
    const b = objectBox(obj<"fill">("f1"))!;
    expect(b.maxX - b.minX).toBeCloseTo(50.8);
  });

  it("flip buttons mirror the selection", async () => {
    renderEditor(<SettingsPanel />, { design: testDesign() });
    await loaded();
    select("f1"); // frame: x -15..15, y -10..10, first point top-left
    expect(obj<"fill">("f1").geometry.shell[0]).toEqual([-15, -10]);
    fireEvent.click(screen.getByRole("button", { name: "Flip H" }));
    expect(obj<"fill">("f1").geometry.shell[0]).toEqual([15, -10]);
    fireEvent.click(screen.getByRole("button", { name: "Flip V" }));
    expect(obj<"fill">("f1").geometry.shell[0]).toEqual([15, 10]);
  });
});
