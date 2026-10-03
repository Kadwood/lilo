// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { addEntry, emptyShelf, exportShelf, type PixelArt } from "@lilo/engine/light";
import { readEmbroidery as readFile } from "@lilo/engine";
import { createMockPlatform, type MockState } from "../platform/mock";
import { setPlatform } from "../platform";
import { pixel, isBlank } from "../state/pixelStore";
import { resetShelfStore } from "../state/shelfStore";
import { lastEditor, renderEditor } from "../test/helpers";
import { AppContext, type AppApi } from "./AppContext";
import { PixelView } from "./PixelView";
import { pixelCommands } from "./pixelCommands";
import { createInlineEngine } from "../engine/client";

// a 2 x 2 picture: red, blue / blue, red
vi.mock("../io/decode", async (orig) => {
  const real = await orig<typeof import("../io/decode")>();
  const px = (r: number, g: number, b: number) => [r, g, b, 255];
  const data = new Uint8ClampedArray([...px(237, 23, 31), ...px(27, 58, 138), ...px(27, 58, 138), ...px(237, 23, 31)]);
  return { ...real, decodeFile: vi.fn(async () => ({ kind: "raster", image: { width: 2, height: 2, data }, reference: null })) };
});

const T = { timeout: 20_000 };
let mock: MockState;
let go: ReturnType<typeof vi.fn>;
const api = (): AppApi => ((go = vi.fn()), { view: "pixel", go: go as unknown as AppApi["go"] });

beforeEach(() => {
  resetShelfStore();
  const m = createMockPlatform({ kind: "tauri" });
  mock = m.state;
  setPlatform(m.platform);
  pixel.actions.load(null);
  pixel.actions.setTool("pencil");
  pixel.actions.setExportOpen(false);
  pixel.actions.setMessage(null);
});
afterEach(() => {
  cleanup();
  setPlatform(null);
  resetShelfStore();
});

const mount = () => renderEditor(<AppContext.Provider value={api()}><PixelView /></AppContext.Provider>);
const canvas = () => screen.getByTestId("pixel-canvas");
// jsdom: no layout, so the cell size is the fallback 16 px
const at = (x: number, y: number) => ({ clientX: x * 16 + 8, clientY: y * 16 + 8, button: 0 });
const click = (x: number, y: number) => {
  fireEvent.pointerDown(canvas(), at(x, y));
  fireEvent.pointerUp(canvas(), at(x, y));
};
const colour = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const art = (): PixelArt => pixel.store.getState().art;
const painted = () => art().cells.filter(Boolean).length;

describe("Pixel art view", () => {
  it("shows a 32 x 32 grid, the six tools, a palette and an empty preview", () => {
    mount();
    expect(canvas().getAttribute("aria-label")).toMatch(/32 by 32/);
    const tools = screen.getByRole("toolbar", { name: "Pixel tools" });
    expect(within(tools).getAllByRole("button").map((b) => b.textContent?.replace(/[A-Z]$/, ""))).toEqual(["Pencil", "Fill", "Erase", "Eyedropper", "Line", "Rectangle"]);
    expect(screen.getAllByRole("button", { name: /^Brother \d+ / }).length).toBeGreaterThan(20);
    expect(screen.getByText(/Paint some cells/)).toBeTruthy();
  });

  it("pencil: click paints a cell with the chosen thread; a drag paints a line; undo takes the whole drag back", () => {
    mount();
    colour(/^Brother 800 Red/);
    click(3, 4);
    expect(painted()).toBe(1);
    fireEvent.pointerDown(canvas(), at(5, 10));
    fireEvent.pointerMove(canvas(), at(9, 10));
    fireEvent.pointerUp(canvas(), at(9, 10));
    expect(painted()).toBe(1 + 5);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(painted()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(painted()).toBe(6);
  });

  it("without a colour it says so instead of silently doing nothing", () => {
    mount();
    click(1, 1);
    expect(screen.getByRole("alert").textContent).toMatch(/Pick a colour first/);
    expect(isBlank(art())).toBe(true);
  });

  it("tool shortcuts (G, E, I, L, R, B) switch tools and are off while typing", () => {
    mount();
    for (const [k, label] of [["g", "Fill"], ["e", "Erase"], ["i", "Eyedropper"], ["l", "Line"], ["r", "Rectangle"], ["b", "Pencil"]] as const) {
      fireEvent.keyDown(window, { key: k });
      expect(screen.getByRole("button", { name: new RegExp(`^${label}`) }).getAttribute("aria-pressed")).toBe("true");
    }
    fireEvent.keyDown(screen.getByLabelText("Cell size in millimetres"), { key: "g" });
    expect(screen.getByRole("button", { name: /^Pencil/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("line and rectangle: drag shows nothing painted until you let go; Esc cancels", () => {
    mount();
    colour(/^Brother 800 Red/);
    fireEvent.keyDown(window, { key: "l" });
    fireEvent.pointerDown(canvas(), at(2, 2));
    fireEvent.pointerMove(canvas(), at(8, 2));
    expect(painted()).toBe(0);
    fireEvent.pointerUp(canvas(), at(8, 2));
    expect(painted()).toBe(7);
    fireEvent.keyDown(window, { key: "r" });
    fireEvent.pointerDown(canvas(), at(2, 5));
    fireEvent.pointerMove(canvas(), at(6, 8));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(canvas(), at(6, 8));
    expect(painted()).toBe(7); // cancelled
    fireEvent.pointerDown(canvas(), at(2, 5));
    fireEvent.pointerUp(canvas(), at(6, 8));
    expect(painted()).toBe(7 + 14);
    fireEvent.click(screen.getByLabelText("Filled rectangles"));
    fireEvent.pointerDown(canvas(), at(10, 5));
    fireEvent.pointerUp(canvas(), at(12, 7));
    expect(painted()).toBe(7 + 14 + 9);
  });

  it("fill, erase and eyedropper work on the grid", () => {
    mount();
    colour(/^Brother 800 Red/);
    fireEvent.keyDown(window, { key: "g" });
    click(0, 0);
    expect(painted()).toBe(32 * 32);
    fireEvent.keyDown(window, { key: "e" });
    click(4, 4);
    expect(painted()).toBe(32 * 32 - 1);
    colour(/^Brother 406 Ultramarine/);
    fireEvent.keyDown(window, { key: "i" });
    click(1, 1); // pick red again
    expect(within(screen.getByRole("list", { name: "Colours in the picture" })).getByRole("button", { name: /800 Red/ }).className).toContain("active");
    expect(screen.getByRole("button", { name: /^Pencil/ }).getAttribute("aria-pressed")).toBe("true"); // back to the pencil after picking
  });

  it("the keyboard can draw: the grid takes focus, arrows move, Space paints", () => {
    mount();
    colour(/^Brother 800 Red/);
    canvas().focus();
    expect(document.activeElement).toBe(canvas());
    fireEvent.keyDown(canvas(), { key: "ArrowRight" });
    fireEvent.keyDown(canvas(), { key: "ArrowDown" });
    expect(canvas().getAttribute("aria-description")).toMatch(/Cell 2, 2: empty/);
    fireEvent.keyDown(canvas(), { key: " " });
    expect(art().cells[1 * 32 + 1]).not.toBeNull();
    expect(canvas().getAttribute("aria-description")).toMatch(/Cell 2, 2: Brother 800 Red/);
    fireEvent.keyDown(canvas(), { key: "ArrowLeft" });
    fireEvent.keyDown(canvas(), { key: "ArrowLeft" }); // stops at the edge
    expect(canvas().getAttribute("aria-description")).toMatch(/Cell 1, 2/);
  });

  it("resize, cell size and style change the grid; the stitched size follows", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Grid width in cells"), { target: { value: "16" } });
    fireEvent.change(screen.getByLabelText("Grid height in cells"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Resize" }));
    expect(art()).toMatchObject({ width: 16, height: 12 });
    fireEvent.change(screen.getByLabelText("Cell size in millimetres"), { target: { value: "3" } });
    expect(art().cellMm).toBe(3);
    expect(screen.getByText(/Stitched size 48\.0 × 36\.0 mm/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cross" }));
    expect(art().style).toBe("cross");
    fireEvent.change(screen.getByLabelText("Grid width in cells"), { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "Resize" }));
    expect(screen.getByRole("alert").textContent).toMatch(/1 to 256/);
    expect(art().width).toBe(16);
  });

  it("the palette can come from My Threads", async () => {
    mock.shelfJson = exportShelf(addEntry(emptyShelf(), { brand: "Local Mill", code: "A7", name: "Plum", hex: "#aa3366" }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /My Threads \(1\)/ }, T));
    const group = screen.getByRole("group", { name: "Palette colours" });
    expect(within(group).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(within(group).getByRole("button", { name: /Local Mill A7 Plum/ }));
    click(2, 2);
    expect(art().threads.map((t) => t.code)).toEqual(["A7"]);
    expect(screen.getByRole("list", { name: "Colours in the picture" }).textContent).toContain("A7 Plum");
  });

  it("imports a picture: shrunk to the grid and snapped to the palette, as one undo step", async () => {
    mock.pickFiles = [{ name: "tiny.png", bytes: new Uint8Array(4) }];
    mount();
    fireEvent.change(screen.getByLabelText("Grid width in cells"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Grid height in cells"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Resize" }));
    fireEvent.click(screen.getByLabelText("Keep the background")); // every cell of a 2 x 2 picture is a corner
    fireEvent.click(screen.getByRole("button", { name: "Import a picture…" }));
    await waitFor(() => expect(painted()).toBe(4), T);
    expect(art().threads.length).toBe(2);
    expect(art().cells[0]).not.toBe(art().cells[1]);
    expect(art().cells[0]).toBe(art().cells[3]);
    expect(await screen.findByText(/Made a 2 × 2 grid in 2 colours from tiny\.png/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(isBlank(art())).toBe(true);
  });
});

describe("Pixel art: stitches, send and export", () => {
  async function paintSome() {
    colour(/^Brother 800 Red/);
    for (let x = 4; x < 12; x++) click(x, 4);
    colour(/^Brother 406 Ultramarine/);
    for (let x = 4; x < 12; x++) click(x, 5);
  }

  it("shows the stitches live: counts, colour changes and size", async () => {
    mount();
    await paintSome();
    expect(await screen.findByText(/colour change/, undefined, T)).toBeTruthy();
    const totals = screen.getByLabelText("Design totals");
    expect(totals.textContent).toMatch(/1 colour change/);
    expect(Number(/\/ ([\d,]+) stitches/.exec(totals.textContent!)![1].replace(/,/g, ""))).toBeGreaterThan(100);
    expect(totals.textContent).toMatch(/20\.\d × [45]\.\d mm/);
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("Send to editor adds the stitches as manual objects, centred, in one undo step, and goes to the editor", async () => {
    mount();
    await paintSome();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Send to editor" }));
    await waitFor(() => expect(go).toHaveBeenCalledWith("editor"), T);
    const d = lastEditor!.state.design!;
    expect(d.objects.length).toBeGreaterThan(0);
    expect(d.objects.every((o) => o.kind === "run")).toBe(true); // manual stitches are runs that sew every point
    expect(d.threads.map((t) => t.name).sort()).toEqual(["Red", "Ultramarine"]);
    expect(lastEditor!.state.undoLabel).toBe("Add pixel art");
    act(() => lastEditor!.actions.undo());
    expect(lastEditor!.state.design!.objects).toHaveLength(0);
    // a second send gets fresh ids (no clash with the first)
    fireEvent.click(screen.getByRole("button", { name: "Send to editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Send to editor" }));
    await waitFor(() => expect(new Set(lastEditor!.state.design!.objects.map((o) => o.id)).size).toBe(lastEditor!.state.design!.objects.length), T);
  });

  it("Send and Export are off for an empty grid, and Send explains itself from the palette", async () => {
    mount();
    expect((screen.getByRole("button", { name: "Send to editor" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Export…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Export offers every format and writes a file the engine can read back", async () => {
    mount();
    await paintSome();
    fireEvent.click(screen.getByRole("button", { name: "Export…" }));
    const dlg = await screen.findByRole("dialog", { name: "Export" });
    const group = within(dlg).getByRole("radiogroup", { name: "File format" });
    expect(within(group).getAllByRole("radio").map((r) => r.textContent?.slice(0, 3))).toEqual(["PES", "DST", "JEF", "VP3", "EXP", "XXX", "U01", "PEC", "HUS", "VIP", "TBF", "GCO", "PNG"]);
    fireEvent.click(within(group).getByRole("radio", { name: /JEF/ }));
    await waitFor(() => expect((within(dlg).getByRole("button", { name: "Save JEF" }) as HTMLButtonElement).disabled).toBe(false), T);
    fireEvent.click(within(dlg).getByRole("button", { name: "Save JEF" }));
    await waitFor(() => expect(mock.saved).toHaveLength(1), T);
    expect(mock.saved[0].name).toMatch(/\.jef$/);
    expect(readFile(mock.saved[0].bytes, "jef").plan.stitches.filter((s) => s.type === "stitch").length).toBeGreaterThan(100);
  });

  it("Export as PNG gives a picture", async () => {
    mount();
    await paintSome();
    fireEvent.click(screen.getByRole("button", { name: "Export…" }));
    const dlg = await screen.findByRole("dialog", { name: "Export" });
    fireEvent.click(within(dlg).getByRole("radio", { name: /PNG/ }));
    await waitFor(() => expect((within(dlg).getByRole("button", { name: "Save PNG" }) as HTMLButtonElement).disabled).toBe(false), T);
    fireEvent.click(within(dlg).getByRole("button", { name: "Save PNG" }));
    await waitFor(() => expect(mock.saved).toHaveLength(1), T);
    expect(Array.from(mock.saved[0].bytes.slice(0, 4))).toEqual([137, 80, 78, 71]);
  });
});

describe("Pixel art in the command palette", () => {
  it("every pixel action is a command, enabled when it can run", () => {
    const state = lastEditorState();
    const cmds = pixelCommands(createInlineEngine(), undefined, state, noActions());
    const ids = cmds.map((c) => c.id);
    for (const id of ["pixel.tool.pencil", "pixel.tool.fill", "pixel.tool.erase", "pixel.tool.eyedropper", "pixel.tool.line", "pixel.tool.rect", "pixel.style.tatami", "pixel.style.cross", "pixel.style.satin", "pixel.new", "pixel.undo", "pixel.redo", "pixel.clear", "pixel.send", "pixel.export", "pixel.open"]) expect(ids).toContain(id);
    expect(cmds.find((c) => c.id === "pixel.send")!.enabled).toBe(false); // empty grid
    expect(cmds.find((c) => c.id === "pixel.undo")!.enabled).toBe(false);
    pixel.actions.setThread({ id: "t", brand: "B", code: "1", name: "n", hex: "#ff0000" });
    pixel.actions.beginStroke("x");
    pixel.actions.paintCells([[0, 0]], false);
    pixel.actions.endStroke();
    const after = pixelCommands(createInlineEngine(), undefined, state, noActions());
    expect(after.find((c) => c.id === "pixel.send")!.enabled).toBe(true);
    expect(after.find((c) => c.id === "pixel.undo")!.enabled).toBe(true);
    after.find((c) => c.id === "pixel.tool.rect")!.run();
    expect(pixel.store.getState().tool).toBe("rect");
    after.find((c) => c.id === "pixel.style.satin")!.run();
    expect(art().style).toBe("satin");
    after.find((c) => c.id === "pixel.export")!.run();
    expect(pixel.store.getState().exportOpen).toBe(true);
  });
});

function lastEditorState() {
  return { design: null, options: { useMyThreads: false } } as never;
}
function noActions() {
  return { placeObjects: () => {} } as never;
}
async function ready() {
  await new Promise((r) => setTimeout(r, 300)); // the live plan is debounced; sending waits for the engine itself
}
