import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOOP,
  HOOPS,
  HOOP_BRANDS,
  HOOP_LIBRARY,
  HOOP_SOURCES,
  HoopError,
  PLACEMENT_GUIDES,
  checkPlacement,
  emptyCustomHoops,
  exportCustomHoops,
  findHoopSpec,
  fitsInHoop,
  hoopFromSpec,
  hoopOverflow,
  hoopsForBrand,
  hoopsForMachine,
  importCustomHoops,
  isUsableHoop,
  machinesForBrand,
  makeCustomHoop,
  normalizeHoop,
  outerSize,
  removeCustomHoop,
  rotateHoop,
  searchHoops,
  smallestFittingHoop,
  upsertCustomHoop,
  validateCustomHoop,
} from "../index";
import { migrateProjectDoc } from "../project/migrate";
import { PROJECT_FORMAT, PROJECT_VERSION } from "../project/types";

describe("the hoop library", () => {
  it("has unique ids, sane sizes, known brands and known sources", () => {
    const ids = new Set<string>();
    for (const h of HOOP_LIBRARY) {
      expect(ids.has(h.id), h.id).toBe(false);
      ids.add(h.id);
      expect(HOOP_BRANDS).toContain(h.brand);
      expect(h.widthMm).toBeGreaterThanOrEqual(10);
      expect(h.heightMm).toBeGreaterThanOrEqual(10);
      expect(h.machines.length).toBeGreaterThan(0);
      expect(h.sources.length).toBeGreaterThan(0);
      for (const s of h.sources) expect(HOOP_SOURCES[s], `${h.id} -> ${s}`).toBeDefined();
      if (h.shape === "round") expect(h.widthMm).toBe(h.heightMm);
      // a hoop is verified or it says UNVERIFIED, never silently one or the other
      if (!h.verified) expect(h.sources).toContain("recall");
      if (h.verified) expect(h.sources).not.toContain("recall");
    }
    for (const b of HOOP_BRANDS) expect(HOOP_LIBRARY.some((h) => h.brand === b), b).toBe(true);
  });

  it("covers the brands the picker promises and the NV2700 pair of old files", () => {
    for (const b of ["Brother", "Janome", "Bernina", "Husqvarna Viking / Pfaff", "Baby Lock", "Singer", "Ricoma", "Tajima / commercial"]) expect(HOOP_BRANDS).toContain(b);
    expect(machinesForBrand("Brother")).toEqual(expect.arrayContaining(["PE800", "NQ1700E", "NV2700", "PR670E", "PRS100"]));
    expect(hoopsForMachine("Brother", "NV2700").map((h) => `${h.widthMm}x${h.heightMm}`)).toEqual(["160x260", "130x180"]);
    expect(HOOP_LIBRARY.some((h) => h.shape === "cap")).toBe(true);
    expect(HOOP_LIBRARY.some((h) => h.shape === "round")).toBe(true);
    // the two legacy built-in hoops are in the library under the same names
    for (const legacy of HOOPS) expect(HOOP_LIBRARY.find((h) => h.name === legacy.name && h.widthMm === legacy.widthMm && h.heightMm === legacy.heightMm)).toBeDefined();
  });

  it("holds the sizes read off manufacturer pages", () => {
    const size = (id: string) => {
      const h = findHoopSpec(id);
      return h && `${h.widthMm}x${h.heightMm}`;
    };
    expect(size("brother-130x180")).toBe("130x180"); // PE800 page: 5" x 7"
    expect(size("brother-cap-130x60")).toBe("130x60"); // PRCF3: 130 mm x 60 mm
    expect(size("janome-re28b")).toBe("200x280"); // MC500E: RE28b 200 x 280 mm
    expect(size("janome-re36b")).toBe("200x360"); // MC550E: RE36b 200 x 360 mm
    expect(size("janome-mb7-m1")).toBe("240x200");
  });

  it("searches by brand, machine, name and size", () => {
    expect(searchHoops("pe800").map((h) => h.id)).toContain("brother-130x180");
    expect(searchHoops("janome re28").map((h) => h.id)).toEqual(["janome-re28b"]);
    expect(searchHoops("130x180").length).toBeGreaterThan(2);
    expect(searchHoops("130 x 180").length).toBe(searchHoops("130x180").length);
    expect(searchHoops("180x130").length).toBe(searchHoops("130x180").length);
    expect(searchHoops("zzzz")).toEqual([]);
    expect(searchHoops("").length).toBe(HOOP_LIBRARY.length);
  });
});

describe("normalizeHoop (migration)", () => {
  it("lets an old name-and-size hoop load as a rectangle", () => {
    expect(normalizeHoop({ name: "Custom 100 x 100", widthMm: 100, heightMm: 100 })).toEqual({ name: "Custom 100 x 100", widthMm: 100, heightMm: 100, shape: "rect" });
  });

  it("recognises the two built-in NV2700 hoops by name and size", () => {
    const h = normalizeHoop({ name: "NV2700 160 x 260", widthMm: 160, heightMm: 260 });
    expect(h.id).toBe("brother-nv2700-160x260");
    expect(h.brand).toBe("Brother");
    expect(h.shape).toBe("rect");
    expect(normalizeHoop(DEFAULT_HOOP).id).toBe("brother-nv2700-160x260");
  });

  it("knows a usable hoop from a broken one", () => {
    expect(isUsableHoop({ name: "a", widthMm: 100, heightMm: 100 })).toBe(true);
    expect(isUsableHoop({ name: "a", widthMm: 0, heightMm: 100 })).toBe(false);
    expect(isUsableHoop({ widthMm: 100, heightMm: 100 })).toBe(false);
    expect(isUsableHoop(null)).toBe(false);
  });

  it("is idempotent and keeps a chosen hoop's id and dimensions", () => {
    const chosen = hoopFromSpec(findHoopSpec("janome-re36b")!);
    expect(normalizeHoop(chosen)).toEqual(chosen);
    const once = normalizeHoop({ name: "x", widthMm: 90, heightMm: 120, shape: "oval" });
    expect(normalizeHoop(once)).toEqual(once);
  });

  it("falls back to the default hoop for nonsense instead of failing", () => {
    for (const bad of [null, undefined, 5, {}, { name: "a", widthMm: 0, heightMm: 10 }, { name: "a", widthMm: Infinity, heightMm: 100 }, { name: "a", widthMm: 100, heightMm: 99999 }]) {
      const h = normalizeHoop(bad);
      expect(h.widthMm).toBe(DEFAULT_HOOP.widthMm);
      expect(h.heightMm).toBe(DEFAULT_HOOP.heightMm);
    }
  });

  it("drops bad extras and makes round hoops round", () => {
    const h = normalizeHoop({ name: "r", widthMm: 100, heightMm: 120, shape: "round", clamp: "diagonal", cornerRadiusMm: -3, outerWidthMm: 50, outerHeightMm: 50 });
    expect(h.heightMm).toBe(100);
    expect(h.clamp).toBeUndefined();
    expect(h.cornerRadiusMm).toBeUndefined();
    expect(h.outerWidthMm).toBeUndefined(); // an outer frame smaller than the sewing area is meaningless
  });

  it("leaves a usable old hoop alone when a project opens, and repairs a broken one", () => {
    const base = { format: PROJECT_FORMAT, version: PROJECT_VERSION, title: "t" };
    const design = (hoop: unknown) => ({ version: 1, unitsMm: 1, hoop, threads: [], objects: [] });
    const legacy = { name: "NV2700 130 x 180", widthMm: 130, heightMm: 180 };
    expect(migrateProjectDoc({ ...base, design: design(legacy) }).doc.design.hoop).toEqual(legacy);
    const broken = migrateProjectDoc({ ...base, design: design({ name: "x", widthMm: -4, heightMm: 10 }) }).doc.design.hoop;
    expect(broken.widthMm).toBe(DEFAULT_HOOP.widthMm);
    expect(migrateProjectDoc({ ...base, design: design(undefined) }).doc.design.hoop.widthMm).toBe(DEFAULT_HOOP.widthMm);
  });
});

describe("fitting", () => {
  const nv = (w: number, h: number) => ({ name: "t", widthMm: w, heightMm: h, shape: "rect" as const });

  it("fits a rectangle inside a rectangle, with a margin", () => {
    expect(fitsInHoop({ w: 100, h: 100 }, nv(130, 180))).toBe(true);
    expect(fitsInHoop({ w: 130, h: 100 }, nv(130, 180))).toBe(true);
    expect(fitsInHoop({ w: 131, h: 100 }, nv(130, 180))).toBe(false);
    expect(fitsInHoop({ w: 125, h: 100 }, nv(130, 180), 5)).toBe(false);
    expect(fitsInHoop({ w: 120, h: 100 }, nv(130, 180), 5)).toBe(true);
  });

  it("uses the ellipse equation for round and oval hoops", () => {
    const round = { name: "r", widthMm: 100, heightMm: 100, shape: "round" as const };
    expect(fitsInHoop({ w: 70, h: 70 }, round)).toBe(true); // diagonal 99
    expect(fitsInHoop({ w: 75, h: 75 }, round)).toBe(false); // diagonal 106
    expect(fitsInHoop({ w: 99.9, h: 1 }, round)).toBe(true);
    const oval = { name: "o", widthMm: 200, heightMm: 100, shape: "oval" as const };
    expect(fitsInHoop({ w: 140, h: 70 }, oval)).toBe(true);
    expect(fitsInHoop({ w: 160, h: 80 }, oval)).toBe(false);
  });

  it("checks the corner of a rounded rectangle", () => {
    const sharp = { name: "s", widthMm: 100, heightMm: 100, shape: "rect" as const, cornerRadiusMm: 0 };
    const rounded = { ...sharp, cornerRadiusMm: 40 };
    expect(fitsInHoop({ w: 100, h: 100 }, sharp)).toBe(true);
    expect(fitsInHoop({ w: 100, h: 100 }, rounded)).toBe(false);
    expect(fitsInHoop({ w: 70, h: 70 }, rounded)).toBe(true);
  });

  it("reports the overflow in mm per axis", () => {
    expect(hoopOverflow({ w: 150, h: 100 }, nv(130, 180))).toEqual({ x: 20, y: 0 });
    expect(hoopOverflow({ w: 150, h: 200 }, nv(130, 180), 5)).toEqual({ x: 30, y: 30 });
    const o = hoopOverflow({ w: 140, h: 140 }, { name: "r", widthMm: 100, heightMm: 100, shape: "round" });
    expect(o.x).toBeGreaterThan(0);
    expect(o.x).toBeCloseTo(o.y, 9);
  });

  it("rotates a hoop and its clamp", () => {
    const r = rotateHoop({ name: "a", widthMm: 130, heightMm: 180, clamp: "right", outerWidthMm: 160, outerHeightMm: 210 });
    expect([r.widthMm, r.heightMm, r.outerWidthMm, r.outerHeightMm, r.clamp]).toEqual([180, 130, 210, 160, "bottom"]);
    expect(rotateHoop(r).clamp).toBe("left");
    expect(rotateHoop(rotateHoop(rotateHoop(r))).clamp).toBe("right");
  });

  it("gives an outer frame bigger than the sewing area", () => {
    const o = outerSize(nv(130, 180));
    expect(o.w).toBeGreaterThan(130);
    expect(o.h).toBeGreaterThan(180);
    expect(outerSize({ ...nv(130, 180), outerWidthMm: 160, outerHeightMm: 210 })).toEqual({ w: 160, h: 210 });
  });
});

describe("smallestFittingHoop", () => {
  const brother = hoopsForMachine("Brother", "PE800").map(hoopFromSpec);
  const nq = hoopsForMachine("Brother", "NQ3700D").map(hoopFromSpec);

  it("picks the smallest hoop that holds the design", () => {
    const r = smallestFittingHoop({ w: 90, h: 90 }, hoopsForBrand("Brother").map(hoopFromSpec));
    expect(r.kind === "fit" && r.hoop.name).toBe("4 x 4 in");
  });

  it("picks 5x7 for a 120 x 170 design among a machine's hoops and notes the margin", () => {
    const r = smallestFittingHoop({ w: 120, h: 170 }, brother);
    expect(r.kind).toBe("fit");
    if (r.kind === "fit") expect(r.hoop.id).toBe("brother-130x180");
    const m = smallestFittingHoop({ w: 125, h: 170 }, brother, { marginMm: 5 });
    expect(m.kind).toBe("none");
  });

  it("turns a hoop a quarter when that is the only way it fits", () => {
    const r = smallestFittingHoop({ w: 170, h: 120 }, brother);
    expect(r.kind === "fit" && r.rotated).toBe(true);
    expect(r.kind === "fit" && [r.hoop.widthMm, r.hoop.heightMm]).toEqual([180, 130]);
    const no = smallestFittingHoop({ w: 170, h: 120 }, brother, { allowRotate: false });
    expect(no.kind).toBe("none");
  });

  it("says needs re-hooping, with the overflow, when nothing fits", () => {
    const r = smallestFittingHoop({ w: 200, h: 300 }, nq);
    expect(r.kind).toBe("none");
    if (r.kind === "none") {
      expect(r.closest).not.toBeNull();
      expect(r.overflowMm.x).toBeGreaterThan(0);
      expect(r.overflowMm.y).toBeGreaterThan(0);
      expect(r.overflowMm.x).toBeLessThanOrEqual(200);
    }
    const empty = smallestFittingHoop({ w: 10, h: 10 }, []);
    expect(empty).toEqual({ kind: "none", closest: null, overflowMm: { x: 10, y: 10 } });
  });

  it("never suggests a cap frame", () => {
    const cap = hoopFromSpec(findHoopSpec("brother-cap-130x60")!);
    expect(smallestFittingHoop({ w: 20, h: 20 }, [cap]).kind).toBe("none");
  });

  it("prefers a verified hoop over an unverified one of the same size", () => {
    const bro = hoopFromSpec(findHoopSpec("brother-130x180")!);
    const baby = hoopFromSpec(findHoopSpec("babylock-130x180")!);
    const r = smallestFittingHoop({ w: 100, h: 100 }, [baby, bro]);
    expect(r.kind === "fit" && r.hoop.id).toBe("brother-130x180");
  });
});

describe("custom hoops", () => {
  const input = { name: "My 100 oval", widthMm: 100, heightMm: 70, shape: "oval" as const };

  it("makes a hoop with a fresh id and a brand", () => {
    const a = makeCustomHoop(input, []);
    expect(a).toMatchObject({ id: "custom-my-100-oval", name: "My 100 oval", widthMm: 100, heightMm: 70, shape: "oval", brand: "My custom hoops" });
    const b = makeCustomHoop({ ...input, name: "My 100 oval!" }, [a]);
    expect(b.id).not.toBe(a.id);
    const c = makeCustomHoop({ ...input, name: "My  100 oval" }, [{ ...a, name: "other" }]);
    expect(c.id).toBe("custom-my-100-oval-2"); // the id is taken even though the name is free
  });

  it("validates the form", () => {
    expect(validateCustomHoop(input)).toEqual([]);
    expect(validateCustomHoop({ ...input, name: " " })).toHaveLength(1);
    expect(validateCustomHoop({ ...input, widthMm: 5 })).toHaveLength(1);
    expect(validateCustomHoop({ ...input, heightMm: 5000 })).toHaveLength(1);
    expect(validateCustomHoop({ ...input, shape: "round", widthMm: 100, heightMm: 90 })).toHaveLength(1);
    expect(validateCustomHoop({ ...input, shape: "rect", cornerRadiusMm: 80 })).toHaveLength(1);
    expect(validateCustomHoop({ ...input, shape: "rect", cornerRadiusMm: -1 })).toHaveLength(1);
    const a = makeCustomHoop(input, []);
    expect(validateCustomHoop(input, [a])).toHaveLength(1); // same name
    expect(validateCustomHoop(input, [a], a.id)).toEqual([]); // editing it is fine
    expect(() => makeCustomHoop({ ...input, name: "" }, [])).toThrow(HoopError);
  });

  it("makes a round hoop round and gives rectangles a corner radius", () => {
    expect(makeCustomHoop({ name: "R", widthMm: 100, heightMm: 100, shape: "round" }, []).heightMm).toBe(100);
    expect(makeCustomHoop({ name: "Q", widthMm: 100, heightMm: 120, shape: "rect", cornerRadiusMm: 12 }, []).cornerRadiusMm).toBe(12);
    expect(makeCustomHoop({ name: "O", widthMm: 100, heightMm: 120, shape: "oval" }, []).cornerRadiusMm).toBeUndefined();
  });

  it("adds, edits and deletes", () => {
    const a = makeCustomHoop(input, []);
    const b = makeCustomHoop({ ...input, name: "Second" }, [a]);
    let list = upsertCustomHoop(upsertCustomHoop([], a), b);
    expect(list.map((h) => h.name)).toEqual(["My 100 oval", "Second"]);
    list = upsertCustomHoop(list, makeCustomHoop({ ...input, name: "Renamed", widthMm: 120 }, list, a.id));
    expect(list.map((h) => [h.id, h.name, h.widthMm])).toEqual([
      [a.id, "Renamed", 120],
      [b.id, "Second", 100],
    ]);
    expect(removeCustomHoop(list, a.id!).map((h) => h.id)).toEqual([b.id]);
  });

  it("round-trips through the file text and skips unusable entries", () => {
    const a = makeCustomHoop(input, []);
    const back = importCustomHoops(exportCustomHoops([a]));
    expect(back.hoops).toEqual([a]);
    expect(importCustomHoops(exportCustomHoops([])).hoops).toEqual([]);
    expect(emptyCustomHoops().hoops).toEqual([]);
    const messy = JSON.stringify({
      version: 1,
      hoops: [a, a, { id: "brother-130x180", name: "x", widthMm: 100, heightMm: 100 }, { id: "custom-bad", name: "bad", widthMm: 1, heightMm: 100 }, "nope", { id: "custom-ok", name: "ok", widthMm: 90, heightMm: 90 }],
    });
    expect(importCustomHoops(messy).hoops.map((h) => h.id)).toEqual([a.id, "custom-ok"]);
  });

  it("rejects text that is not a hoops file", () => {
    expect(() => importCustomHoops("{")).toThrow(HoopError);
    expect(() => importCustomHoops("[]")).toThrow(HoopError);
    expect(() => importCustomHoops('{"hoops":[]}')).toThrow(HoopError);
    expect(() => importCustomHoops('{"version":99,"hoops":[]}')).toThrow(/newer/);
  });
});

describe("placement guides", () => {
  it("has the five promised guides, each with a recommended maximum inside its area", () => {
    expect(PLACEMENT_GUIDES.map((g) => g.id)).toEqual(["suit-lining-pocket", "shirt-cuff", "cap-front", "garment-bag-panel", "left-chest"]);
    for (const g of PLACEMENT_GUIDES) {
      expect(g.maxDesignMm.w).toBeLessThanOrEqual(g.widthMm);
      expect(g.maxDesignMm.h).toBeLessThanOrEqual(g.heightMm);
      expect(g.note.length).toBeGreaterThan(10);
    }
    expect(PLACEMENT_GUIDES.find((g) => g.id === "cap-front")!.maxDesignMm).toEqual({ w: 110, h: 50 });
  });

  it("checks a design against the recommended maximum", () => {
    const cap = PLACEMENT_GUIDES.find((g) => g.id === "cap-front")!;
    expect(checkPlacement(cap, { w: 100, h: 40 }).fits).toBe(true);
    expect(checkPlacement(cap, { w: 120, h: 60 })).toEqual({ fits: false, overMm: { w: 10, h: 10 } });
  });
});
