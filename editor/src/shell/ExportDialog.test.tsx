// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { readEmbroidery } from "@lilo/engine";
import { FORMAT_EXTENSIONS } from "@lilo/engine/light";
import { createMockPlatform, type MockState } from "../platform/mock";
import { setPlatform } from "../platform";
import { lastEditor, renderEditor, testDesign } from "../test/helpers";
import { cleanName, ExportDialog, EXPORT_CHOICES } from "./ExportDialog";

const T = { timeout: 20_000 };
let mock: MockState;
beforeEach(() => {
  const m = createMockPlatform();
  mock = m.state;
  setPlatform(m.platform);
});
afterEach(() => {
  cleanup();
  setPlatform(null);
});

async function open(onClose = vi.fn(), onSaved = vi.fn()) {
  renderEditor(<ExportDialog onClose={onClose} onSaved={onSaved} />, { design: testDesign() });
  await waitFor(() => expect(lastEditor?.state.planResult).not.toBeNull(), T);
  const dlg = screen.getByRole("dialog", { name: "Export" });
  await waitFor(() => expect((within(dlg).getByRole("button", { name: /^Save/ }) as HTMLButtonElement).disabled).toBe(false), T);
  return { dlg, onClose, onSaved };
}
const choose = (dlg: HTMLElement, name: RegExp) => fireEvent.click(within(dlg).getByRole("radio", { name }));
const ready = (dlg: HTMLElement, label: string) => waitFor(() => expect((within(dlg).getByRole("button", { name: label }) as HTMLButtonElement).disabled).toBe(false), T);

describe("Export dialog", () => {
  it("lists every format with PES first and selected, then the PNG", async () => {
    const { dlg } = await open();
    const radios = within(dlg).getAllByRole("radio").filter((r) => r.closest(".format-list"));
    expect(radios.map((r) => r.textContent!.slice(0, 3))).toEqual(["PES", "DST", "JEF", "VP3", "EXP", "XXX", "U01", "PEC", "HUS", "VIP", "TBF", "GCO", "PNG"]);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(within(dlg).getByRole("button", { name: "Save PES" })).toBeTruthy();
    expect(new Set(EXPORT_CHOICES.map((c) => c.id))).toEqual(new Set([...FORMAT_EXTENSIONS, "png"]));
  });

  it.each(["pes", "dst", "jef", "vp3", "exp", "xxx", "u01", "pec", "hus", "vip", "tbf"] as const)("saves %s: the file has the right extension and reads back with stitches", async (ext) => {
    const { dlg, onClose, onSaved } = await open();
    if (ext !== "pes") choose(dlg, new RegExp(`^${ext.toUpperCase()}`));
    await ready(dlg, `Save ${ext.toUpperCase()}`);
    fireEvent.click(within(dlg).getByRole("button", { name: `Save ${ext.toUpperCase()}` }));
    await waitFor(() => expect(mock.saved).toHaveLength(1), T);
    expect(mock.saved[0].name).toBe(`Untitled design.${ext}`);
    expect(readEmbroidery(mock.saved[0].bytes, ext).plan.stitches.filter((s) => s.type === "stitch").length).toBeGreaterThan(100);
    expect(onSaved).toHaveBeenCalledWith(expect.stringContaining(`.${ext}`));
    expect(onClose).toHaveBeenCalled();
  }, 30_000);

  it("saves G-code as a stitch path, and says it is not a sewing machine file", async () => {
    const { dlg } = await open();
    choose(dlg, /^GCODE/);
    expect(within(dlg).getByRole("note").textContent).toMatch(/Not a sewing machine file/);
    await ready(dlg, "Save GCODE");
    fireEvent.click(within(dlg).getByRole("button", { name: "Save GCODE" }));
    await waitFor(() => expect(mock.saved).toHaveLength(1), T);
    expect(mock.saved[0].name).toBe("Untitled design.gcode");
    const text = new TextDecoder().decode(mock.saved[0].bytes);
    expect(text).toMatch(/^\(STITCH_COUNT: \d+\)/);
    expect(text.trimEnd().endsWith("M30")).toBe(true);
    expect(text.match(/^G00 X/gm)!.length).toBeGreaterThan(100);
  }, 30_000);

  it("says when a format does not keep thread colours", async () => {
    const { dlg } = await open();
    expect(within(dlg).getByRole("note").textContent).toBe("Keeps thread colours.");
    choose(dlg, /^DST/);
    expect(within(dlg).getByRole("note").textContent).toMatch(/No thread colours in this format/);
    choose(dlg, /^VP3/);
    expect(within(dlg).getByRole("note").textContent).toBe("Keeps thread colours.");
  });

  it("PNG saves a picture of the stitches and has no origin picker", async () => {
    const { dlg } = await open();
    expect(within(dlg).getByRole("radiogroup", { name: "Origin point" })).toBeTruthy();
    choose(dlg, /^PNG/);
    expect(within(dlg).queryByRole("radiogroup", { name: "Origin point" })).toBeNull();
    await ready(dlg, "Save PNG");
    fireEvent.click(within(dlg).getByRole("button", { name: "Save PNG" }));
    await waitFor(() => expect(mock.saved).toHaveLength(1), T);
    expect(mock.saved[0].name).toBe("Untitled design.png");
    expect(Array.from(mock.saved[0].bytes.slice(0, 4))).toEqual([137, 80, 78, 71]);
    expect(mock.saved[0].bytes.length).toBeGreaterThan(5000);
  });

  it("shows the export stats and the origin changes the file", async () => {
    const { dlg } = await open();
    const stats = within(dlg).getByLabelText("Export stats");
    expect(within(stats).getByText("Stitches").nextElementSibling!.textContent).not.toBe("0");
    fireEvent.click(within(dlg).getByRole("button", { name: "Save PES" }));
    await waitFor(() => expect(mock.saved).toHaveLength(1), T);
    const centre = mock.saved[0].bytes;
    fireEvent.click(within(dlg).getByRole("radio", { name: "top left" }));
    await waitFor(() => expect((within(dlg).getByRole("button", { name: "Save PES" }) as HTMLButtonElement).disabled).toBe(false), T);
    fireEvent.click(within(dlg).getByRole("button", { name: "Save PES" }));
    await waitFor(() => expect(mock.saved).toHaveLength(2), T);
    expect(Array.from(mock.saved[1].bytes)).not.toEqual(Array.from(centre));
  });

  it("Esc closes it from the keyboard (focus starts inside)", async () => {
    const { dlg, onClose } = await open();
    expect(dlg.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("file names are made safe and lose a known extension", () => {
    expect(cleanName("My: crest/v2.dst")).toBe("My_ crest_v2");
    expect(cleanName("")).toBe("design");
    expect(cleanName("logo.PNG")).toBe("logo");
    expect(cleanName("a.b")).toBe("a.b");
  });
});
