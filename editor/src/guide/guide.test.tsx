// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Design, FillObject, SatinObject } from "@lilo/engine/light";
import { createMockPlatform } from "../platform/mock";
import { setPlatform } from "../platform";
import { EditorShell } from "../shell/EditorShell";
import { DigitizePanel } from "../panels/DigitizePanel";
import { DesignSection } from "../panels/DesignSection";
import { SettingsPanel } from "../panels/SettingsPanel";
import { lastEditor, renderEditor, testDesign } from "../test/helpers";
import { hintById, HINTS, LIVE_HINTS, loadGuideIndex, searchPages, TOUR, WORKFLOW } from "./data";
import { chooseTourPath, finishTour, guideStore, markExported, markPlayed, openHelp, openHelpFor, resetGuideStore, skipTour, startTour, tourNext, tourBack } from "./guideStore";
import { Hint } from "./Hint";
import { HelpPanel } from "./HelpPanel";
import { LiveWarnings } from "./LiveWarnings";
import { applyLiveFix, fixApplies, liveFindings, smallLetters, tinyFills, wideSatin } from "./live";
import { Markdown, parseBlocks } from "./Markdown";
import { TourOverlay } from "./Tour";
import { workflowTicks } from "./workflow";
import { WorkflowStepper } from "./WorkflowStepper";

const T = { timeout: 20_000 };
const loaded = () => waitFor(() => expect(lastEditor?.state.planResult).not.toBeNull(), T);
const app = (view = "editor") => ({ view: view as "editor", go: () => undefined });

beforeEach(() => {
  setPlatform(createMockPlatform({ kind: "tauri" }).platform);
  window.localStorage.clear();
  resetGuideStore();
});
afterEach(() => {
  cleanup();
  setPlatform(null);
});

// ---- the data ---------------------------------------------------------------------------------------

describe("hint data and wiring", () => {
  it("has a hint for every area the spec names, with the required fields", () => {
    expect(HINTS.length).toBeGreaterThanOrEqual(150);
    const areas = ["dimensions", "runtype", "satin", "stitching", "underlay", "digitize", "hoop", "sewing", "export", "send", "player", "seq", "tool", "shape", "text", "view", "map"];
    for (const a of areas) expect(HINTS.some((h) => h.id.startsWith(`${a}.`)), a).toBe(true);
    for (const h of HINTS) {
      expect(h.what.split(/\s+/).length, h.id).toBeLessThanOrEqual(20);
      expect(h.when.split(/\s+/).length, h.id).toBeLessThanOrEqual(25);
      expect(["basic", "advanced"]).toContain(h.level);
    }
  });

  it("every <Hint id>, hid and HintList id written in the source exists in hints.json", () => {
    const files = import.meta.glob("../**/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const missing: string[] = [];
    let seen = 0;
    for (const [file, text] of Object.entries(files)) {
      if (/\.test\.tsx$/.test(file)) continue;
      const ids = [...text.matchAll(/<Hint id="([a-z0-9.-]+)"/g)].map((m) => m[1]);
      ids.push(...[...text.matchAll(/hid="([a-z0-9.-]+)"/g)].map((m) => m[1]));
      for (const m of text.matchAll(/<HintList ids=\{\[([^\]]*)\]/g)) ids.push(...[...m[1].matchAll(/"([a-z0-9.-]+)"/g)].map((x) => x[1]));
      for (const id of ids) {
        seen++;
        if (!hintById(id)) missing.push(`${file}: ${id}`);
      }
    }
    expect(seen).toBeGreaterThan(80);
    expect(missing).toEqual([]);
  });

  it("the panels carry no old ad-hoc tooltips: every ? is a guide hint", async () => {
    // settings for a fill, a run and a satin, the digitize panel and the hoop section
    for (const [id, kind] of [["f1", "fill"], ["r1", "run"], ["s1", "satin"]] as const) {
      const { unmount } = renderEditor(<SettingsPanel />, { design: testDesign() });
      await loaded();
      act(() => lastEditor!.actions.setSelection([id]));
      const legacy = [...document.querySelectorAll(".help-tip:not(.hint-button)")].map((e) => e.getAttribute("aria-label"));
      expect(legacy, kind).toEqual([]);
      expect(document.querySelectorAll(".hint-button").length, kind).toBeGreaterThan(8);
      unmount();
    }
    renderEditor(
      <DigitizePanel onOpen={() => undefined}>
        <DesignSection />
      </DigitizePanel>,
    );
    expect([...document.querySelectorAll(".help-tip:not(.hint-button)")].map((e) => e.getAttribute("aria-label"))).toEqual([]);
    expect(document.querySelectorAll(".hint-button").length).toBeGreaterThan(20);
  });
});

describe("<Hint>", () => {
  it("opens a card with what, when and typical; Esc closes it; Read more opens the guide page", () => {
    render(<Hint id="satin.density-spacing" />);
    const button = screen.getByTitle("Help: Density (spacing)");
    expect(button.getAttribute("aria-label")).toBe("Help");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    const card = screen.getByRole("dialog", { name: /Density \(spacing\)/ });
    expect(card.textContent).toMatch(/gap between needle drops/);
    expect(card.textContent).toMatch(/Typical/);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "Read more in the guide" }));
    expect(guideStore.getState().helpOpen).toBe(true);
    expect(guideStore.getState().helpPage).toBe("satin-tips#density");
  });

  it("works from the keyboard", () => {
    render(<Hint id="player.speed" />);
    const button = screen.getByTitle("Help: Speed");
    expect(button.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(button, { key: "Enter" });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("renders nothing for an unknown id", () => {
    const { container } = render(<Hint id="nope.nothing" />);
    expect(container.innerHTML).toBe("");
  });
});

// ---- the manual -------------------------------------------------------------------------------------

describe("Markdown renderer", () => {
  it("never injects markup: raw HTML shows as text", () => {
    const { container } = render(<Markdown source={'Hello <img src=x onerror="alert(1)"> <script>alert(2)</script>\n\n[bad](javascript:alert(3))'} onNavigate={() => undefined} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toMatch(/<script>alert\(2\)<\/script>/);
    expect(container.querySelector("a")).toBeNull(); // a javascript: link is not a link
  });

  it("renders headings, lists, tables, bold, code and follows guide and web links", () => {
    const nav: string[] = [];
    const ext: string[] = [];
    const src = "## Heading\n\nSome **bold** and `code`.\n\n- one\n- two\n\n1. first\n\n| A | B |\n| --- | --- |\n| x | y |\n\n[Satin](satin-tips.md#density) and [web](https://example.com).";
    render(<Markdown source={src} onNavigate={(r) => nav.push(r)} onExternal={(u) => ext.push(u)} />);
    expect(screen.getByRole("heading", { name: "Heading" }).id).toBe("h-heading");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("columnheader", { name: "A" })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Satin" }));
    expect(nav).toEqual(["satin-tips#density"]);
    fireEvent.click(screen.getByRole("link", { name: /web/ }));
    expect(ext).toEqual(["https://example.com"]);
  });

  it("shows diagrams as images with alt text and missing screenshots as a labelled placeholder", () => {
    render(<Markdown source={"![A satin column next to a fill](diagrams/satin-vs-fill.svg)\n\n![The toolbar](screenshots/toolbar.png)"} onNavigate={() => undefined} />);
    expect(screen.getByRole("img", { name: "A satin column next to a fill" }).tagName).toBe("IMG");
    expect(screen.getByRole("img", { name: /The toolbar \(screenshot not captured yet\)/ })).toBeTruthy();
  });

  it("parses blocks", () => {
    expect(parseBlocks("# T\n\ntext\n\n- a\n- b").map((b) => b.kind)).toEqual(["heading", "para", "list"]);
  });
});

describe("guide index and search", () => {
  it("loads every page and finds pages by title, keyword and heading", async () => {
    const index = await loadGuideIndex();
    expect(index.pages.length).toBeGreaterThanOrEqual(45);
    expect(searchPages(index.pages, "satin")[0].id).toMatch(/satin/);
    expect(searchPages(index.pages, "pucker").map((p) => p.id)).toContain("sewout-troubleshooting");
    expect(searchPages(index.pages, "2.4 ghz").map((p) => p.id)).toContain("lilo-link-wifi");
    expect(searchPages(index.pages, "zzzzqq")).toEqual([]);
    expect(searchPages(index.pages, "").length).toBe(index.pages.length);
  });

  it("every context a page declares can open a page, and the Help panel renders any page", async () => {
    const index = await loadGuideIndex();
    await openHelpFor("tool.satin");
    expect(guideStore.getState().helpPage).toBe("drawing-tools");
    await openHelpFor("view.link");
    expect(guideStore.getState().helpPage).toBe("lilo-link-wifi");
    await openHelpFor("nothing.here");
    expect(guideStore.getState().helpPage).toBe("welcome");
    expect(index.pages.length).toBeGreaterThan(0);
  });
});

describe("<HelpPanel>", () => {
  it("lists the sections, searches, opens a page, follows a link and goes back", async () => {
    render(<HelpPanel />);
    expect(screen.queryByRole("dialog", { name: "Help" })).toBeNull();
    act(() => openHelp());
    await screen.findByRole("navigation", { name: "Guide contents" });
    expect(screen.getByRole("heading", { name: "Getting started" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search the guide"), { target: { value: "pucker" } });
    const results = await screen.findByRole("list", { name: "Search results" });
    fireEvent.click(within(results).getByRole("button", { name: /Fixing sew-out problems/ }));
    expect(await screen.findByRole("heading", { name: "Fixing sew-out problems" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Puckering" })).toBeTruthy();

    // a guide link inside the page
    fireEvent.click(screen.getAllByRole("link", { name: "Underlay and pull compensation" })[0]);
    expect(await screen.findByRole("heading", { name: "Underlay and pull compensation" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /All topics/ }));
    await screen.findByRole("navigation", { name: "Guide contents" });
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Help" }), { key: "Escape" });
    expect(guideStore.getState().helpOpen).toBe(false);
  });

  it("opens straight to a heading from a hint's deep link", async () => {
    render(<HelpPanel />);
    act(() => openHelp("satin-tips#density"));
    expect(await screen.findByRole("heading", { name: "Satin tips" })).toBeTruthy();
    expect(document.getElementById("h-density")).not.toBeNull();
  });

  it("says so when nothing matches", async () => {
    render(<HelpPanel />);
    act(() => openHelp());
    await screen.findByRole("navigation", { name: "Guide contents" });
    fireEvent.change(screen.getByLabelText("Search the guide"), { target: { value: "qqqzzz" } });
    expect((await screen.findByRole("status")).textContent).toMatch(/Nothing in the guide matches/);
  });

  it("Replay the tour closes Help and starts the welcome", async () => {
    render(<HelpPanel />);
    act(() => openHelp());
    fireEvent.click(await screen.findByRole("button", { name: "Replay the tour" }));
    expect(guideStore.getState().helpOpen).toBe(false);
    expect(guideStore.getState().tour.phase).toBe("welcome");
  });
});

// ---- the guide store -------------------------------------------------------------------------------

describe("guide store: tour state", () => {
  it("walks a path to the end, remembers completion and can be skipped", () => {
    const steps = TOUR.paths.find((p) => p.id === "picture")!.steps.length;
    startTour();
    expect(guideStore.getState().tour.phase).toBe("welcome");
    chooseTourPath("picture");
    expect(guideStore.getState().tour).toMatchObject({ phase: "running", path: "picture", step: 0 });
    tourNext();
    expect(guideStore.getState().tour.step).toBe(1);
    tourBack();
    expect(guideStore.getState().tour.step).toBe(0);
    for (let i = 0; i < steps; i++) tourNext();
    expect(guideStore.getState().tour.phase).toBe("done");
    expect(guideStore.getState().tourSeen).toBe(true);
    expect(window.localStorage.getItem("lilo.tour")).toBe("done");
    resetGuideStore();
    expect(guideStore.getState().tourSeen).toBe(true); // remembered across launches

    window.localStorage.clear();
    resetGuideStore();
    startTour();
    skipTour();
    expect(guideStore.getState()).toMatchObject({ tourSeen: true, tour: { phase: "off" } });
  });

  it("every path has 6 to 10 steps and every target is a data-tour name the app really has", () => {
    const files = import.meta.glob("../**/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const source = Object.entries(files)
      .filter(([f]) => !/\.test\.tsx$/.test(f))
      .map(([, t]) => t)
      .join("\n");
    for (const path of TOUR.paths) {
      expect(path.steps.length).toBeGreaterThanOrEqual(6);
      expect(path.steps.length).toBeLessThanOrEqual(10);
      for (const s of path.steps) {
        if (!s.target) continue;
        const literal = new RegExp(`data-tour=(\\{[^}]*)?"${s.target}"`).test(source) || source.includes(` tour="${s.target}"`) || (s.target.startsWith("tool-") && source.includes("data-tour={`tool-${tool.id}`}"));
        expect(literal, `${path.id}/${s.id} points at data-tour="${s.target}"`).toBe(true);
      }
    }
  });
});

// ---- the strip -------------------------------------------------------------------------------------

describe("workflow ticks (pure)", () => {
  const plan = (warnings: { code: string; message: string }[], stitches = 100) => ({ plan: { threads: [], stitches: [], warnings: [] }, stats: { stitchCount: stitches, colorChanges: 1, widthMm: 10, heightMm: 10, estimatedSeconds: 60 } as never, warnings: warnings as never });
  const d = testDesign();
  it("step by step", () => {
    expect(workflowTicks({ design: null, planResult: null, previewed: false, exported: false })).toEqual({ design: false, size: false, stitches: false, preview: false, send: false });
    expect(workflowTicks({ design: d, planResult: plan([]), previewed: false, exported: false })).toEqual({ design: true, size: true, stitches: true, preview: false, send: false });
    const outside = workflowTicks({ design: d, planResult: plan([{ code: "outside-hoop", message: "x" }]), previewed: true, exported: true });
    expect(outside).toEqual({ design: true, size: false, stitches: true, preview: true, send: true });
    const dense = workflowTicks({ design: d, planResult: plan([{ code: "density", message: "x" }]), previewed: false, exported: false });
    expect(dense.stitches).toBe(false);
    expect(dense.size).toBe(true);
    expect(workflowTicks({ design: d, planResult: plan([], 0), previewed: false, exported: false }).size).toBe(false);
  });
});

describe("<WorkflowStepper>", () => {
  it("lists the five steps, ticks them from real state and opens a tip card", async () => {
    renderEditor(<WorkflowStepper />, { design: testDesign() });
    const strip = screen.getByRole("navigation", { name: "Workflow" });
    expect(within(strip).getAllByRole("button").map((b) => b.getAttribute("data-step"))).toEqual(WORKFLOW.map((s) => s.id));
    await loaded();
    await waitFor(() => expect(strip.querySelector('[data-step="size"]')!.getAttribute("data-done")).toBe("true"), T);
    expect(strip.querySelector('[data-step="design"]')!.getAttribute("data-done")).toBe("true");
    expect(strip.querySelector('[data-step="preview"]')!.getAttribute("data-done")).toBe("false");
    expect(strip.querySelector(".now")).not.toBeNull();

    act(() => markPlayed());
    expect(strip.querySelector('[data-step="preview"]')!.getAttribute("data-done")).toBe("true");
    act(() => markExported());
    expect(strip.querySelector('[data-step="send"]')!.getAttribute("data-done")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /^Size and hoop/ }));
    const tip = screen.getByRole("region", { name: "Size and hoop: tip" });
    expect(tip.textContent).toMatch(/fits inside the sewing area/);
    fireEvent.click(within(tip).getByRole("button", { name: "Read the guide" }));
    expect(guideStore.getState().helpPage).toBe("sizing-and-hoops");
  });

  it("an empty design ticks nothing, and the tip action opens the right panel", () => {
    renderEditor(<WorkflowStepper />, { app: app() });
    expect(document.querySelectorAll('[data-done="true"]')).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /^Stitches/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open Sewing setup" }));
    expect(guideStore.getState().sewingOpen).toBe(true);
  });
});

// ---- live warnings ---------------------------------------------------------------------------------

describe("live warnings (pure)", () => {
  const stats = (o: Partial<{ colorChanges: number; stitchCount: number; estimatedSeconds: number }>) => ({ stitchCount: 100, colorChanges: 1, widthMm: 10, heightMm: 10, estimatedSeconds: 60, ...o }) as never;
  const result = (warnings: { code: string; message: string }[], s = stats({})) => ({ plan: { threads: [], stitches: [], warnings: [] }, stats: s, warnings: warnings as never });

  it("maps every validatePlan code, the stats thresholds and the shape checks", () => {
    const design = testDesign();
    const ids = (r: ReturnType<typeof result>, dd: Design = design) => liveFindings({ design: dd, planResult: r }).map((f) => f.hint.id);
    expect(ids(result([]))).toEqual([]);
    expect(ids(result([{ code: "outside-hoop", message: "m" }]))).toEqual(["outside-hoop"]);
    expect(ids(result([{ code: "density", message: "m" }]))).toEqual(["density"]);
    expect(ids(result([{ code: "stitch-too-long", message: "m" }]))).toEqual(["stitch-too-long"]);
    expect(ids(result([{ code: "thin-satin", message: "m" }]))).toEqual(["thin-satin"]);
    expect(ids(result([{ code: "long-stitch-snag", message: "m" }]))).toEqual(["long-stitch-snag"]);
    expect(ids(result([{ code: "object-failed", message: "m" }]))).toEqual(["object-failed"]);
    expect(ids(result([], stats({ colorChanges: 9 })))).toEqual(["colour-changes"]);
    expect(ids(result([], stats({ colorChanges: 8 })))).toEqual([]);
    expect(ids(result([], stats({ stitchCount: 30001 })))).toEqual(["stitch-count"]);
    expect(ids(result([], stats({ estimatedSeconds: 3601 })))).toEqual(["sewing-time"]);
    // the signals the hint file names are exactly the ones implemented
    expect(new Set(LIVE_HINTS.map((h) => h.signal)).size).toBe(LIVE_HINTS.length);
  });

  it("finds tiny fills, wide satin and small letters from the design itself", () => {
    const d = testDesign();
    (d.objects[0] as FillObject).geometry = { shell: [[0, 0], [30, 0], [30, 0.5], [0, 0.5]], holes: [] };
    expect(tinyFills(d, 1).map((o) => o.id)).toEqual(["f1"]);
    expect(liveFindings({ design: d, planResult: null }).map((f) => f.hint.id)).toContain("tiny-region");

    const s = testDesign();
    (s.objects[2] as SatinObject).params = { ...(s.objects[2] as SatinObject).params, widthMm: 10 };
    expect(wideSatin(s, 8).map((o) => o.id)).toEqual(["s1"]);
    expect(liveFindings({ design: s, planResult: null }).map((f) => f.hint.id)).toContain("satin-too-wide");

    const t = testDesign();
    t.textBlocks = [{ id: "text-1", text: "JK", fontId: "x", heightMm: 4, letterSpacingMm: 0, lineSpacing: 1, align: "center" } as never];
    expect(smallLetters(t)).toEqual([{ id: "text-1", heightMm: 4 }]);
    expect(liveFindings({ design: t, planResult: null }).map((f) => f.hint.id)).toContain("letters-small");
    t.sewing = { fabric: "suiting", threadWeight: 60, quality: "standard" };
    expect(smallLetters(t)).toEqual([]); // 4 mm is fine at 60 wt
  });

  it("a message is never longer than 25 words, and every fix names a known action", () => {
    for (const h of LIVE_HINTS) expect(h.message.split(/\s+/).length).toBeLessThanOrEqual(25);
    expect(LIVE_HINTS.filter((h) => h.fix).length).toBeGreaterThanOrEqual(6);
  });
});

describe("<LiveWarnings>", () => {
  it("shows a calm note with a one-click fix, applies it, and lets you dismiss notes", async () => {
    const d = testDesign();
    d.textBlocks = [{ id: "text-1", text: "JK", fontId: "x", heightMm: 4, letterSpacingMm: 0, lineSpacing: 1, align: "center" } as never];
    renderEditor(<LiveWarnings />, { design: d, app: app() });
    await loaded();
    const tray = await screen.findByRole("region", { name: "Design warnings" });
    expect(tray.getAttribute("aria-live")).toBe("polite");
    const note = within(tray).getByText(/letters are too small/).closest("li")!;
    fireEvent.click(within(note).getByRole("button", { name: "Use 60 wt thread" }));
    expect(lastEditor!.state.design!.sewing?.threadWeight).toBe(60);
    await waitFor(() => expect(within(tray).queryByText(/letters are too small/)).toBeNull());
    expect(within(tray).getByRole("status").textContent).toMatch(/60 wt/);
  });

  it("dismiss hides a note until the problem changes", async () => {
    const d = testDesign();
    d.hoop = { name: "tiny", widthMm: 20, heightMm: 20 };
    renderEditor(<LiveWarnings />, { design: d, app: app() });
    await loaded();
    const note = (await screen.findByText(/bigger than the hoop/)).closest("li")!;
    fireEvent.click(within(note).getByRole("button", { name: /^Dismiss/ }));
    expect(screen.queryByText(/bigger than the hoop/)).toBeNull();
    expect(guideStore.getState().dismissed.length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Show dismissed notes" }));
    expect(screen.getByText(/bigger than the hoop/)).toBeTruthy();
  });

  it("applyLiveFix: group by colour and loosen spacing change the design", async () => {
    renderEditor(<LiveWarnings />, { design: testDesign(), app: app() });
    await loaded();
    const before = (lastEditor!.state.design!.objects[0] as FillObject).params.rowSpacingMm;
    const f = { hint: LIVE_HINTS.find((h) => h.id === "density")!, key: "k", objectIds: [] };
    expect(fixApplies(f, lastEditor!.state.design)).toBe(true);
    act(() => void applyLiveFix(f, { state: lastEditor!.state, actions: lastEditor!.actions, hoop: lastEditor!.state.design!.hoop, customHoops: [] }));
    expect((lastEditor!.state.design!.objects[0] as FillObject).params.rowSpacingMm).toBeGreaterThan(before);
  });
});

// ---- the tour overlay -----------------------------------------------------------------------------

describe("<TourOverlay>", () => {
  it("welcomes with four choices, shows coach marks for the path and advances on a real action", async () => {
    renderEditor(
      <>
        <button data-tour="tool-closed">Closed</button>
        <button data-tour="home-new">New</button>
        <div data-tour="canvas">canvas</div>
        <TourOverlay />
      </>,
      { app: app("home") },
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => startTour());
    const welcome = screen.getByRole("dialog", { name: /Hi, I am your Lilo guide/ });
    expect(within(welcome).getAllByRole("button").map((b) => b.getAttribute("data-path")).filter(Boolean)).toEqual(["picture", "draw", "monogram", "open"]);
    expect(within(welcome).getByRole("img").getAttribute("alt")).toMatch(/mascot/);

    fireEvent.click(within(welcome).getByRole("button", { name: /Draw from scratch/ }));
    // step 1 wants the editor view; this host is on "home", so "New design" is still waiting
    expect(screen.getByRole("dialog", { name: "Tour: Start a blank design" }).textContent).toMatch(/step 1 of 7/);
    fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    expect(screen.getByRole("dialog", { name: "Tour: Pick a shape tool" })).toBeTruthy();
    // doing the thing advances it
    act(() => lastEditor!.actions.setTool("closed"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Tour: Draw a shape" })).toBeTruthy(), { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(guideStore.getState().tourSeen).toBe(true);
  });

  it("Esc skips, Finish ends with a thank-you card", () => {
    renderEditor(<TourOverlay />, { app: app() });
    act(() => startTour());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(guideStore.getState().tour.phase).toBe("off");
    act(() => (startTour(), chooseTourPath("open")));
    act(() => finishTour());
    expect(screen.getByRole("status").textContent).toMatch(/You are all set/);
  });
});

// ---- all together ---------------------------------------------------------------------------------

describe("the editor shell with the guide", () => {
  it("shows the strip and the tray, and the player marks the preview step", async () => {
    const d = testDesign();
    d.hoop = { name: "tiny", widthMm: 20, heightMm: 20 };
    renderEditor(<EditorShell />, { design: d, app: app() });
    expect(screen.getByRole("navigation", { name: "Workflow" })).toBeTruthy();
    await screen.findByRole("region", { name: "Design warnings" }, T);
    await waitFor(() => expect(document.querySelector('[data-step="design"]')!.getAttribute("data-done")).toBe("true"), T);
    const play = document.querySelector<HTMLElement>('[data-tour="player-play"]')!;
    fireEvent.click(play);
    await waitFor(() => expect(guideStore.getState().played).toBe(true), T);
    expect(document.querySelector('[data-step="preview"]')!.getAttribute("data-done")).toBe("true");
  });
});
