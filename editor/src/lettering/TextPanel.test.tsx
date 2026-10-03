// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { builtinTypeface, initLettering, layoutText, parseFont, type FontIndexEntry } from "@lilo/engine/lettering";
import { objectBox, unionBox, validateDesign } from "@lilo/engine/light";
import { lastEditor, renderEditor, testDesign } from "../test/helpers";
import { placeText, replaceText, textThread } from "./adapter";
import { EditorShell } from "../shell/EditorShell";
import type { LayoutRequest, LayoutResponse, LetteringServices } from "./fonts";
import { heightWarning, TextPanel } from "./TextPanel";

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
  it("a custom font's threshold follows the thread weight: 6 mm at 40 wt, 4 mm at 60 wt", () => {
    expect(heightWarning({ kind: "custom", name: "X" }, 5, 60)).toBeNull();
    expect(heightWarning({ kind: "custom", name: "X" }, 3, 60)).toMatch(/4 mm/);
  });
});

describe("small letters warning (Sewing setup thread weight)", () => {
  const setHeight = (v: string) => fireEvent.change(screen.getByLabelText("Letter height in millimetres"), { target: { value: v } });
  it("shows below 6 mm on 40 wt, and moves to 4 mm when the setup is 60 wt", async () => {
    renderEditor(<TextPanel services={diskServices()} />, { design: { ...testDesign(), sewing: { fabric: "suiting", threadWeight: 40, quality: "standard" } } });
    await waitFor(() => expect(lastEditor?.state.design).not.toBeNull(), T);
    await waitFor(() => expect(screen.getAllByRole("img").length).toBeGreaterThan(50), T);
    expect(screen.queryByTestId("small-letters-warning")).toBeNull();
    setHeight("5");
    expect(screen.getByTestId("small-letters-warning").textContent).toMatch(/under 6 mm/);
    act(() => void lastEditor!.actions.setSewing({ threadWeight: 60 }));
    await waitFor(() => expect(screen.queryByTestId("small-letters-warning")).toBeNull());
    setHeight("3.5");
    expect(screen.getByTestId("small-letters-warning").textContent).toMatch(/under 4 mm/);
  }, 30_000);
});

/** A laid-out word, the way the panel gets it from the services. */
async function laid(text: string, group: string, threadId: string, height = 10): Promise<LayoutResponse> {
  const font = parseFont(JSON.parse(readFileSync(join(FONTS, "geneva_simple", "font.json"), "utf8")));
  const r = layoutText(text, builtinTypeface(font), { heightMm: height, threadId, idPrefix: group });
  const b = r.bounds!;
  return { objects: r.objects, warnings: r.warnings, centre: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] };
}
const blockOf = (id: string, text: string, heightMm = 10) => ({ id, text, fontId: "geneva_simple", heightMm, letterSpacingMm: 0, lineSpacing: 1, align: "center" as const });

describe("placeText / replaceText (inside commit)", () => {
  it("adds a block at the anchor as one undo step, with a valid design and a text block record", async () => {
    renderEditor(<div />, { design: testDesign() });
    await waitFor(() => expect(lastEditor?.state.design).not.toBeNull(), T);
    const d = lastEditor!.state.design!;
    const thread = textThread(d);
    const layout = await laid("Hi", "text-1", thread.id);
    let ids: string[] = [];
    act(() => void lastEditor!.actions.commit("Add text", (draft) => void (ids = placeText(draft, layout, blockOf("text-1", "Hi"), thread, [50, 40])), { select: () => ids }));
    const next = lastEditor!.state.design!;
    expect(next.objects.length).toBe(d.objects.length + layout.objects.length);
    expect(next.textBlocks).toHaveLength(1);
    expect(validateDesign(next)).toEqual([]);
    const box = unionBox(next.objects.filter((o) => o.sourceText).map(objectBox))!;
    expect((box.minX + box.maxX) / 2).toBeCloseTo(50, 0);
    expect((box.minY + box.maxY) / 2).toBeCloseTo(40, 0);
    expect(lastEditor!.state.selectedIds).toEqual(ids);
    act(() => lastEditor!.actions.undo());
    expect(lastEditor!.state.design!.objects).toHaveLength(d.objects.length);
    expect(lastEditor!.state.design!.textBlocks).toBeUndefined();
  });

  it("re-lays a block out in place: same centre, same place in the stack, same colour", async () => {
    renderEditor(<div />, { design: testDesign() });
    await waitFor(() => expect(lastEditor?.state.design).not.toBeNull(), T);
    const thread = textThread(lastEditor!.state.design!);
    const a = await laid("Hi", "text-1", thread.id);
    act(() => void lastEditor!.actions.commit("Add text", (d) => void placeText(d, a, blockOf("text-1", "Hi"), thread, [20, 20])));
    const before = lastEditor!.state.design!;
    const boxBefore = unionBox(before.objects.filter((o) => o.sourceText).map(objectBox))!;
    const b = await laid("Hello", "text-1", thread.id, 12);
    act(() => void lastEditor!.actions.commit("Edit text", (d) => void replaceText(d, "text-1", b, blockOf("text-1", "Hello", 12))));
    const after = lastEditor!.state.design!;
    const boxAfter = unionBox(after.objects.filter((o) => o.sourceText).map(objectBox))!;
    expect((boxAfter.minX + boxAfter.maxX) / 2).toBeCloseTo((boxBefore.minX + boxBefore.maxX) / 2, 0);
    expect(after.textBlocks).toHaveLength(1);
    expect(after.textBlocks![0].text).toBe("Hello");
    expect(after.objects.slice(0, 3).map((o) => o.id)).toEqual(["f1", "r1", "s1"]);
    expect(after.objects.filter((o) => o.sourceText).length).toBe(b.objects.length);
    expect(validateDesign(after)).toEqual([]);
  });

  it("re-layout keeps the rotation, scale and position the user gave the word", async () => {
    renderEditor(<div />, { design: testDesign() });
    await waitFor(() => expect(lastEditor?.state.design).not.toBeNull(), T);
    const thread = textThread(lastEditor!.state.design!);
    const a = await laid("Hi", "text-1", thread.id);
    act(() => void lastEditor!.actions.commit("Add text", (d) => void placeText(d, a, blockOf("text-1", "Hi"), thread, [20, 20])));
    const textIds = () => lastEditor!.state.design!.objects.filter((o) => o.sourceText).map((o) => o.id);
    const boxOf = () => unionBox(lastEditor!.state.design!.objects.filter((o) => o.sourceText).map(objectBox))!;
    const size = (b: ReturnType<typeof boxOf>) => ({ w: b.maxX - b.minX, h: b.maxY - b.minY });

    // the user turns the word a quarter turn, doubles it and moves it
    act(() => lastEditor!.actions.setSelection(textIds()));
    act(() => lastEditor!.actions.rotateSelection(90));
    const turned = size(boxOf());
    expect(turned.h).toBeGreaterThan(turned.w); // "Hi" is wider than tall: now it stands up
    act(() => lastEditor!.actions.resizeSelection(turned.w * 2, turned.h * 2));
    act(() => lastEditor!.actions.nudgeSelection(7, -3));
    const placed = boxOf();
    const block = lastEditor!.state.design!.textBlocks![0];
    expect(block.linear).toBeDefined();
    const [l0, l1, l2, l3] = block.linear!;
    expect(Math.abs(l0 * l3 - l1 * l2)).toBeCloseTo(4, 1); // area scale of a doubling
    expect(Math.abs(l0)).toBeLessThan(0.01); // x no longer maps to x: a quarter turn

    // editing the text lays out new letters with the same turn, size and centre
    const b = await laid("Hello", "text-1", thread.id);
    const undoDepth = lastEditor!.state.undoLabel;
    act(() => void lastEditor!.actions.commit("Edit text", (d) => void replaceText(d, "text-1", b, blockOf("text-1", "Hello"))));
    const after = boxOf();
    expect((after.minX + after.maxX) / 2).toBeCloseTo((placed.minX + placed.maxX) / 2, 0);
    expect((after.minY + after.maxY) / 2).toBeCloseTo((placed.minY + placed.maxY) / 2, 0);
    const s = size(after);
    expect(s.h).toBeGreaterThan(s.w); // still standing up
    // doubled: the word is ~2.5x longer than "Hi" at the same height, so the long side grows with the text
    const flat = await laid("Hello", "text-1", thread.id);
    const fb = unionBox(flat.objects.map(objectBox))!;
    expect(s.h).toBeCloseTo((fb.maxX - fb.minX) * 2, 0);
    expect(s.w).toBeCloseTo((fb.maxY - fb.minY) * 2, 0);
    expect(lastEditor!.state.design!.textBlocks![0].text).toBe("Hello");
    expect(validateDesign(lastEditor!.state.design!)).toEqual([]);

    // one undo step brings the old word back, turned and doubled
    act(() => lastEditor!.actions.undo());
    expect(lastEditor!.state.design!.textBlocks![0].text).toBe("Hi");
    expect(lastEditor!.state.undoLabel).toBe(undoDepth);
    expect(boxOf().maxX - boxOf().minX).toBeCloseTo(placed.maxX - placed.minX, 3);
  });

  it("a word with no record of its transform (an older file) is still centred on its letters", async () => {
    renderEditor(<div />, { design: testDesign() });
    await waitFor(() => expect(lastEditor?.state.design).not.toBeNull(), T);
    const thread = textThread(lastEditor!.state.design!);
    const a = await laid("Hi", "text-1", thread.id);
    act(() => void lastEditor!.actions.commit("Add text", (d) => void placeText(d, a, blockOf("text-1", "Hi"), thread, [20, 20])));
    act(() => void lastEditor!.actions.commit("Forget", (d) => void (d.textBlocks = d.textBlocks!.map(({ centre: _c, linear: _l, ...rest }) => rest))));
    const before = unionBox(lastEditor!.state.design!.objects.filter((o) => o.sourceText).map(objectBox))!;
    const b = await laid("Hello", "text-1", thread.id);
    act(() => void lastEditor!.actions.commit("Edit text", (d) => void replaceText(d, "text-1", b, blockOf("text-1", "Hello"))));
    const after = unionBox(lastEditor!.state.design!.objects.filter((o) => o.sourceText).map(objectBox))!;
    expect((after.minX + after.maxX) / 2).toBeCloseTo((before.minX + before.maxX) / 2, 0);
  });
});

describe("Text tool and panel", () => {
  const press = (k: string) => fireEvent.keyDown(window, { key: k });

  it("T opens the Text panel in the left area and lists fonts", async () => {
    renderEditor(<EditorShell />, { design: testDesign() });
    await waitFor(() => expect(lastEditor?.state.design).not.toBeNull(), T);
    press("t");
    expect(lastEditor!.state.tool).toBe("text");
    expect(screen.getByLabelText("Text", { selector: "aside" })).toBeTruthy();
    expect(screen.getByLabelText("Text to stitch")).toBeTruthy();
    expect(screen.getByText(/Upload font/)).toBeTruthy();
  });

  it("clicking the canvas sets the anchor; Add text puts the word there and selects it; undo removes it", async () => {
    const calls: LayoutRequest[] = [];
    renderEditor(<TextPanel services={diskServices(calls)} />, { design: testDesign() });
    await waitFor(() => expect(lastEditor?.state.design).not.toBeNull(), T);
    await waitFor(() => expect(screen.getAllByRole("img").length).toBeGreaterThan(50), T);
    act(() => lastEditor!.actions.setTool("text"));
    act(() => lastEditor!.actions.setTextAnchor([60, 30]));
    fireEvent.change(screen.getByLabelText("Text to stitch"), { target: { value: "AB" } });
    fireEvent.click(screen.getByRole("button", { name: "15" }));
    const before = lastEditor!.state.design!.objects.length;
    fireEvent.click(screen.getByRole("button", { name: "Add text" }));
    await waitFor(() => expect(lastEditor!.state.design!.objects.length).toBeGreaterThan(before), T);
    expect(calls[0]).toMatchObject({ text: "AB", heightMm: 15, align: "center" });
    const d = lastEditor!.state.design!;
    expect(d.textBlocks?.[0].text).toBe("AB");
    const box = unionBox(d.objects.filter((o) => o.sourceText).map(objectBox))!;
    expect((box.minX + box.maxX) / 2).toBeCloseTo(60, 0);
    expect(lastEditor!.state.selectedIds.length).toBe(d.objects.length - before);
    expect(lastEditor!.state.tool).toBe("select");
    expect(lastEditor!.state.textAnchor).toBeNull();
    act(() => lastEditor!.actions.undo());
    expect(lastEditor!.state.design!.objects).toHaveLength(before);
    act(() => lastEditor!.actions.redo());
    expect(lastEditor!.state.design!.objects.length).toBeGreaterThan(before);
  }, 60_000);

  it("selecting a word reopens the panel in edit mode; Update text re-lays it out in place (one undo step)", async () => {
    const calls: LayoutRequest[] = [];
    renderEditor(<EditorShell />, { design: testDesign() });
    await waitFor(() => expect(lastEditor?.state.design).not.toBeNull(), T);
    const thread = textThread(lastEditor!.state.design!);
    const a = await laid("Hi", "text-1", thread.id);
    act(() => void lastEditor!.actions.commit("Add text", (d) => void placeText(d, a, blockOf("text-1", "Hi"), thread, [0, 0])));
    expect(calls).toHaveLength(0);
    // clicking one letter selects the whole word
    const firstLetter = lastEditor!.state.design!.objects.find((o) => o.sourceText)!;
    act(() => lastEditor!.actions.setSelection([firstLetter.id]));
    const word = lastEditor!.state.design!.objects.filter((o) => o.sourceText).map((o) => o.id);
    expect(lastEditor!.state.selectedIds).toEqual(word);
    expect(screen.getByRole("heading", { name: "Edit text" })).toBeTruthy();
    expect((screen.getByLabelText("Text to stitch") as HTMLTextAreaElement).value).toBe("Hi");
    expect(screen.getByRole("button", { name: "Update text" })).toBeTruthy();
    expect(screen.getByLabelText("Width (mm)")).toBeTruthy(); // dimensions are right there too
  });

  it("text objects move, resize and rotate as one word and duplicate / delete cleanly", async () => {
    renderEditor(<div />, { design: testDesign() });
    await waitFor(() => expect(lastEditor?.state.design).not.toBeNull(), T);
    const thread = textThread(lastEditor!.state.design!);
    const a = await laid("Hi", "text-1", thread.id);
    act(() => void lastEditor!.actions.commit("Add text", (d) => void placeText(d, a, blockOf("text-1", "Hi"), thread, [0, 0])));
    const ids = lastEditor!.state.design!.objects.filter((o) => o.sourceText).map((o) => o.id);
    act(() => lastEditor!.actions.setSelection([ids[0]]));
    const w0 = (() => { const b = unionBox(lastEditor!.state.design!.objects.filter((o) => o.sourceText).map(objectBox))!; return b.maxX - b.minX; })();
    act(() => lastEditor!.actions.resizeSelection(w0 * 2, w0));
    const b1 = unionBox(lastEditor!.state.design!.objects.filter((o) => o.sourceText).map(objectBox))!;
    expect(b1.maxX - b1.minX).toBeCloseTo(w0 * 2, 3);
    act(() => lastEditor!.actions.rotateSelection(90));
    act(() => lastEditor!.actions.duplicateSelection());
    const d = lastEditor!.state.design!;
    expect(d.textBlocks).toHaveLength(2);
    expect(new Set(d.objects.filter((o) => o.sourceText).map((o) => o.sourceText!.group)).size).toBe(2);
    expect(validateDesign(d)).toEqual([]);
    act(() => lastEditor!.actions.deleteSelection());
    expect(lastEditor!.state.design!.textBlocks).toHaveLength(1);
    act(() => lastEditor!.actions.setSelection([ids[1]]));
    act(() => lastEditor!.actions.deleteSelection());
    expect(lastEditor!.state.design!.textBlocks).toBeUndefined();
  });

  it("shows the warning badge when the height is below the font's range", async () => {
    renderEditor(<TextPanel services={diskServices()} />);
    await waitFor(() => expect(screen.getAllByRole("img").length).toBeGreaterThan(10), T);
    fireEvent.click(screen.getByRole("button", { name: "6" }));
    expect(await screen.findByText(/sew poorly/)).toBeTruthy();
  });
});
