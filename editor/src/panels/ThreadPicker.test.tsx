// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { addEntry, emptyShelf, exportShelf, listBrands, listLines, type Thread } from "@lilo/engine/light";
import { createMockPlatform, type MockState } from "../platform/mock";
import { setPlatform } from "../platform";
import { findThread } from "../state/editorStore";
import { resetShelfStore } from "../state/shelfStore";
import { ThreadPicker } from "./ThreadPicker";

const T = { timeout: 20_000 };
let mock: { state: MockState };
beforeEach(() => {
  resetShelfStore();
  mock = createMockPlatform();
  setPlatform((mock as unknown as ReturnType<typeof createMockPlatform>).platform);
});
afterEach(() => {
  cleanup();
  setPlatform(null);
  resetShelfStore();
});

const swatches = () => document.querySelectorAll(".thread-swatch");

describe("ThreadPicker: all lines", () => {
  it("starts on Brother Embroidery, which is bundled, with no waiting", () => {
    render(<ThreadPicker onPick={() => {}} />);
    expect((screen.getByLabelText("Thread brand") as HTMLSelectElement).value).toBe("Brother");
    expect(swatches().length).toBe(61);
  });

  it("offers every brand and every one of the 75 lines", () => {
    render(<ThreadPicker onPick={() => {}} />);
    const brands = [...(screen.getByLabelText("Thread brand") as HTMLSelectElement).options].map((o) => o.value).filter((v) => !v.startsWith("*"));
    expect(brands).toEqual(listBrands().map((b) => b.brand));
    expect(listLines()).toHaveLength(75);
    // every line is reachable through its brand's line select
    let reached = 0;
    for (const b of listBrands()) {
      fireEvent.change(screen.getByLabelText("Thread brand"), { target: { value: b.brand } });
      const sel = screen.queryByLabelText("Thread line") as HTMLSelectElement | null;
      reached += sel ? sel.options.length - 1 : 1; // minus "All lines"; a one-line brand has no select
    }
    expect(reached).toBe(75);
  });

  it("brand, then line (loaded on demand), then search by code, then pick", async () => {
    const onPick = vi.fn<(t: Thread) => void>();
    render(<ThreadPicker onPick={onPick} />);
    fireEvent.change(screen.getByLabelText("Thread brand"), { target: { value: "Madeira" } });
    fireEvent.change(screen.getByLabelText("Thread line"), { target: { value: "madeira-polyneon" } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/first 300 of 349/), T); // a long line is capped, not dumped on the panel
    expect(swatches().length).toBe(300);
    fireEvent.change(screen.getByLabelText("Search threads"), { target: { value: "1747" } });
    const hit = await screen.findByRole("button", { name: /Madeira 1747 Very Red/ }, T);
    expect(swatches().length).toBe(1);
    fireEvent.click(hit);
    expect(onPick).toHaveBeenCalledTimes(1);
    const t = onPick.mock.calls[0][0];
    expect(t).toMatchObject({ brand: "Madeira", line: "Polyneon", code: "1747", name: "Very Red" });
    // a thread from a lazily loaded line can be found by id afterwards (drawing colour, etc.)
    expect(findThread(t.id)).toMatchObject({ code: "1747" });
  });

  it("searches by name within a line", async () => {
    render(<ThreadPicker onPick={() => {}} />);
    fireEvent.change(screen.getByLabelText("Thread brand"), { target: { value: "Isacord" } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/of 398/), T);
    fireEvent.change(screen.getByLabelText("Search threads"), { target: { value: "black" } });
    expect(swatches().length).toBeGreaterThan(0);
    expect(swatches().length).toBeLessThan(10);
  });

  it("All brands searches every line at once", async () => {
    render(<ThreadPicker onPick={() => {}} />);
    fireEvent.change(screen.getByLabelText("Thread brand"), { target: { value: "*all" } });
    expect(screen.getByText(/Type a code or colour name to search every brand/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search threads"), { target: { value: "navy" } });
    await waitFor(() => expect(swatches().length).toBeGreaterThan(5), T);
    const brands = new Set([...swatches()].map((b) => (b as HTMLElement).title.split(" ")[0]));
    expect(brands.size).toBeGreaterThan(2);
  });

  it("My Threads is a source when the shelf has spools", async () => {
    mock.state.shelfJson = exportShelf(addEntry(emptyShelf(), { brand: "Local Mill", code: "A7", name: "Plum", hex: "#aa3366" }));
    const onPick = vi.fn<(t: Thread) => void>();
    render(<ThreadPicker onPick={onPick} />);
    await waitFor(() => expect([...(screen.getByLabelText("Thread brand") as HTMLSelectElement).options].some((o) => o.value === "*mine")).toBe(true), T);
    fireEvent.change(screen.getByLabelText("Thread brand"), { target: { value: "*mine" } });
    expect(swatches()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Local Mill A7 Plum/ }));
    expect(onPick.mock.calls[0][0]).toMatchObject({ brand: "Local Mill", code: "A7", hex: "#aa3366" });
  });

  it("says so, and offers Search online, when nothing matches", async () => {
    render(<ThreadPicker onPick={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search threads"), { target: { value: "qqqzzz" } });
    fireEvent.click(await screen.findByRole("button", { name: "Search online" }));
    await waitFor(() => expect(mock.state.openedUrls).toHaveLength(1));
    expect(mock.state.openedUrls[0]).toContain("Brother");
  });
});
