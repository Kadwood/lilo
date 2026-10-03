import { describe, expect, it } from "vitest";
import { rgbToLab } from "./color";
import { CATALOGUES, entryRgb, getCatalogue, nearestThread, threadId, toDesignThread } from "./threads";

describe("thread catalogues", () => {
  it("bundles the three Brother palettes with the expected sizes", () => {
    expect(CATALOGUES.map((c) => [c.id, c.threads.length])).toEqual([
      ["brother-embroidery", 61],
      ["brother-country", 61],
      ["brothread-40", 40],
    ]);
  });

  it("has unique codes and licence/source on every row", () => {
    for (const c of CATALOGUES) {
      expect(new Set(c.threads.map((t) => t.code)).size).toBe(c.threads.length);
      for (const t of c.threads) {
        expect(t.licence).toBe("GPL-3.0");
        expect(t.source).toMatch(/^https:\/\/github\.com\/inkstitch\/inkstitch\//);
        expect(t.hex).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("stores Lab values that agree with the engine's own conversion", () => {
    for (const c of CATALOGUES) {
      for (const t of c.threads) {
        const lab = rgbToLab(...entryRgb(t));
        for (let i = 0; i < 3; i++) expect(Math.abs(lab[i] - t.lab[i])).toBeLessThan(0.01);
      }
    }
  });

  it("knows Brother 900 is Black and 001 is White", () => {
    const e = getCatalogue("brother-embroidery").threads;
    expect(e.find((t) => t.code === "900")?.name).toBe("Black");
    expect(e.find((t) => t.code === "001")?.name).toBe("White");
  });

  it("finds the nearest thread by CIEDE2000", () => {
    const palette = getCatalogue().threads;
    const red = nearestThread([236, 24, 30], palette);
    expect(red.thread.name).toBe("Red");
    expect(red.deltaE).toBeLessThan(2);
    expect(nearestThread([3, 3, 3], palette).thread.code).toBe("900");
    expect(nearestThread([250, 250, 250], palette).thread.code).toBe("001");
    expect(() => nearestThread([0, 0, 0], [])).toThrow();
  });

  it("makes stable design threads", () => {
    const t = getCatalogue().threads[0];
    expect(threadId(t)).toBe("brother-embroidery-900");
    expect(toDesignThread(t)).toMatchObject({ id: "brother-embroidery-900", code: "900", brand: "Brother", line: "Embroidery" });
  });
});
