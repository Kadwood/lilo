// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { builtinTypeface, initLettering, layoutText, parseFont, type FontIndexEntry } from "@lilo/engine/lettering";
import { validateDesign } from "@lilo/engine/light";
import { lastEditor, renderEditor, testDesign } from "../test/helpers";
import { textThread, withText } from "./adapter";
import type { LayoutRequest, LayoutResponse, LetteringServices } from "./fonts";
import { heightWarning, TextDock } from "./TextPanel";

afterEach(cleanup);
const T = { timeout: 20_000 };
const FONTS = join(import.meta.dirname, "../../../data/fonts");
const index = (JSON.parse(readFileSync(join(FONTS, "index.json"), "utf8")) as { fonts: FontIndexEntry[] }).fonts;

beforeAll(initLettering);

/** Real engine layout, fonts read from disk (the editor's fetch-based loader needs a browser). */
function diskServices(calls: LayoutRequest[] = []): LetteringServices {
  return {
    loadIndex: async () => index,
    previewUrl: (id) => `/preview/${id}.png`,
    listCustom: async () => [],
    addCustom: async () => {
      throw new Error("not in tests");
    },
    removeCustom: async () => {},
    async layout(req): Promise<LayoutResponse> {
      calls.push(req);
      if (req.font.kind !== "builtin") throw new Error("builtin only");
      const font = parseFont(JSON.parse(readFileSync(join(FONTS, req.font.id, "font.json"), "utf8")));
      const r = layoutText(req.text, builtinTypeface(font), { ...req, onPath: req.onPath });
      const b = r.bounds!;
      return { objects: r.objects, warnings: r.warnings, centre: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] };
    },
  };
}

describe("heightWarning", () => {
  const geneva = index.find((f) => f.id === "geneva_simple")!;
  it("warns below a built-in font's designed range and above it", () => {
    expect(heightWarning({ kind: "builtin", entry: geneva }, geneva.minHeightMm - 3)).toMatch(/sew poorly/);
    expect(heightWarning({ kind: "builtin", entry: geneva }, geneva.maxHeightMm + 5)).toMatch(/sparse/);
    expect(heightWarning({ kind: "builtin", entry: geneva }, 12)).toBeNull();
  });
  it("suggests a built-in font for custom fonts under 6 mm", () => {
    expect(heightWarning({ kind: "custom", name: "X" }, 5)).toMatch(/6 mm.*built-in font/);
    expect(heightWarning({ kind: "custom", name: "X" }, 6)).toBeNull();
  });
});

describe("withText", () => {
  it("appends a block centred on the design, with a valid design and a text block record", async () => {
    const d = testDesign();
    const font = parseFont(JSON.parse(readFileSync(join(FONTS, "geneva_simple", "font.json"), "utf8")));
    const thread = textThread(d);
    const r = layoutText("Hi", builtinTypeface(font), { heightMm: 10, threadId: thread.id, idPrefix: "text-1" });
    const b = r.bounds!;
    const next = withText(d, { objects: r.objects, warnings: r.warnings, centre: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] }, { id: "text-1", text: "Hi", fontId: "geneva_simple", heightMm: 10, letterSpacingMm: 0, lineSpacing: 1, align: "center" }, thread);
    expect(next.objects.length).toBe(d.objects.length + r.objects.length);
    expect(next.textBlocks).toHaveLength(1);
    expect(validateDesign(next)).toEqual([]);
    expect(d.objects).toHaveLength(3); // the input is untouched
  });
});

describe("TextDock", () => {
  it("lists built-in fonts first with previews, shows an upload button and adds text to the design", async () => {
    const calls: LayoutRequest[] = [];
    renderEditor(<TextDock defaultOpen services={diskServices(calls)} />, { design: testDesign() });
    await waitFor(() => expect(lastEditor?.state.design).not.toBeNull(), T);
    await waitFor(() => expect(screen.getAllByRole("img").length).toBeGreaterThan(50), T);
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings.indexOf("Fonts")).toBeLessThan(headings.indexOf("Your fonts"));
    expect(screen.getByText(/Upload font/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Text to stitch"), { target: { value: "AB" } });
    fireEvent.click(screen.getByRole("button", { name: "15" }));
    const before = lastEditor!.state.design!.objects.length;
    fireEvent.click(screen.getByRole("button", { name: "Add text" }));
    await waitFor(() => expect(lastEditor!.state.design!.objects.length).toBeGreaterThan(before), T);
    expect(calls[0]).toMatchObject({ text: "AB", heightMm: 15, align: "center" });
    expect(lastEditor!.state.design!.textBlocks?.[0].text).toBe("AB");
  }, 60_000);

  it("shows the warning badge when the height is below the font's range", async () => {
    renderEditor(<TextDock defaultOpen services={diskServices()} />);
    await waitFor(() => expect(screen.getAllByRole("img").length).toBeGreaterThan(10), T);
    fireEvent.click(screen.getByRole("button", { name: "6" }));
    expect(await screen.findByText(/sew poorly/)).toBeTruthy();
  });

  it("starts collapsed in the editor", () => {
    renderEditor(<TextDock services={diskServices()} />);
    expect(screen.queryByLabelText("Text to stitch")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Text/ }));
    expect(screen.getByLabelText("Text to stitch")).toBeTruthy();
  });
});
