// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { exportShelf, importShelf } from "@lilo/engine/light";
import { createMockPlatform, type MockState } from "../platform/mock";
import { setPlatform } from "../platform";
import { getShelf, resetShelfStore, shelfStore } from "../state/shelfStore";
import { ShelfPanel } from "./ShelfPanel";

const T = { timeout: 20_000 };
let mock: { state: MockState };

beforeEach(() => {
  resetShelfStore();
  const m = createMockPlatform();
  mock = m;
  setPlatform(m.platform);
});
afterEach(() => {
  cleanup();
  setPlatform(null);
  resetShelfStore();
});

const saved = () => importShelf(mock.state.shelfJson!).entries;
const open = (title: string) => {
  const d = document.querySelector(`details[data-section="${title}"]`) as HTMLDetailsElement;
  d.open = true;
};

describe("My Threads shelf", () => {
  it("adds a spool from the catalogue search, raises the quantity on a second add and saves to the platform", async () => {
    render(<ShelfPanel />);
    fireEvent.change(screen.getByLabelText("Search the catalogue to add a spool"), { target: { value: "madeira polyneon 1747" } });
    const add = await screen.findByRole("button", { name: /Add Madeira Polyneon 1747/ }, T);
    fireEvent.click(add);
    await waitFor(() => expect(getShelf().entries).toHaveLength(1), T);
    expect(getShelf().entries[0]).toMatchObject({ brand: "Madeira", line: "Polyneon", code: "1747", source: "catalogue" });
    await waitFor(() => expect(mock.state.shelfJson).not.toBeNull());
    expect(saved()).toHaveLength(1);
    expect(screen.getByLabelText("Spools on my shelf").textContent).toContain("Madeira Polyneon 1747");
    fireEvent.click(await screen.findByRole("button", { name: /Add Madeira Polyneon 1747/ }));
    await waitFor(() => expect(getShelf().entries[0].qty).toBe(2), T);
    expect(getShelf().entries).toHaveLength(1);
  });

  it("sets quantity and notes, and removes a spool", async () => {
    mock.state.shelfJson = exportShelf(importShelf([{ brand: "Isacord", line: "Polyester", code: "0020", name: "Black", hex: "#000000" }]));
    render(<ShelfPanel />);
    const qty = await screen.findByLabelText("Quantity of Isacord Polyester 0020", undefined, T);
    fireEvent.change(qty, { target: { value: "4" } });
    await waitFor(() => expect(getShelf().entries[0].qty).toBe(4));
    const notes = screen.getByLabelText("Notes for Isacord Polyester 0020");
    fireEvent.change(notes, { target: { value: "half used" } });
    fireEvent.blur(notes);
    await waitFor(() => expect(getShelf().entries[0].notes).toBe("half used"));
    await waitFor(() => expect(saved()[0]).toMatchObject({ qty: 4, notes: "half used" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Isacord Polyester 0020" }));
    await waitFor(() => expect(getShelf().entries).toHaveLength(0));
    await waitFor(() => expect(saved()).toHaveLength(0));
    expect(screen.getByText(/Nothing yet/)).toBeTruthy();
  });

  it("adds a spool by hand with a colour picker", async () => {
    render(<ShelfPanel />);
    open("shelf-manual");
    fireEvent.change(screen.getByLabelText("Brand"), { target: { value: "Local Mill" } });
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "A7" } });
    fireEvent.change(screen.getByLabelText("Colour"), { target: { value: "#aa3366" } });
    fireEvent.change(screen.getByLabelText("How many"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to My Threads" }));
    await waitFor(() => expect(getShelf().entries).toHaveLength(1));
    expect(getShelf().entries[0]).toMatchObject({ brand: "Local Mill", code: "A7", hex: "#aa3366", qty: 3, source: "manual" });
  });

  it("refuses a manual spool with no code", async () => {
    render(<ShelfPanel />);
    open("shelf-manual");
    fireEvent.change(screen.getByLabelText("Brand"), { target: { value: "Local Mill" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to My Threads" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/needs a code/);
    expect(getShelf().entries).toHaveLength(0);
  });

  it("exports the shelf as JSON and imports a file, merging with what is there", async () => {
    mock.state.shelfJson = exportShelf(importShelf([{ brand: "Isacord", line: "Polyester", code: "0020", name: "Black", hex: "#000000", qty: 1 }]));
    render(<ShelfPanel />);
    await screen.findByLabelText("Quantity of Isacord Polyester 0020", undefined, T);
    fireEvent.click(screen.getByRole("button", { name: "Export JSON…" }));
    await waitFor(() => expect(mock.state.saved).toHaveLength(1));
    expect(mock.state.saved[0].name).toBe("my-threads.json");
    expect(importShelf(new TextDecoder().decode(mock.state.saved[0].bytes)).entries[0].code).toBe("0020");

    const incoming = exportShelf(importShelf([{ brand: "Isacord", line: "Polyester", code: "0020", name: "Black", hex: "#000000", qty: 2 }, { brand: "Sulky", line: "Rayon", code: "1005", name: "Black", hex: "#111111" }]));
    mock.state.pickFiles = [{ name: "backup.json", bytes: new TextEncoder().encode(incoming) }];
    fireEvent.click(screen.getByRole("button", { name: "Import JSON…" }));
    await waitFor(() => expect(getShelf().entries).toHaveLength(2));
    expect(getShelf().entries.find((e) => e.code === "0020")!.qty).toBe(3);
    expect(screen.getByText(/Added 2 spools from backup.json/)).toBeTruthy();
  });

  it("says so when an imported file is not a shelf", async () => {
    render(<ShelfPanel />);
    mock.state.pickFiles = [{ name: "nope.json", bytes: new TextEncoder().encode("{\"hello\":1}") }];
    fireEvent.click(screen.getByRole("button", { name: "Import JSON…" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/not a Lilo thread shelf/);
  });

  it("offers Search online when the catalogue has no such code, opening the brand's chart", async () => {
    render(<ShelfPanel />);
    fireEvent.change(screen.getByLabelText("Search the catalogue to add a spool"), { target: { value: "zzqq 99999" } });
    const link = await screen.findByRole("button", { name: "Search online" }, T);
    fireEvent.click(link);
    await waitFor(() => expect(mock.state.openedUrls).toHaveLength(1));
    expect(mock.state.openedUrls[0]).toMatch(/^https:\/\/.*zzqq/);
  });

  it("does not overwrite a shelf file it could not read", async () => {
    mock.state.shelfJson = "{ this is not json";
    render(<ShelfPanel />);
    expect((await screen.findByText(/Could not read My Threads/, undefined, T)).textContent).toMatch(/not valid JSON/);
    expect(shelfStore.getState().status).toBe("error");
    open("shelf-manual");
    fireEvent.change(screen.getByLabelText("Brand"), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to My Threads" }));
    await waitFor(() => expect(getShelf().entries).toHaveLength(1)); // works for this session
    expect(mock.state.shelfJson).toBe("{ this is not json"); // but the unreadable file is left alone
  });
});

describe("Add a spool by photo", () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  const bbox = { x: 0, y: 0, width: 1, height: 0.2 };
  const lines = [
    { text: "MADEIRA", confidence: 0.99, bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.15 } },
    { text: "POLYNEON NO. 40", confidence: 0.98, bbox: { x: 0.1, y: 0.3, width: 0.5, height: 0.07 } },
    { text: "1747", confidence: 0.97, bbox: { x: 0.1, y: 0.45, width: 0.4, height: 0.22 } },
  ];

  beforeEach(() => {
    // jsdom has no object URLs
    URL.createObjectURL = () => "blob:photo";
    URL.revokeObjectURL = () => {};
  });

  it("OCRs the label, ranks candidates with swatches, and adds the one the user confirms", async () => {
    mock.state.ocr = lines;
    mock.state.pickFiles = [{ name: "spool.jpg", bytes: png }];
    render(<ShelfPanel />);
    open("shelf-photo");
    fireEvent.click(screen.getByRole("button", { name: "Choose a photo…" }));
    const group = await screen.findByRole("radiogroup", undefined, T);
    const options = within(group).getAllByRole("radio");
    expect(options.length).toBeGreaterThanOrEqual(1);
    const first = options[0].closest("label")!;
    expect(first.textContent).toContain("Madeira Polyneon 1747");
    expect(first.textContent).toContain("Very Red");
    const swatch = first.querySelector(".swatch") as HTMLElement;
    expect(swatch.style.background).not.toBe("");
    expect(screen.getByAltText("Photo of spool.jpg")).toBeTruthy();
    // nothing is added until the user confirms
    expect(getShelf().entries).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("How many spools"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add this spool" }));
    await waitFor(() => expect(getShelf().entries).toHaveLength(1));
    expect(getShelf().entries[0]).toMatchObject({ brand: "Madeira", code: "1747", qty: 2 });
  });

  it("a candidate that is not in the catalogue asks for its colour instead", async () => {
    mock.state.ocr = [{ text: "ACMEFIL", confidence: 0.9, bbox }, { text: "No. 4821", confidence: 0.9, bbox }];
    mock.state.pickFiles = [{ name: "odd.jpg", bytes: png }];
    render(<ShelfPanel />);
    open("shelf-photo");
    fireEvent.click(screen.getByRole("button", { name: "Choose a photo…" }));
    await screen.findByRole("radiogroup", undefined, T);
    fireEvent.click(screen.getByRole("button", { name: "Pick its colour…" }));
    const form = document.querySelector(".photo-add form") as HTMLElement;
    expect((within(form).getByLabelText("Code") as HTMLInputElement).value).toBe("4821");
  });

  it("explains when this platform cannot read text from a photo", async () => {
    mock.state.ocr = new Error("unsupported: text recognition needs the desktop app");
    mock.state.pickFiles = [{ name: "spool.jpg", bytes: png }];
    render(<ShelfPanel />);
    open("shelf-photo");
    fireEvent.click(screen.getByRole("button", { name: "Choose a photo…" }));
    expect((await screen.findByRole("alert", undefined, T)).textContent).toMatch(/needs the Lilo desktop app on a Mac/);
  });

  it("accepts a dropped photo", async () => {
    mock.state.ocr = lines;
    render(<ShelfPanel />);
    open("shelf-photo");
    const zone = document.querySelector(".photo-add")!;
    const file = new File([png], "drop.png", { type: "image/png" });
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    });
    expect(await screen.findByRole("radiogroup", undefined, T)).toBeTruthy();
  });

  it("says when nothing on the photo looks like a thread code", async () => {
    mock.state.ocr = [{ text: "hello world", confidence: 0.9, bbox }];
    mock.state.pickFiles = [{ name: "blank.jpg", bytes: png }];
    render(<ShelfPanel />);
    open("shelf-photo");
    fireEvent.click(screen.getByRole("button", { name: "Choose a photo…" }));
    expect((await screen.findByText(/Nothing that looks like a thread code/, undefined, T)).textContent).toBeTruthy();
  });
});
