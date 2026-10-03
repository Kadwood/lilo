// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_HOOP, exportCustomHoops, makeCustomHoop, type Design } from "@lilo/engine/light";
import { HomeView } from "../app/HomeView";
import type { AppApi } from "../app/AppContext";
import { GuidesLayer, Rulers } from "../canvas/HoopOverlays";
import { createMockPlatform, type MockState } from "../platform/mock";
import { setPlatform } from "../platform";
import { appearanceStore, htmlAttributes, setReduceTransparency, setTheme, surfacesSolid } from "../state/appearanceStore";
import { deleteCustomHoop, hoopStore, loadHoops, rememberHoop, resetHoopStore, restoreHoopsBackup, saveCustomHoop } from "../state/hoopStore";
import { addGuide, hoopViewStore, resetHoopView, setHoopView } from "../state/hoopViewStore";
import { lastEditor, renderEditor, testDesign } from "../test/helpers";
import { AppearanceMenu } from "../shell/AppearanceMenu";
import { applyAppearance, useApplyAppearance } from "../shell/useAppearance";
import { HoopAssist } from "./HoopAssist";
import { HoopDialogs } from "./HoopDialogs";
import { CalibrationDialog, currentScale, resetScreenCache } from "./CalibrationDialog";

const T = { timeout: 20_000 };
let mock: MockState;

beforeEach(() => {
  const m = createMockPlatform({ kind: "tauri" });
  mock = m.state;
  setPlatform(m.platform);
  resetHoopStore();
  resetHoopView();
  resetScreenCache();
  window.localStorage.clear();
  appearanceStore.setState({ theme: "system", reduceTransparency: false, systemReduceTransparency: false, material: "solid" });
});
afterEach(() => {
  cleanup();
  setPlatform(null);
});

const loaded = () => waitFor(() => expect(lastEditor?.state.planResult).not.toBeNull(), T);
const bigDesign = (): Design => {
  const d = testDesign();
  // 150 x 300 mm: bigger than every NV2700 hoop
  d.objects = [{ ...d.objects[0], geometry: { shell: [[-75, -150], [75, -150], [75, 150], [-75, 150]], holes: [] } } as never];
  return d;
};

describe("custom hoops on disk", () => {
  it("adds, edits and deletes, writing hoops.json each time", async () => {
    const a = await saveCustomHoop({ name: "Jacket back", widthMm: 240, heightMm: 150, shape: "oval" });
    expect(a.id).toBe("custom-jacket-back");
    expect(JSON.parse(mock.hoopsJson!).hoops).toHaveLength(1);
    const edited = await saveCustomHoop({ name: "Jacket back 2", widthMm: 250, heightMm: 150, shape: "oval" }, a.id);
    expect(edited.id).toBe(a.id);
    expect(hoopStore.getState().custom.map((h) => [h.name, h.widthMm])).toEqual([["Jacket back 2", 250]]);
    await deleteCustomHoop(a.id!);
    expect(JSON.parse(mock.hoopsJson!).hoops).toEqual([]);
    expect(mock.hoopsBackup).not.toBeNull(); // the previous save is kept
  });

  it("rejects a bad form with a message and writes nothing", async () => {
    await expect(saveCustomHoop({ name: "", widthMm: 5, heightMm: 100, shape: "rect" })).rejects.toThrow(/name/i);
    expect(mock.hoopsJson).toBeNull();
  });

  it("loads what is on disk, and survives a restart", async () => {
    mock.hoopsJson = exportCustomHoops([makeCustomHoop({ name: "Mine", widthMm: 100, heightMm: 100, shape: "round" }, [])]);
    await loadHoops();
    expect(hoopStore.getState().custom.map((h) => h.name)).toEqual(["Mine"]);
    expect(hoopStore.getState().status).toBe("ready");
  });

  it("a damaged file is left alone and the previous save can be restored", async () => {
    mock.hoopsBackup = exportCustomHoops([makeCustomHoop({ name: "Kept", widthMm: 100, heightMm: 80, shape: "rect" }, [])]);
    mock.hoopsJson = "{ half";
    await loadHoops();
    expect(hoopStore.getState().status).toBe("error");
    expect(hoopStore.getState().recovery).not.toBeNull();
    await saveCustomHoop({ name: "New", widthMm: 90, heightMm: 90, shape: "rect" });
    expect(mock.hoopsJson).toBe("{ half"); // never overwritten while unreadable
    await restoreHoopsBackup();
    expect(hoopStore.getState().custom.map((h) => h.name)).toEqual(["Kept"]);
    expect(JSON.parse(mock.hoopsJson!).hoops).toHaveLength(1);
  });

  it("remembers recent hoops, newest first, without duplicates", () => {
    const a = { name: "A", widthMm: 100, heightMm: 100, id: "a" };
    const b = { name: "B", widthMm: 90, heightMm: 90, id: "b" };
    rememberHoop(a);
    rememberHoop(b);
    rememberHoop(a);
    expect(hoopStore.getState().recents.map((h) => h.id)).toEqual(["a", "b"]);
    expect(JSON.parse(window.localStorage.getItem("lilo.hoop-recents")!)).toHaveLength(2);
  });
});

describe("hoop picker", () => {
  it("browses brand, machine, hoop and stores id and sizes in the design", async () => {
    renderEditor(
      <>
        <HoopDialogs />
      </>,
      { design: testDesign() },
    );
    await loaded();
    act(() => setHoopView({ pickerOpen: true }));
    const d = screen.getByRole("dialog", { name: "Choose a hoop" });
    fireEvent.click(within(d).getByRole("button", { name: "Janome" }));
    fireEvent.click(within(d).getByRole("button", { name: "Memory Craft 550E" }));
    expect(within(d).getByRole("button", { name: /RE36b/ })).toBeTruthy();
    fireEvent.click(within(d).getByRole("button", { name: /RE36b/ }));
    expect(lastEditor!.state.design!.hoop).toMatchObject({ id: "janome-re36b", widthMm: 200, heightMm: 360, brand: "Janome", clamp: "none" });
    expect(hoopStore.getState().recents[0].id).toBe("janome-re36b");
  });

  it("marks hoops it cannot confirm as UNVERIFIED and turns a hoop on request", async () => {
    renderEditor(<HoopDialogs />, { design: testDesign() });
    await loaded();
    act(() => setHoopView({ pickerOpen: true }));
    const d = screen.getByRole("dialog", { name: "Choose a hoop" });
    fireEvent.click(within(d).getByRole("button", { name: "Bernina" }));
    expect(within(d).getAllByText("UNVERIFIED").length).toBeGreaterThan(3);
    fireEvent.click(within(d).getByLabelText(/Turn the hoop a quarter/));
    fireEvent.click(within(d).getByRole("button", { name: /Mega \(400 x 150\)/ }));
    expect(lastEditor!.state.design!.hoop).toMatchObject({ widthMm: 150, heightMm: 400 });
  });

  it("lists the user's own hoops and offers edit and delete", async () => {
    await saveCustomHoop({ name: "Mine", widthMm: 120, heightMm: 90, shape: "rect" });
    renderEditor(<HoopDialogs />, { design: testDesign() });
    await loaded();
    act(() => setHoopView({ pickerOpen: true }));
    const d = screen.getByRole("dialog", { name: "Choose a hoop" });
    fireEvent.click(within(d).getByRole("button", { name: /My custom hoops/ }));
    expect(within(d).getByRole("button", { name: /^Mine/ })).toBeTruthy();
    fireEvent.click(within(d).getByRole("button", { name: "Edit Mine" }));
    expect(hoopViewStore.getState().customEditor).toEqual({ id: "custom-mine" });
    fireEvent.click(within(d).getByRole("button", { name: "Delete Mine" }));
    await waitFor(() => expect(hoopStore.getState().custom).toEqual([]));
  });

  it("the smallest-that-fits button picks for the design", async () => {
    renderEditor(<HoopDialogs />, { design: testDesign() }); // 30 x 33 mm: the 130 x 180 NV2700 hoop is the smallest of the pair
    await loaded();
    act(() => setHoopView({ pickerOpen: true }));
    const d = screen.getByRole("dialog", { name: "Choose a hoop" });
    fireEvent.click(within(d).getByRole("button", { name: /Smallest that fits: NV2700 130 x 180/ }));
    expect(lastEditor!.state.design!.hoop.widthMm).toBe(130);
  });
});

describe("hoop assist", () => {
  it("suggests the smallest hoop that fits when the design is bigger than the current one", async () => {
    const d = testDesign();
    d.hoop = { name: "Custom 20 x 20", widthMm: 20, heightMm: 20 };
    renderEditor(<HoopAssist />, { design: d });
    await loaded();
    const note = await screen.findByTestId("hoop-suggestion");
    expect(note.textContent).toMatch(/doesn't fit Custom 20 x 20/);
    fireEvent.click(within(note).getByRole("button", { name: "Use it" }));
    expect(lastEditor!.state.design!.hoop.widthMm).toBeGreaterThanOrEqual(30);
    expect(screen.queryByTestId("hoop-suggestion")).toBeNull();
  });

  it("can be dismissed for this result", async () => {
    const d = testDesign();
    d.hoop = { name: "Custom 20 x 20", widthMm: 20, heightMm: 20 };
    renderEditor(<HoopAssist />, { design: d });
    await loaded();
    fireEvent.click(within(await screen.findByTestId("hoop-suggestion")).getByRole("button", { name: "Not now" }));
    expect(screen.queryByTestId("hoop-suggestion")).toBeNull();
  });

  it("says needs re-hooping, with the overflow in mm, when nothing fits", async () => {
    renderEditor(<HoopAssist />, { design: bigDesign() });
    await loaded();
    const warn = await screen.findByTestId("hoop-rehoop");
    expect(warn.textContent).toMatch(/Needs re-hooping/);
    expect(warn.textContent).toMatch(/\d+ mm too (wide|tall)/);
  });

  it("is silent when the design fits", async () => {
    renderEditor(<HoopAssist />, { design: testDesign() });
    await loaded();
    expect(screen.queryByTestId("hoop-suggestion")).toBeNull();
    expect(screen.queryByTestId("hoop-rehoop")).toBeNull();
    expect(DEFAULT_HOOP.widthMm).toBe(160);
  });
});

describe("rulers and guides", () => {
  const view = { x: 400, y: 300, zoom: 5 };
  const stage = (ui: React.ReactElement) =>
    render(
      <div className="canvas-stage" style={{ width: 800, height: 600 }}>
        {ui}
      </div>,
    );

  it("draws both rulers with a unit corner that switches", () => {
    const onToggle = vi.fn();
    stage(<Rulers view={view} width={800} height={600} units="mm" onToggleUnits={onToggle} />);
    expect(screen.getByLabelText(/Top ruler/)).toBeTruthy();
    expect(screen.getByLabelText(/Left ruler/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Ruler units: mm/ }));
    expect(onToggle).toHaveBeenCalled();
  });

  it("hides when switched off", () => {
    setHoopView({ showRulers: false });
    const { container } = stage(<Rulers view={view} width={800} height={600} units="mm" onToggleUnits={() => {}} />);
    expect(container.querySelector(".rulers")).toBeNull();
  });

  it("shows guides at their position and removes one on double-click", () => {
    act(() => void addGuide("x", 10));
    stage(<GuidesLayer view={view} width={800} height={600} units="mm" />);
    const g = screen.getByRole("separator");
    expect(g.getAttribute("x1")).toBe("450"); // 400 + 10 mm * 5 px
    fireEvent.doubleClick(g);
    expect(hoopViewStore.getState().guides).toEqual([]);
  });

  it("draws the placement template with its recommended maximum, labelled approximate", () => {
    setHoopView({ placementId: "cap-front" });
    const { container } = stage(<GuidesLayer view={view} width={800} height={600} units="mm" />);
    expect(container.querySelector(".placement-max")).not.toBeNull();
    expect(container.textContent).toMatch(/Cap front \(approximate\)/);
    expect(container.textContent).toMatch(/recommended max 110 × 50 mm/);
  });
});

describe("actual size and calibration", () => {
  it("uses what the display reports, and a calibration beats it", async () => {
    mock.screen = { pxPerMm: 5.01, widthMm: 302, heightMm: 196, widthPt: 1512, source: "display" };
    expect(await currentScale()).toEqual({ pxPerMm: 5.01, source: "display" });
    setHoopView({ calibratedPxPerMm: 4.2 });
    expect(await currentScale()).toEqual({ pxPerMm: 4.2, source: "calibrated" });
  });

  it("falls back to 96 dpi when the display is unknown", async () => {
    expect((await currentScale()).source).toBe("assumed");
  });

  it("the dialog saves the matched card size and remembers it was asked", async () => {
    const onClose = vi.fn();
    render(<CalibrationDialog onClose={onClose} />);
    const slider = screen.getByLabelText("Card size");
    fireEvent.change(slider, { target: { value: "4.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(hoopViewStore.getState().calibratedPxPerMm).toBeCloseTo(4.5, 6);
    expect(hoopViewStore.getState().calibrationAsked).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it("cancel still counts as asked, so the prompt does not nag", () => {
    render(<CalibrationDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(hoopViewStore.getState().calibrationAsked).toBe(true);
    expect(hoopViewStore.getState().calibratedPxPerMm).toBeNull();
  });
});

describe("appearance", () => {
  it("is solid when asked, when the OS asks, or when there is no glass", () => {
    const base = { theme: "system" as const, reduceTransparency: false, systemReduceTransparency: false, material: "liquid-glass" as const };
    expect(surfacesSolid(base)).toBe(false);
    expect(surfacesSolid({ ...base, reduceTransparency: true })).toBe(true);
    expect(surfacesSolid({ ...base, systemReduceTransparency: true })).toBe(true);
    expect(surfacesSolid({ ...base, material: "solid" })).toBe(true);
    expect(htmlAttributes({ ...base, theme: "dark" })).toEqual({ theme: "dark", material: "liquid-glass", solid: "false", reduce: "false" });
  });

  it("writes the attributes glass.css keys on, and removes data-theme for System", () => {
    const root = document.createElement("html");
    applyAppearance(root, { theme: "dark", reduceTransparency: false, systemReduceTransparency: false, material: "vibrancy" });
    expect(root.dataset).toMatchObject({ theme: "dark", material: "vibrancy", solid: "false", reduceTransparency: "false" });
    applyAppearance(root, { theme: "system", reduceTransparency: true, systemReduceTransparency: false, material: "vibrancy" });
    expect(root.dataset.theme).toBeUndefined();
    expect(root.dataset).toMatchObject({ solid: "true", reduceTransparency: "true" });
  });

  it("the Reduce transparency toggle persists and the OS setting forces it on", () => {
    render(<AppearanceMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    const box = screen.getByRole("checkbox", { name: /Reduce transparency/ }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(appearanceStore.getState().reduceTransparency).toBe(true);
    expect(JSON.parse(window.localStorage.getItem("lilo.appearance")!).reduceTransparency).toBe(true);
    setReduceTransparency(false);
    act(() => appearanceStore.setState({ systemReduceTransparency: true }));
    const forced = screen.getByRole("checkbox", { name: /Reduce transparency/ }) as HTMLInputElement;
    expect(forced.checked).toBe(true);
    expect(forced.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(appearanceStore.getState().theme).toBe("dark");
    setTheme("system");
  });

  function Host() {
    useApplyAppearance();
    return null;
  }

  it("follows the window material and the macOS accessibility setting, and tells the window the theme", async () => {
    mock.material = "liquid-glass";
    mock.systemReduceTransparency = true;
    render(<Host />);
    await waitFor(() => expect(document.documentElement.dataset.material).toBe("liquid-glass"));
    await waitFor(() => expect(document.documentElement.dataset.solid).toBe("true"));
    act(() => setTheme("dark"));
    await waitFor(() => expect(mock.themeCalls.at(-1)).toBe("dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.titlebar).toBe(/Mac/.test(navigator.userAgent) ? "overlay" : "none");
    act(() => setTheme("system"));
    await waitFor(() => expect(mock.themeCalls.at(-1)).toBeNull());
  });
});

describe("Home", () => {
  function app(): AppApi {
    return { view: "home", go: vi.fn() as unknown as AppApi["go"] };
  }

  it("offers the six ways to start as cards, and the Kadwood lockup opens kadwood.com", async () => {
    renderEditor(<HomeView />, { app: app() });
    const grid = screen.getByRole("list", { name: "Ways to start" });
    for (const name of ["New design", "Digitize a picture…", "Type a monogram", "Pixel art", "Open…", "Converter"]) expect(within(grid).getByRole("button", { name })).toBeTruthy();
    expect(screen.getByText("Welcome to Lilo")).toBeTruthy();
    fireEvent.click(screen.getByTitle("kadwood.com"));
    await waitFor(() => expect(mock.openedUrls).toEqual(["https://kadwood.com"]));
    expect(screen.getByRole("img", { name: "Kadwood" })).toBeTruthy();
  });

  it("Pixel art and Converter go to their screens; Type a monogram starts a design with the Text tool", async () => {
    const a = app();
    renderEditor(<HomeView />, { app: a });
    fireEvent.click(screen.getByRole("button", { name: "Pixel art" }));
    expect(a.go).toHaveBeenCalledWith("pixel");
    fireEvent.click(screen.getByRole("button", { name: "Converter" }));
    expect(a.go).toHaveBeenCalledWith("converter");
    fireEvent.click(screen.getByRole("button", { name: "Type a monogram" }));
    await waitFor(() => expect(lastEditor!.state.tool).toBe("text"), T);
    expect(a.go).toHaveBeenCalledWith("editor");
  });
});
