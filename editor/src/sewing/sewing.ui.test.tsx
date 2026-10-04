// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { markAutoParams, presetParamsFor, resolveSewingSetup, DEFAULT_SPM, recommendedSpeed, type Design, type SatinObject } from "@lilo/engine/light";
import { DigitizePanel } from "../panels/DigitizePanel";
import { createMockPlatform } from "../platform/mock";
import { setPlatform } from "../platform";
import { ExportDialog } from "../shell/ExportDialog";
import { SendDialog } from "../shell/SendDialog";
import { lastEditor, renderEditor, testDesign } from "../test/helpers";
import { BeforeYouSew, sewItems, sewText, threadLabel, threadsInSewingOrder } from "./BeforeYouSew";
import { SewingCard, sewingChip } from "./SewingCard";

const T = { timeout: 20_000 };
const loaded = () => waitFor(() => expect(lastEditor?.state.planResult).not.toBeNull(), T);

beforeEach(() => {
  setPlatform(createMockPlatform({ kind: "tauri" }).platform);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  setPlatform(null);
});

/** What Auto digitize hands over: shapes carrying the setup's values, marked. */
function generated(setup: Parameters<typeof markAutoParams>[1]): Design {
  const d = testDesign();
  const sew = resolveSewingSetup(setup).engine;
  for (const o of d.objects) {
    const t = presetParamsFor(o, sew);
    if (t) Object.assign(o.params, JSON.parse(JSON.stringify(t)));
  }
  return markAutoParams(d, setup);
}
const satinOf = () => lastEditor!.state.design!.objects.find((o) => o.kind === "satin") as SatinObject;

describe("sewing setup card", () => {
  it("shows the whole setup as one chip: fabric, thread weight, quality, hoop", async () => {
    renderEditor(<SewingCard />, { design: testDesign() });
    await loaded();
    expect(screen.getByRole("button", { name: /Suiting · 40 wt · Standard · 160×260/ })).toBeTruthy();
    expect(sewingChip("Shirting / lining (light woven)", 60, "Premium", { widthMm: 129.6, heightMm: 180 })).toBe("Shirting · 60 wt · Premium · 130×180");
  });

  it("opens into the card with a plain-English line, needle, stabiliser and topping for each choice", async () => {
    renderEditor(<SewingCard />, { design: testDesign() });
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /Suiting/ }));
    const card = screen.getByRole("region", { name: "Sewing setup" });
    fireEvent.change(within(card).getByLabelText("Fabric"), { target: { value: "knit" } });
    expect(within(card).getByText(/Stretchy cloth/)).toBeTruthy();
    const facts = within(card).getByLabelText("What this setup calls for");
    expect(facts.textContent).toMatch(/75\/11 ballpoint/);
    expect(facts.textContent).toMatch(/cut-away/);
    expect(facts.textContent).toMatch(/Topping.*none/);
    fireEvent.change(within(card).getByLabelText("Fabric"), { target: { value: "towel" } });
    expect(within(card).getByLabelText("What this setup calls for").textContent).toMatch(/water-soluble/);
    fireEvent.change(within(card).getByLabelText("Quality"), { target: { value: "premium" } });
    expect(within(card).getByText(/Settings a professional/)).toBeTruthy();
  });

  it("stores the choice in the design, as one undo step", async () => {
    renderEditor(<SewingCard />, { design: testDesign() });
    await loaded();
    expect(lastEditor!.state.design!.sewing).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: /Suiting/ }));
    fireEvent.change(screen.getByLabelText("Quality"), { target: { value: "premium" } });
    expect(lastEditor!.state.design!.sewing).toEqual({ fabric: "suiting", threadWeight: 40, quality: "premium" });
    expect(screen.getByRole("button", { name: /Premium/ })).toBeTruthy();
    act(() => lastEditor!.actions.undo());
    expect(lastEditor!.state.design!.sewing).toBeUndefined();
    act(() => lastEditor!.actions.redo());
    expect(lastEditor!.state.design!.sewing?.quality).toBe("premium");
  });

  it("re-applies the preset to auto-generated shapes and says what it kept", async () => {
    const d = generated({ fabric: "suiting", threadWeight: 40, quality: "standard" });
    renderEditor(<SewingCard />, { design: d });
    await loaded();
    const before = satinOf().params.pullCompMm;
    // the user typed their own density into this column
    act(() => lastEditor!.actions.updateObjects(["s1"], "Density", (o) => void (o.kind === "satin" && (o.params.densityMm = 0.55))));
    fireEvent.click(screen.getByRole("button", { name: /Suiting/ }));
    fireEvent.change(screen.getByLabelText("Fabric"), { target: { value: "knit" } });
    expect(satinOf().params.pullCompMm).toBeGreaterThan(before); // knit: more pull compensation
    expect(satinOf().params.densityMm).toBe(0.55); // hand edit kept
    expect(screen.getByRole("status").textContent).toMatch(/updated; 1 value you set by hand kept/);
    // one undo brings back both the setup and the old values
    act(() => lastEditor!.actions.undo());
    expect(satinOf().params.pullCompMm).toBe(before);
    expect(lastEditor!.state.design!.sewing?.fabric).toBe("suiting");
  });

  it("tells you when nothing in the design came from Auto digitize", async () => {
    renderEditor(<SewingCard />, { design: testDesign() });
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /Suiting/ }));
    fireEvent.change(screen.getByLabelText("Quality"), { target: { value: "premium" } });
    expect(screen.getByRole("status").textContent).toMatch(/Nothing in this design came from Auto digitize/);
  });

  it("a saved design brings its setup back, and the digitize panel's selectors follow the same setup", async () => {
    const d = generated({ fabric: "denim", threadWeight: 60, quality: "premium" });
    renderEditor(
      <>
        <SewingCard />
        <DigitizePanel onOpen={() => {}} />
      </>,
      { design: d },
    );
    await loaded();
    expect(lastEditor!.state.options).toMatchObject({ fabric: "denim", threadWeight: 60, quality: "premium" });
    const panel = screen.getAllByLabelText("Fabric")[0] as HTMLSelectElement;
    expect(panel.value).toBe("denim");
    expect(screen.getByRole("button", { name: /Denim · 60 wt · Premium/ })).toBeTruthy();
    // changing it in the panel changes the design, not just the next digitize
    fireEvent.change(panel, { target: { value: "twill" } });
    expect(lastEditor!.state.design!.sewing?.fabric).toBe("twill");
    expect(screen.getByRole("button", { name: /Twill · 60 wt · Premium/ })).toBeTruthy();
  });

  it("with no design yet, the choice is remembered for the next digitize", () => {
    renderEditor(<SewingCard />);
    fireEvent.click(screen.getByRole("button", { name: /Suiting/ }));
    fireEvent.change(screen.getByLabelText("Thread weight"), { target: { value: "60" } });
    expect(lastEditor!.state.options.threadWeight).toBe(60);
    expect(lastEditor!.state.design).toBeNull();
  });
});

describe("Before you sew", () => {
  it("lists the setup, the hoop and the threads in sewing order, with stitches, time and speed", async () => {
    renderEditor(<BeforeYouSew />, { design: testDesign() });
    await loaded();
    const list = screen.getByRole("list", { name: "Setup checklist" });
    expect(within(list).getAllByRole("checkbox").length).toBeGreaterThanOrEqual(8);
    expect(list.textContent).toMatch(/Needle: 75\/11 sharp/);
    expect(list.textContent).toMatch(/Hoop: NV2700 160 x 260/);
    const threads = screen.getByRole("list", { name: "Threads in sewing order" });
    const rows = within(threads).getAllByRole("checkbox");
    expect(rows).toHaveLength(2); // blue (fill + run), then red (satin)
    expect(threads.textContent).toMatch(/1\. Brother \d+ Blue/);
    expect(threads.textContent).toMatch(/2\. Brother \d+ Red/);
    expect(threads.querySelectorAll(".swatch")).toHaveLength(2);
    const facts = screen.getByLabelText("Sewing facts");
    expect(facts.textContent).toMatch(/Stitches[\d,]+/);
    expect(facts.textContent).toMatch(new RegExp(`Time at ${DEFAULT_SPM} spm≈`));
    // one recommendation only: the design-aware speed. The fabric range is folded into its reasons.
    expect(facts.textContent).not.toMatch(/Recommended speed/);
    const speed = recommendedSpeed("suiting", 40);
    const advice = screen.getByLabelText("Machine speed");
    expect(advice.textContent).toMatch(/Set your machine to \d+ stitches a minute/);
    expect(advice.textContent).toContain(`usually sews at ${speed.minSpm} to ${speed.maxSpm} stitches a minute`);
    expect(screen.getAllByText(/Set your machine to/)).toHaveLength(1);
  });

  it("follows the fabric: the checklist and the speed change with the setup", async () => {
    renderEditor(<BeforeYouSew />, { design: generated({ fabric: "leather", threadWeight: 40, quality: "standard" }) });
    await loaded();
    expect(screen.getByRole("list", { name: "Setup checklist" }).textContent).toMatch(/leather\/wedge/);
    expect(screen.getByLabelText("Machine speed").textContent).toContain(`usually sews at ${recommendedSpeed("leather", 40).minSpm} to`);
  });

  it("ticks are for this session only and counted", async () => {
    const { unmount } = renderEditor(<BeforeYouSew />, { design: testDesign() });
    await loaded();
    const boxes = screen.getAllByRole("checkbox");
    expect(screen.getByText(`0 of ${boxes.length} ticked`)).toBeTruthy();
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    expect(screen.getByText(`2 of ${boxes.length} ticked`)).toBeTruthy();
    fireEvent.click(boxes[1]);
    expect(screen.getByText(`1 of ${boxes.length} ticked`)).toBeTruthy();
    unmount();
    renderEditor(<BeforeYouSew />, { design: testDesign() });
    await loaded();
    expect(screen.getByText(/^0 of \d+ ticked$/)).toBeTruthy(); // nothing saved
  });

  it("Copy as text puts the whole card on the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderEditor(<BeforeYouSew />, { design: testDesign() });
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Copy as text" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toMatch(/^Before you sew:/);
    expect(text).toMatch(/\[ \] Needle: 75\/11 sharp/);
    expect(text).toMatch(/Threads, in sewing order:\n\[ \] 1\. Brother/);
    expect(text).toMatch(/Stitches: [\d,]+\. Colour changes: 1\./);
    expect(text).toMatch(new RegExp(`at ${DEFAULT_SPM} stitches a minute`));
    expect(text).toMatch(/Set your machine to \d+ stitches a minute/);
    expect(text).toMatch(/Suiting usually sews at 600 to 800 stitches a minute/);
    expect(text).not.toMatch(/Recommended speed/);
    expect(await screen.findByText("Copied.")).toBeTruthy();
  });

  it("says so when copying is not allowed", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    renderEditor(<BeforeYouSew />, { design: testDesign() });
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Copy as text" }));
    expect(await screen.findByText(/Could not copy/)).toBeTruthy();
  });

  it("is in the Export dialog and in the Send dialog", async () => {
    const a = renderEditor(<ExportDialog onClose={() => {}} onSaved={() => {}} />, { design: testDesign() });
    await loaded();
    expect(within(screen.getByRole("dialog", { name: "Export" })).getByRole("heading", { name: "Before you sew" })).toBeTruthy();
    a.unmount();
    renderEditor(<SendDialog onClose={() => {}} />, { design: testDesign() });
    await loaded();
    expect(within(screen.getByRole("dialog", { name: "Send to machine" })).getByRole("heading", { name: "Before you sew" })).toBeTruthy();
  });
});

describe("the checklist text and order (pure)", () => {
  it("merges neighbouring objects of one thread and lists a thread that returns again", () => {
    const d = testDesign();
    const [blue, red] = d.threads;
    d.objects = [d.objects[0], d.objects[1], d.objects[2], { ...d.objects[1], id: "r2", threadId: blue.id }];
    expect(threadsInSewingOrder(d).map((t) => t.id)).toEqual([blue.id, red.id, blue.id]);
    d.objects[1].visible = false;
    expect(threadsInSewingOrder(d).map((t) => t.id)).toEqual([blue.id, red.id, blue.id]);
    expect(threadsInSewingOrder(null)).toEqual([]);
  });

  it("builds the same items for the screen and the text", () => {
    const d = testDesign();
    const setup = resolveSewingSetup({ fabric: "towel" });
    const items = sewItems(setup, d.hoop, d.threads);
    const text = sewText({ name: "Crest", setup, hoop: d.hoop, threads: d.threads, facts: { stitchCount: 12345, colorChanges: 2, estimatedSeconds: 900 } });
    for (const i of [...items.setup, items.hoop, ...items.threads]) expect(text).toContain(i.text);
    expect(text).toContain("Stitches: 12,345. Colour changes: 2. About 15 min 00 s");
    expect(text).toContain("Topping: lay a sheet of water-soluble topping");
    expect(threadLabel(d.threads[0])).toMatch(/^Brother \d+ Blue$/);
  });
});
