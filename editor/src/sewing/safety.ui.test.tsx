// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_FILL_PARAMS, recommendedMachineSpeed, planStats, type FillObject, type SatinObject } from "@lilo/engine/light";
import { SafeSlider, formatDelta } from "../panels/SafeSlider";
import { SettingsPanel } from "../panels/SettingsPanel";
import { decimalsFor, roundFor, safetyNotes, safetyRows, setSafeValue } from "../panels/safety";
import { createMockPlatform } from "../platform/mock";
import { setPlatform } from "../platform";
import { ExportDialog } from "../shell/ExportDialog";
import { lastEditor, renderEditor, testDesign } from "../test/helpers";
import { BeforeYouSew, sewText, speedSentence } from "./BeforeYouSew";
import { rangeText, StitchSafetyCard } from "./StitchSafetyCard";
import { resolveSewingSetup } from "@lilo/engine/light";

const T = { timeout: 20_000 };
const loaded = () => waitFor(() => expect(lastEditor?.state.planResult).not.toBeNull(), T);
const obj = (id: string) => lastEditor!.state.design!.objects.find((o) => o.id === id)!;

beforeEach(() => {
  setPlatform(createMockPlatform({ kind: "tauri" }).platform);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  setPlatform(null);
});

/** The test design with a second fill, so "all shapes of that kind" means two. */
function twoFills() {
  const d = testDesign();
  const f1 = d.objects[0] as FillObject;
  d.objects.push({ ...f1, id: "f2", name: "Frame 2", params: { ...DEFAULT_FILL_PARAMS, rowSpacingMm: 0.5 } });
  return d;
}

describe("SafeSlider", () => {
  it("is green inside the range: a band behind it, a green dot, no reason", async () => {
    renderEditor(<SafeSlider label="Spacing" param="satinDensity" value={0.4} onChange={() => {}} />, { design: testDesign() });
    expect(screen.getByTestId("safe-band")).toBeTruthy();
    expect(screen.getByRole("img", { name: "In the safe range" }).getAttribute("data-status")).toBe("ok");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("goes amber outside the range and says why in one sentence", async () => {
    renderEditor(<SafeSlider label="Spacing" param="satinDensity" value={0.3} onChange={() => {}} />, { design: testDesign() });
    expect(screen.getByRole("img", { name: "Outside the safe range" }).getAttribute("data-status")).toBe("warn");
    expect(screen.getByRole("status").textContent).toBe("Too tight. The fabric puckers and the thread can break.");
  });

  it("says the high-side reason too, and keeps working: the value still changes", async () => {
    let got = 0;
    renderEditor(<SafeSlider label="Spacing" param="satinDensity" value={0.9} onChange={(v) => (got = v)} />, { design: testDesign() });
    expect(screen.getByRole("status").textContent).toMatch(/Gaps/);
    fireEvent.change(screen.getByLabelText("Spacing"), { target: { value: "1.1" } });
    expect(got).toBe(1.1);
  });

  it("follows the thread weight: 0.30 mm spacing is fine at 60 wt", async () => {
    const d = testDesign();
    d.sewing = { fabric: "suiting", threadWeight: 60, quality: "standard" };
    renderEditor(<SafeSlider label="Spacing" param="satinDensity" value={0.3} onChange={() => {}} />, { design: d });
    await loaded();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("formats the what-will-this-change line", () => {
    expect(formatDelta(1240, 90)).toBe("+1,240 stitches · +1 min 30 s");
    expect(formatDelta(-1, -5)).toBe("−1 stitch · −5 s");
    expect(formatDelta(0, 0)).toMatch(/No change/);
  });
});

describe("SettingsPanel sliders", () => {
  it("a fill's row spacing goes amber outside 0.35 to 0.60, and the number box still takes it", async () => {
    renderEditor(<SettingsPanel />, { design: testDesign() });
    await loaded();
    act(() => lastEditor!.actions.setSelection(["f1"]));
    const line = screen.getByLabelText("Row spacing").closest(".field-line") as HTMLElement;
    expect(line.getAttribute("data-safe")).toBe("ok");
    fireEvent.change(screen.getByLabelText("Row spacing"), { target: { value: "0.3" } });
    expect(line.getAttribute("data-safe")).toBe("low");
    expect(within(line).getByRole("status").textContent).toMatch(/Too tight/);
    expect((obj("f1") as FillObject).params.rowSpacingMm).toBeCloseTo(0.3);
  });

  it("shows how a change moved the stitches and the time, from the live plan", async () => {
    renderEditor(<SettingsPanel />, { design: testDesign() });
    await loaded();
    act(() => lastEditor!.actions.setSelection(["f1"]));
    const slider = screen.getByLabelText("Row spacing");
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: "0.3" } });
    fireEvent.pointerUp(slider);
    await waitFor(() => expect(screen.getByLabelText("Row spacing: what this changes").textContent).toMatch(/^\+[\d,]+ stitches \u00b7 \+/), T);
  });
});

describe("Stitch safety card", () => {
  it("lists a row for each setting the design uses, and none for ones it does not", () => {
    const d = testDesign();
    const rows = safetyRows(d).map((r) => r.param);
    expect(rows).toEqual(["satinWidth", "satinDensity", "fillRowSpacing", "fillStitchLength", "runStitchLength", "pullComp"]);
    expect(safetyRows({ ...d, objects: d.objects.filter((o) => o.kind === "fill") }).map((r) => r.param)).toEqual(["fillRowSpacing", "fillStitchLength", "pullComp"]);
    expect(safetyRows(null)).toEqual([]);
  });

  it("shows a range across shapes and the worst status", async () => {
    renderEditor(<StitchSafetyCard />, { design: twoFills() });
    await loaded();
    act(() => lastEditor!.actions.updateObjects(["f2"], "x", (o) => void (o.kind === "fill" && (o.params.rowSpacingMm = 0.7))));
    const row = screen.getByLabelText("Fill row spacing").closest(".field-line") as HTMLElement;
    expect(row.getAttribute("data-safe")).toBe("high");
    expect(row.textContent).toMatch(/2 shapes: 0\.4 to 0\.7 mm/);
    expect(row.textContent).toMatch(/1 outside the green/);
    expect(within(row).getByRole("status").textContent).toMatch(/Gaps/);
  });

  it("changes every shape of that kind, as one undo step", async () => {
    renderEditor(<StitchSafetyCard />, { design: twoFills() });
    await loaded();
    const slider = screen.getByLabelText("Fill row spacing");
    for (const v of ["0.45", "0.5", "0.55"]) fireEvent.change(slider, { target: { value: v } });
    fireEvent.pointerUp(slider);
    expect((obj("f1") as FillObject).params.rowSpacingMm).toBeCloseTo(0.55);
    expect((obj("f2") as FillObject).params.rowSpacingMm).toBeCloseTo(0.55);
    act(() => lastEditor!.actions.undo());
    expect((obj("f1") as FillObject).params.rowSpacingMm).toBeCloseTo(0.4);
    expect((obj("f2") as FillObject).params.rowSpacingMm).toBeCloseTo(0.5);
  });

  it("leaves other kinds alone, and skips locked shapes", async () => {
    renderEditor(<StitchSafetyCard />, { design: twoFills() });
    await loaded();
    act(() => lastEditor!.actions.updateObjects(["f2"], "lock", (o) => void (o.locked = true)));
    const before = (obj("s1") as SatinObject).params.densityMm;
    const slider = screen.getByLabelText("Fill stitch length");
    fireEvent.change(slider, { target: { value: "3.2" } });
    fireEvent.pointerUp(slider);
    expect((obj("f1") as FillObject).params.stitchLengthMm).toBeCloseTo(3.2);
    expect((obj("f2") as FillObject).params.stitchLengthMm).toBe(DEFAULT_FILL_PARAMS.stitchLengthMm);
    expect((obj("s1") as SatinObject).params.densityMm).toBe(before);
  });

  it("a satin shape's width is read only: it is its drawing", async () => {
    renderEditor(<StitchSafetyCard />, { design: testDesign() });
    await loaded();
    expect((screen.getByLabelText("Satin width") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByLabelText("Satin width").closest(".field-line")!.textContent).toMatch(/Reshape it/);
  });

  it("setSafeValue edits run-type satin through its satin params", () => {
    const d = testDesign();
    d.objects.push({ id: "rs", name: "RS", kind: "run", threadId: d.threads[0].id, geometry: { path: [[0, 0], [10, 0]], closed: false }, params: { stitchLengthMm: 2.5, repeats: 1, type: "satin", widthMm: 2 } });
    const o = d.objects[3];
    setSafeValue(o, "satinDensity", 0.5);
    setSafeValue(o, "satinWidth", 1.2);
    expect(o.kind === "run" && o.params.satin?.densityMm).toBe(0.5);
    expect(o.kind === "run" && o.params.widthMm).toBe(1.2);
    setSafeValue(d.objects[1], "satinDensity", 0.1); // a plain run has no satin spacing: nothing happens
    expect(d.objects[1].kind === "run" && d.objects[1].params.satin).toBeUndefined();
  });

  it("rounds what it shows: 1 decimal for 0.1 steps, 2 otherwise (never 5.828)", async () => {
    expect([decimalsFor("satinWidth"), decimalsFor("satinDensity"), decimalsFor("fillRowSpacing"), decimalsFor("pullComp")]).toEqual([1, 2, 2, 2]);
    expect(roundFor("satinWidth", 5.828)).toBe(5.8);
    expect(roundFor("fillRowSpacing", 0.46666)).toBe(0.47);
    expect(rangeText({ param: "satinWidth", min: 4.72, max: 6.23 })).toBe("4.7 to 6.2 mm");
    expect(rangeText({ param: "satinDensity", min: 0.4, max: 0.4 })).toBe("0.4 mm");
    const d = twoFills();
    (d.objects[0] as FillObject).params.rowSpacingMm = 0.4;
    renderEditor(<StitchSafetyCard />, { design: d });
    await loaded();
    act(() => lastEditor!.actions.updateObjects(["f2"], "x", (o) => void (o.kind === "fill" && (o.params.rowSpacingMm = 0.4333333))));
    act(() => lastEditor!.actions.updateObjects(["f1"], "x", (o) => void (o.kind === "fill" && (o.params.rowSpacingMm = 0.5))));
    const box = screen.getByLabelText("Fill row spacing value") as HTMLInputElement;
    expect(box.value).toBe("0.47"); // mean 0.46666...
  });

  it("says nothing to check for an empty design", () => {
    renderEditor(<StitchSafetyCard />);
    expect(screen.getByText(/Nothing to check yet/)).toBeTruthy();
  });
});

describe("Before you sew: speed", () => {
  it("says what speed to set and why, with the time at that speed next to the time at 850", async () => {
    const d = testDesign();
    // a 1.5 mm run-type satin: thin lines in this design
    d.objects.push({ id: "thin", name: "Thin", kind: "run", threadId: d.threads[0].id, geometry: { path: [[0, 0], [20, 0]], closed: false }, params: { stitchLengthMm: 2.5, repeats: 1, type: "satin", widthMm: 1.5 } });
    renderEditor(<BeforeYouSew />, { design: d });
    await loaded();
    const note = await screen.findByLabelText("Machine speed");
    expect(note.textContent).toMatch(/Set your machine to 450 stitches a minute \(thin lines in this design\)\./);
    expect(note.textContent).toMatch(/Settings for Max embroidery speed/);
    expect(note.textContent).not.toMatch(/NV2700/);
    const facts = screen.getByLabelText("Sewing facts").textContent!;
    expect(facts).toMatch(/Time at 850 spm≈/);
    expect(facts).toMatch(/Time at 450 spm≈/);
    const r = lastEditor!.state.planResult!;
    expect(planStats(r.plan, 450).estimatedSeconds).toBeGreaterThan(r.stats.estimatedSeconds);
  });

  it("the copied text carries the same sentence", async () => {
    const d = testDesign();
    renderEditor(<BeforeYouSew />, { design: d });
    await loaded();
    const r = lastEditor!.state.planResult!;
    const setup = resolveSewingSetup({ fabric: "suiting", threadWeight: 40, quality: "standard" });
    const sp = recommendedMachineSpeed(d, setup.input, r);
    const text = sewText({ name: "x", setup, hoop: d.hoop, threads: d.threads, facts: null, speed: { spm: sp.spm, reasons: sp.reasons, seconds: 60 } });
    expect(text).toContain(speedSentence(sp));
    expect(text).toMatch(/Max embroidery speed/);
    expect(text).not.toMatch(/Recommended speed/);
  });
});

describe("Export window lists amber items", () => {
  it("amber stitch settings sit with the plan's warnings, and nothing blocks Save", async () => {
    const d = testDesign();
    (d.objects[0] as FillObject).params.rowSpacingMm = 0.3;
    renderEditor(<ExportDialog onClose={() => {}} onSaved={() => {}} />, { design: d });
    const list = await screen.findByRole("list", { name: "Warnings" }, T);
    expect(list.textContent).toMatch(/Fill row spacing: .*Too tight/);
    expect((screen.getByRole("button", { name: /Save PES/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("safetyNotes leaves satin width to the thin-satin warning", () => {
    const d = testDesign();
    d.objects[2] = { ...(d.objects[2] as SatinObject), geometry: { strip: [[-12, 18], [-12, 18.8], [-4, 18], [-4, 18.8], [4, 18], [4, 18.8]] } };
    expect(safetyRows(d).find((r) => r.param === "satinWidth")!.check.status).toBe("low");
    expect(safetyNotes(d).join(" ")).not.toMatch(/Satin width/);
  });
});
