import { describe, expect, it } from "vitest";
import { loadBrand, type ThreadEntry } from "../threads";
import { detectBrands, identifySpool, parseSpoolLabel, type OcrLine } from "./label";

/** What Apple Vision actually returned for app/src-tauri/tests/fixtures/spool-label.png. */
const FIXTURE_LINES = ["MADEIRA", "POLYNEON NO. 40", "1747", "5000 M / 5500 YDS"];

const top = (c: { brand: string; code: string; line?: string }[]) => c[0] && `${c[0].brand}|${c[0].line ?? ""}|${c[0].code}`;

describe("spool label parsing", () => {
  it("reads the OCR'd fixture label: Madeira Polyneon 1747", async () => {
    const found = await identifySpool(FIXTURE_LINES);
    expect(top(found)).toBe("Madeira|Polyneon|1747");
    expect(found[0].entry?.name).toBe("Very Red");
    expect(found[0].confidence).toBeGreaterThan(0.8);
    // the length on the label is not a colour code
    expect(found.some((c) => c.code === "5000" || c.code === "5500")).toBe(false);
  });

  it("uses print size and position data when the OCR provides it", async () => {
    const lines: OcrLine[] = [
      { text: "MADEIRA", confidence: 0.99, bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.15 } },
      { text: "POLYNEON NO. 40", confidence: 0.98, bbox: { x: 0.1, y: 0.3, width: 0.5, height: 0.07 } },
      { text: "1747", confidence: 0.97, bbox: { x: 0.1, y: 0.45, width: 0.4, height: 0.22 } },
      { text: "5000 M / 5500 YDS", confidence: 0.95, bbox: { x: 0.1, y: 0.85, width: 0.4, height: 0.05 } },
    ];
    const found = await identifySpool(lines);
    expect(top(found)).toBe("Madeira|Polyneon|1747");
    expect(found[0].reasons).toContain("largest print");
  });

  it("finds a Brother colour by its No. and tolerates leading zeros on Isacord", async () => {
    expect(top(await identifySpool(["BROTHER", "EMBROIDERY THREAD", "COLOR NO. 513", "300m"]))).toBe("Brother|Embroidery|513");
    // label prints "20", the catalogue stores "0020"
    const iso = await identifySpool(["ISACORD", "POLYESTER 40", "0020", "1000M"]);
    expect(top(iso)).toBe("Isacord|Polyester|0020");
    const dropped = await identifySpool(["ISACORD", "Poly 40", "COL 020"]);
    expect(top(dropped)).toBe("Isacord|Polyester|0020");
  });

  it("repairs OCR digit look-alikes", async () => {
    expect(top(await identifySpool(["MADEIRA RAYON", "No. 1l47"]))).toBe("Madeira|Rayon|1147");
    expect(top(await identifySpool(["SULKY", "RAYON 40", "1OO5"]))).toBe("Sulky|Rayon|1005");
  });

  it("finds Robison-Anton and Sulky, with and without the hyphen", async () => {
    expect(top(await identifySpool(["Robison Anton", "Rayon", "2433"]))).toBe("Robison-Anton|Rayon|2433");
    expect(top(await identifySpool(["ROBISON-ANTON", "RAYON", "2433"]))).toBe("Robison-Anton|Rayon|2433");
    expect(top(await identifySpool(["Sulky Rayon 40wt", "1005 Black"]))).toBe("Sulky|Rayon|1005");
  });

  it("detects the brands named on a label", () => {
    expect(detectBrands(["Isacord by Amann", "Mettler"])).toEqual(["Isacord", "Mettler"]);
    expect(detectBrands(["madeira", "gunold"])).toEqual(["Madeira", "Gunold"]);
    expect(detectBrands(["DMC 310"])).toEqual(["DMC"]);
    expect(detectBrands(["ARCHIVE", "STRAL"])).toEqual([]); // short brand names only match whole words
    expect(detectBrands(["Marathon", "Floriani", "Simthread", "Brother"])).toEqual(["Marathon", "Floriani", "Simthread", "Brother"]);
  });

  it("ignores lengths, weights, years, barcodes and copyright lines", () => {
    const cat: ThreadEntry[] = [];
    const found = parseSpoolLabel(["MADEIRA", "5000 m", "40 wt", "(c) 2024 1234", "LOT 99887", "8 909276 543217", "1500 yds"], cat);
    expect(found.filter((c) => c.brand === "Madeira" || c.brand === "").map((c) => c.code)).toEqual([]);
  });

  it("treats years next to Since / Est. / (c) as dates, not colour codes", async () => {
    for (const line of ["Since 1923", "Est. 1898", "© 2024 Madeira", "ESTABLISHED 1875", "Founded 2001", "(c) 1999"]) {
      const found = await identifySpool(["MADEIRA", "POLYNEON", line, "1747"]);
      expect(found[0].code, line).toBe("1747");
      expect(found.some((c) => /^(1923|1898|2024|1875|2001|1999)$/.test(c.code)), line).toBe(false);
    }
    // a bare 4-digit number that happens to look like a year is still a candidate
    expect((await identifySpool(["MADEIRA RAYON", "1900"]))[0].code).toBe("1900");
  });

  it("offers a brand-named guess even when the code is not in the catalogue", () => {
    const found = parseSpoolLabel(["GUNOLD", "Poly 40", "99999"], []);
    expect(found[0]).toMatchObject({ brand: "Gunold", code: "99999" });
    expect(found[0].entry).toBeUndefined();
    expect(found[0].reasons).toContain("not in the catalogue");
  });

  it("with no brand on the label, lists every brand that has the code, best-scored first", async () => {
    const found = await identifySpool(["COLOR 2433"]);
    expect(found.length).toBeGreaterThan(1);
    expect(found.every((c) => c.code === "2433")).toBe(true);
    expect(found.map((c) => c.brand)).toContain("Robison-Anton");
  });

  it("returns an unknown-brand guess when nothing matches at all", () => {
    expect(parseSpoolLabel(["Mystery spool", "COLOR 7777"], [])[0]).toMatchObject({ brand: "", code: "7777" });
    expect(parseSpoolLabel(["no numbers here"], [])).toEqual([]);
    expect(parseSpoolLabel([], [])).toEqual([]);
  });

  it("ranks catalogue-backed, brand-named guesses above the rest and respects the limit", async () => {
    const madeira = await loadBrand("Madeira");
    const found = parseSpoolLabel(["MADEIRA", "1747", "1635", "9999", "0001"], madeira, { limit: 3 });
    expect(found).toHaveLength(3);
    expect(found.every((c) => c.brand === "Madeira")).toBe(true);
    expect(found[0].entry).toBeDefined();
    expect(found.map((c) => c.score)).toEqual([...found.map((c) => c.score)].sort((a, b) => b - a));
  });
});
