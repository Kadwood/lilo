import { describe, expect, it } from "vitest";
import { getCatalogue } from "../threads";
import {
  ShelfError,
  addEntry,
  addFromCatalogue,
  emptyShelf,
  exportShelf,
  findEntry,
  importShelf,
  mergeShelves,
  removeEntry,
  shelfKey,
  shelfPalette,
  snapPalette,
  snapToShelf,
  updateEntry,
} from "./shelf";

const T0 = new Date("2026-01-01T00:00:00Z");
const T1 = new Date("2026-02-01T00:00:00Z");
const red = { brand: "Madeira", line: "Rayon", code: "1037", name: "Red", hex: "#cc0000" };

describe("My Threads shelf", () => {
  it("adds, computes lab and defaults", () => {
    const s = addEntry(emptyShelf(), red, T0);
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({ ...red, source: "manual", addedAt: T0.toISOString() });
    expect(s.entries[0].lab[0]).toBeGreaterThan(30);
  });

  it("is immutable", () => {
    const a = emptyShelf();
    addEntry(a, red);
    expect(a.entries).toHaveLength(0);
  });

  it("merges duplicates by brand/line/code, tolerant of case, spaces and leading zeros", () => {
    let s = addEntry(emptyShelf(), { ...red, code: "0105", qty: 2, notes: "from Dad" }, T1);
    s = addEntry(s, { ...red, brand: "madeira", line: "RAYON", code: " 105 ", qty: 1, notes: "from Dad" }, T0);
    s = addEntry(s, { ...red, code: "105", notes: "half empty" }, T0);
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0].qty).toBe(4);
    expect(s.entries[0].addedAt).toBe(T0.toISOString());
    expect(s.entries[0].notes).toBe("from Dad\nhalf empty");
    // same code, different line = different spool
    s = addEntry(s, { ...red, line: "Polyneon", code: "105" });
    expect(s.entries).toHaveLength(2);
  });

  it("adds a catalogue row with its weight/material and source", () => {
    const t = getCatalogue("brothread-40").threads[0];
    const s = addFromCatalogue(emptyShelf(), t, { qty: 3 }, T0);
    expect(s.entries[0]).toMatchObject({ source: "catalogue", weight: 40, material: "polyester", qty: 3, lab: t.lab });
  });

  it("removes and updates", () => {
    let s = addEntry(emptyShelf(), red, T0);
    s = addEntry(s, { brand: "Isacord", code: "0020", hex: "#ffffff" }, T0);
    const key = shelfKey(red);
    s = updateEntry(s, key, { qty: 5, notes: "new cone", hex: "#ff0000" });
    const e = findEntry(s, key)!;
    expect(e).toMatchObject({ qty: 5, notes: "new cone", hex: "#ff0000", addedAt: T0.toISOString() });
    // colour change recomputes lab
    expect(e.lab[1]).toBeGreaterThan(70);
    expect(s.entries[0].code).toBe("1037"); // position kept
    expect(() => updateEntry(s, "nope", {})).toThrow(ShelfError);
    s = removeEntry(s, key);
    expect(s.entries.map((x) => x.brand)).toEqual(["Isacord"]);
    expect(removeEntry(s, "nope")).toEqual(s);
  });

  it("re-keying an entry onto an existing one merges them", () => {
    let s = addEntry(emptyShelf(), { ...red, code: "1", qty: 1 }, T0);
    s = addEntry(s, { ...red, code: "2", qty: 2 }, T0);
    s = updateEntry(s, shelfKey({ ...red, code: "2" }), { code: "1" });
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0].qty).toBe(3);
  });

  it("rejects bad input with a readable error", () => {
    expect(() => addEntry(emptyShelf(), { ...red, hex: "red" })).toThrow(/Bad colour/);
    expect(() => addEntry(emptyShelf(), { ...red, code: " " })).toThrow(/code/);
    expect(() => addEntry(emptyShelf(), { ...red, brand: "" })).toThrow(/brand/);
    expect(() => addEntry(emptyShelf(), { ...red, qty: -1 })).toThrow(/quantity/);
  });

  it("round-trips through export/import", () => {
    let s = addEntry(emptyShelf(), { ...red, qty: 2, notes: "n" }, T0);
    s = addFromCatalogue(s, getCatalogue().threads[3], {}, T1);
    s = addEntry(s, { brand: "Unknown", code: "x1", hex: "#123456", source: "ocr" }, T1);
    const back = importShelf(exportShelf(s));
    expect(back).toEqual(s);
  });

  it("imports leniently (bare array, missing optional fields) and merges duplicates in the file", () => {
    const s = importShelf([
      { brand: "DMC", code: "310", hex: "#000000" },
      { brand: "DMC", code: "0310", hex: "#000000", qty: 2 },
    ]);
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0].qty).toBe(3);
    expect(s.entries[0].source).toBe("manual");
  });

  it("refuses broken or newer files", () => {
    expect(() => importShelf("{nope")).toThrow(/not valid JSON/);
    expect(() => importShelf({ foo: 1 })).toThrow(/not a Lilo thread shelf/);
    expect(() => importShelf({ version: 99, entries: [] })).toThrow(/newer Lilo/);
    expect(() => importShelf({ entries: [{ brand: "x" }] })).toThrow(/Row 1/);
  });

  it("merges two shelves", () => {
    const a = addEntry(emptyShelf(), red, T0);
    const b = addEntry(addEntry(emptyShelf(), red, T1), { brand: "DMC", code: "1", hex: "#ffffff" }, T1);
    expect(mergeShelves(a, b).entries).toHaveLength(2);
  });
});

describe("snapping", () => {
  const brand = getCatalogue().threads;

  it("uses the fallback brand when the shelf is empty", () => {
    const r = snapToShelf([237, 23, 31], emptyShelf(), brand);
    expect(r.from).toBe("fallback");
    expect(r.thread.name).toBe("Red");
  });

  it("prefers the shelf, even when a brand thread is closer", () => {
    const s = addEntry(emptyShelf(), { brand: "Madeira", code: "1", hex: "#aa2222" }, T0);
    const r = snapToShelf([237, 23, 31], s, brand);
    expect(r.from).toBe("shelf");
    expect(r.thread.code).toBe("1");
    expect(r.deltaE).toBeGreaterThan(5);
  });

  it("falls back when the shelf is too far off and a limit is set", () => {
    const s = addEntry(emptyShelf(), { brand: "Madeira", code: "9", hex: "#0000ff" }, T0);
    expect(snapToShelf([237, 23, 31], s, brand, { maxDeltaE: 15 }).from).toBe("fallback");
    expect(snapToShelf([10, 10, 250], s, brand, { maxDeltaE: 15 }).from).toBe("shelf");
  });

  it("snapPalette picks shelf rows or the brand", () => {
    expect(snapPalette(emptyShelf(), brand)).toEqual(brand);
    const s = addEntry(emptyShelf(), red, T0);
    expect(snapPalette(s, brand)).toEqual(shelfPalette(s));
    expect(shelfPalette(s)[0]).toMatchObject({ code: "1037", licence: "user" });
  });
});
