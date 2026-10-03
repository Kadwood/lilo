// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { lastEditor, renderEditor, testDesign } from "../test/helpers";
import { DigitizePanel } from "./DigitizePanel";

afterEach(cleanup);
const T = { timeout: 20_000 };

describe("DigitizePanel", () => {
  it("offers the three Brother catalogues and defaults to Brother Embroidery", () => {
    renderEditor(<DigitizePanel onOpen={() => {}} />);
    const sel = screen.getByLabelText("Thread brand") as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(["Brother Embroidery (61)", "Brother Country (61)", "Brothread 40 (40)"]);
    expect(sel.value).toBe("brother-embroidery");
    fireEvent.change(sel, { target: { value: "brothread-40" } });
    expect(lastEditor!.state.options.catalogueId).toBe("brothread-40");
  });

  it("colour slider spans 2-12 and defaults to 6", () => {
    renderEditor(<DigitizePanel onOpen={() => {}} />);
    const s = screen.getByLabelText("Colour count") as HTMLInputElement;
    expect([s.min, s.max, s.value]).toEqual(["2", "12", "6"]);
    fireEvent.change(s, { target: { value: "9" } });
    expect(lastEditor!.state.options.colors).toBe(9);
  });

  it("keeps the aspect ratio when locked and frees it when unlocked", async () => {
    renderEditor(<DigitizePanel onOpen={() => {}} />, { design: testDesign() });
    await waitFor(() => expect(lastEditor?.state.design).not.toBeNull(), T);
    const w = screen.getByLabelText("Width in millimetres") as HTMLInputElement;
    const h = screen.getByLabelText("Height in millimetres") as HTMLInputElement;
    const aspect = Number(w.value) / Number(h.value);
    fireEvent.change(w, { target: { value: "40" } });
    expect(lastEditor!.state.options.widthMm).toBe(40);
    expect(lastEditor!.state.options.heightMm).toBeCloseTo(40 / aspect, 0);
    fireEvent.click(screen.getByLabelText("Lock aspect ratio"));
    fireEvent.change(w, { target: { value: "50" } });
    expect(lastEditor!.state.options.widthMm).toBe(50);
    expect(lastEditor!.state.options.heightMm).toBeCloseTo(40 / aspect, 0); // unchanged
  });

  it("toggles background removal and the min-region slider", () => {
    renderEditor(<DigitizePanel onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(lastEditor!.state.options.removeBackground).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(lastEditor!.state.options.removeBackground).toBe(true);
    fireEvent.change(screen.getByLabelText("Minimum region size"), { target: { value: "5" } });
    expect(lastEditor!.state.options.minRegionMm2).toBe(5);
  });

  it("has Quality, Thread weight and Fabric selects that feed the engine options", () => {
    renderEditor(<DigitizePanel onOpen={() => {}} />);
    const q = screen.getByLabelText("Quality") as HTMLSelectElement;
    expect(q.value).toBe("standard");
    fireEvent.change(q, { target: { value: "premium" } });
    expect(lastEditor!.state.options.quality).toBe("premium");
    fireEvent.change(screen.getByLabelText("Thread weight"), { target: { value: "60" } });
    expect(lastEditor!.state.options.threadWeight).toBe(60);
    fireEvent.change(screen.getByLabelText("Fabric"), { target: { value: "knit" } });
    expect(lastEditor!.state.options.fabric).toBe("knit");
    expect(screen.getByLabelText("Sewing setup summary").textContent).toMatch(/Premium on knit/i);
  });

  it("disables Digitize until an image is loaded, and calls onOpen", () => {
    let opened = 0;
    renderEditor(<DigitizePanel onOpen={() => opened++} />);
    expect((screen.getByRole("button", { name: "Digitize" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /^Open image/ }));
    expect(opened).toBe(1);
  });
});
