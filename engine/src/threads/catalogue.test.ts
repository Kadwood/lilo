import { describe, expect, it } from "vitest";
import { rgbToLab } from "../color";
import { findByCode, listBrands, listLines, loadLine, nearestThread, normalizeCode, search } from "../threads";

describe("full catalogue", () => {
  it("indexes every Ink/Stitch palette (75) with lazy per-line loading", async () => {
    expect(listLines()).toHaveLength(75);
    const madeira = listBrands().find((b) => b.brand === "Madeira");
    expect(madeira?.lines.map((l) => l.line).sort()).toEqual(["Burmilana", "Matt", "Polyneon", "Rayon"]);
    const rayon = await loadLine("madeira-rayon");
    expect(rayon.threads.length).toBe(listLines().find((l) => l.id === "madeira-rayon")?.count);
    expect(rayon.threads[0]).toMatchObject({ brand: "Madeira", line: "Rayon", material: "rayon", licence: "GPL-3.0" });
    expect(await loadLine("madeira-rayon")).toBe(rayon);
    await expect(loadLine("nope")).rejects.toThrow("Unknown thread catalogue");
  });

  it("parses weight and material from palette names", () => {
    const l = (id: string) => listLines().find((x) => x.id === id);
    expect(l("brothread-40")).toMatchObject({ weight: 40, material: "polyester", brand: "Brother" });
    expect(l("brother-brothread-80")?.weight).toBe(80);
    expect(l("isacord-polyester")?.material).toBe("polyester");
  });

  it("every line file has the rows the index promises, with valid colours", async () => {
    for (const info of listLines()) {
      const c = await loadLine(info.id);
      expect(c.threads.length, info.id).toBe(info.count);
      expect(new Set(c.threads.map((t) => t.code)).size, info.id).toBe(info.count);
      for (const t of c.threads) {
        expect(t.hex).toMatch(/^#[0-9a-f]{6}$/);
        expect(t.lab).toHaveLength(3);
      }
    }
  });

  it("normalises codes: leading zeros, spaces, case", () => {
    expect(normalizeCode(" 001 ")).toBe("1");
    expect(normalizeCode("001")).toBe(normalizeCode("1"));
    expect(normalizeCode("P 025")).toBe("p25");
    expect(normalizeCode("0000")).toBe("0");
    expect(normalizeCode("ML1338")).toBe("ml1338");
  });

  it("finds a code tolerant of zeros and spaces, in any brand", async () => {
    const hit = await findByCode("brother", " 001", "Embroidery");
    expect(hit).toHaveLength(1);
    expect(hit[0].name).toBe("White");
    expect((await findByCode("Brother", "1", "embroidery"))[0].code).toBe("001");
    expect((await findByCode("robison anton", "5615")).length).toBeGreaterThan(0);
    expect(await findByCode("Madeira", "no-such-code")).toEqual([]);
    expect(await findByCode("Nobrand", "1")).toEqual([]);
  });

  it("searches by code or name across brands", async () => {
    const byCode = await search("isacord 20");
    expect(byCode[0]).toMatchObject({ brand: "Isacord", code: "0020" });
    const navy = await search("navy", { limit: 10 });
    expect(navy).toHaveLength(10);
    expect(navy.every((t) => /navy/i.test(t.name + t.line))).toBe(true);
    expect(await search("")).toEqual([]);
    const onlyDmc = await search("blue", { brands: ["DMC"] });
    expect(onlyDmc.length).toBeGreaterThan(0);
    expect(new Set(onlyDmc.map((t) => t.brand))).toEqual(new Set(["DMC"]));
  });

  it("nearestThread works on any set that has a lab", async () => {
    const dmc = (await loadLine("dmc-standard")).threads;
    const red = nearestThread([200, 20, 30], dmc.slice(0, 40));
    expect(dmc).toContain(red.thread);
    const custom = [
      { lab: rgbToLab(10, 200, 10), tag: "green" },
      { lab: rgbToLab(200, 10, 10), tag: "red" },
    ];
    expect(nearestThread([180, 30, 30], custom).thread.tag).toBe("red");
  });
});
