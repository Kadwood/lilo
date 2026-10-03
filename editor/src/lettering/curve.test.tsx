// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { builtinTypeface, initLettering, layoutText, parseFont, type FontIndexEntry } from "@lilo/engine/lettering";
import { designBounds } from "@lilo/engine/light";
import { lastEditor, renderEditor, testDesign } from "../test/helpers";
import { curveGuide, curveOf } from "./curve";
import type { LayoutRequest, LayoutResponse, LetteringServices } from "./fonts";
import { TextPanel } from "./TextPanel";

afterEach(cleanup);
const T = { timeout: 20_000 };
const FONTS = join(import.meta.dirname, "../../../data/fonts");
const index = (JSON.parse(readFileSync(join(FONTS, "index.json"), "utf8")) as { fonts: FontIndexEntry[] }).fonts;
beforeAll(initLettering);

function services(calls: LayoutRequest[]): LetteringServices {
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
      const r = layoutText(req.text, builtinTypeface(font), { ...req });
      const b = r.bounds!;
      return { objects: r.objects, warnings: r.warnings, centre: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] };
    },
  };
}

describe("curve helpers", () => {
  it("straight text has no guide; arcs run the right way round", () => {
    expect(curveGuide({ mode: "straight", radiusMm: 30 })).toBeUndefined();
    const up = curveGuide({ mode: "up", radiusMm: 30 })!;
    const down = curveGuide({ mode: "down", radiusMm: 30 })!;
    expect(up).toMatchObject({ kind: "arc", radiusMm: 30 });
    if (up.kind === "arc" && down.kind === "arc") {
      expect(up.startDeg).toBeLessThan(up.endDeg); // clockwise over the top
      expect(down.startDeg).toBeGreaterThan(down.endDeg); // along the bottom, still left to right
      expect((up.startDeg + up.endDeg) / 2).toBe(-90);
      expect((down.startDeg + down.endDeg) / 2).toBe(90);
    }
  });
  it("the radius is kept in range, and a stored guide reads back", () => {
    expect((curveGuide({ mode: "up", radiusMm: 2 }) as { radiusMm: number }).radiusMm).toBe(10);
    expect((curveGuide({ mode: "down", radiusMm: 900 }) as { radiusMm: number }).radiusMm).toBe(150);
    for (const mode of ["up", "down"] as const) expect(curveOf(curveGuide({ mode, radiusMm: 42 }))).toEqual({ mode, radiusMm: 42 });
    expect(curveOf(undefined).mode).toBe("straight");
    expect(curveOf({ kind: "polyline", points: [] }).mode).toBe("straight");
  });
});

describe("Curve control in the Text panel", () => {
  it("lays text on an arc, stores it, reloads it on edit, keeps it when re-laid out, and undoes", async () => {
    const calls: LayoutRequest[] = [];
    renderEditor(<TextPanel services={services(calls)} />, { design: testDesign() });
    await waitFor(() => expect(screen.getAllByRole("img").length).toBeGreaterThan(50), T);
    const buttons = screen.getByRole("group", { name: "Curve" });
    expect(Array.from(buttons.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Straight", "Arc up", "Arc down"]);
    expect(screen.queryByLabelText("Curve radius")).toBeNull();

    fireEvent.change(screen.getByLabelText("Text to stitch"), { target: { value: "KADWOOD" } });
    fireEvent.click(screen.getByRole("button", { name: "Arc up" }));
    fireEvent.change(screen.getByLabelText("Curve radius"), { target: { value: "25" } });
    const before = lastEditor!.state.design!.objects.length;
    fireEvent.click(screen.getByRole("button", { name: "Add text" }));
    await waitFor(() => expect(lastEditor!.state.design!.objects.length).toBeGreaterThan(before), T);

    expect(calls.at(-1)!.onPath).toMatchObject({ kind: "arc", radiusMm: 25 });
    const block = lastEditor!.state.design!.textBlocks!.at(-1)!;
    expect(curveOf(block.path)).toEqual({ mode: "up", radiusMm: 25 });
    // the letters really are bent: taller than a straight line of the same word would be
    const letters = lastEditor!.state.design!.objects.filter((o) => o.sourceText?.group === block.id);
    const straight = layoutText("KADWOOD", builtinTypeface(parseFont(JSON.parse(readFileSync(join(FONTS, "geneva_simple/font.json"), "utf8")))), { heightMm: 10, threadId: "t" });
    const box = designBounds({ ...lastEditor!.state.design!, objects: letters });
    expect(box!.heightMm).toBeGreaterThan(straight.bounds!.heightMm * 1.5);

    // select the word: the form loads its curve; switch to arc down and update
    act(() => lastEditor!.actions.setSelection([letters[0].id]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Update text" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Arc up" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("Curve radius") as HTMLInputElement).value).toBe("25");
    const centreBefore = lastEditor!.state.design!.textBlocks!.find((b) => b.id === block.id)!.centre!;
    fireEvent.click(screen.getByRole("button", { name: "Arc down" }));
    fireEvent.click(screen.getByRole("button", { name: "Update text" }));
    await waitFor(() => expect(curveOf(lastEditor!.state.design!.textBlocks!.find((b) => b.id === block.id)!.path).mode).toBe("down"), T);
    const centreAfter = lastEditor!.state.design!.textBlocks!.find((b) => b.id === block.id)!.centre!;
    expect(centreAfter[0]).toBeCloseTo(centreBefore[0], 3); // the word stays where it was
    expect(centreAfter[1]).toBeCloseTo(centreBefore[1], 3);

    // one undo goes back to the arc up
    act(() => lastEditor!.actions.undo());
    expect(curveOf(lastEditor!.state.design!.textBlocks!.find((b) => b.id === block.id)!.path).mode).toBe("up");
  });

  it("straight text stores no path", async () => {
    renderEditor(<TextPanel services={services([])} />, { design: testDesign() });
    await waitFor(() => expect(screen.getAllByRole("img").length).toBeGreaterThan(50), T);
    fireEvent.click(screen.getByRole("button", { name: "Add text" }));
    await waitFor(() => expect(lastEditor!.state.design!.textBlocks?.length).toBe(1), T);
    expect(lastEditor!.state.design!.textBlocks![0].path).toBeUndefined();
  });
});
