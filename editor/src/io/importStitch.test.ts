import { describe, expect, it } from "vitest";
import { HOOP_LIBRARY, designToEmbroidery, hoopFromSpec, hoopTurned, readEmbroidery, type Hoop } from "@lilo/engine";
import { sampleDesign } from "../../../engine/src/stitch/sample-design";
import { createInlineEngine } from "../engine/client";
import { MAX_STITCH_FILE_BYTES, OPEN_EXTENSIONS, STITCH_EXTENSIONS, StitchImportError, UNREADABLE_MESSAGE, designFromStitches, isProjectFile, isStitchFile, readStitchFile } from "./importStitch";

const engine = createInlineEngine();
const FORMATS = ["pes", "dst", "jef", "vp3", "exp", "xxx", "u01", "pec", "hus", "vip", "tbf"] as const;
const file = (ext: string, name = "rooster") => ({ name: `${name}.${ext}`, bytes: designToEmbroidery(sampleDesign(), ext as never, { label: name }).bytes });
const needles = (bytes: Uint8Array, ext: string) => readEmbroidery(bytes, ext).plan.stitches.filter((s) => s.type === "stitch");
const brother = hoopFromSpec(HOOP_LIBRARY.find((h) => h.brand === "Brother")!);

describe("which files open", () => {
  it("every format the engine reads, and nothing else", () => {
    expect([...STITCH_EXTENSIONS].sort()).toEqual([...FORMATS].sort());
    for (const e of FORMATS) expect(isStitchFile(`a.${e.toUpperCase()}`)).toBe(true);
    for (const n of ["a.lilo", "a.gcode", "a.png", "a.txt", "pes", "a."]) expect(isStitchFile(n)).toBe(false);
    expect(isProjectFile("Crest.LILO")).toBe(true);
    expect(OPEN_EXTENSIONS[0]).toBe("lilo");
    expect(OPEN_EXTENSIONS).toHaveLength(FORMATS.length + 1);
  });
});

describe("reading a stitch file", () => {
  for (const ext of FORMATS) {
    it(`${ext}: objects, threads, a layer and a hoop, named after the file`, async () => {
      const f = file(ext);
      const imp = await readStitchFile(engine, f);
      expect(imp.name).toBe("rooster");
      expect(imp.objects.length).toBeGreaterThan(0);
      expect(imp.objects.every((o) => o.kind === "run" && o.params.exact === true)).toBe(true);
      expect(imp.threads.length).toBeGreaterThan(0);
      for (const o of imp.objects) expect(imp.threads.some((t) => t.id === o.threadId)).toBe(true);
      const { design } = designFromStitches(imp, { reference: brother });
      expect(design.layers).toEqual([{ id: "layer-stitches", name: "rooster", kind: "stitch", visible: true, locked: false }]);
      expect(design.objects.every((o) => o.layerId === "layer-stitches")).toBe(true);
      expect(hoopTurned(design.hoop)).toBe(false);
      // every needle drop of the file is in the objects, where the file had it
      const fromObjects = design.objects.reduce((n, o) => n + (o.kind === "run" ? o.geometry.path.length : 0), 0);
      expect(fromObjects).toBeGreaterThanOrEqual(needles(f.bytes, ext).length);
    });
  }

  it("PES colours become Brother thread names, as in the Converter", async () => {
    const imp = await readStitchFile(engine, file("pes"));
    expect(imp.threads.every((t) => t.brand === "Brother PEC")).toBe(true);
    expect(imp.threads.map((t) => t.name)).toContain("Blue");
  });

  it("a damaged file, an empty one, an unknown kind and a huge one each give a friendly error", async () => {
    const bad = (name: string, bytes: Uint8Array) => readStitchFile(engine, { name, bytes });
    for (const f of [{ name: "bad.pes", bytes: new Uint8Array([1, 2, 3]) }, { name: "empty.dst", bytes: new Uint8Array() }, { name: "notes.txt", bytes: new Uint8Array([1]) }, { name: "random.jef", bytes: new Uint8Array(500).fill(7) }]) {
      const e = await bad(f.name, f.bytes).catch((x) => x);
      expect(e).toBeInstanceOf(StitchImportError);
      expect(e.message).toBe(UNREADABLE_MESSAGE);
    }
    const big = await bad("big.pes", new Uint8Array(MAX_STITCH_FILE_BYTES + 1)).catch((x) => x);
    expect(big).toBeInstanceOf(StitchImportError);
    expect(big.message).toMatch(/too big/);
  });
});

describe("the hoop", () => {
  const imp = (w: number, h: number) =>
    ({
      name: "wide",
      threads: [{ id: "t", brand: "T", code: "1", name: "T", hex: "#000000" }],
      warnings: [],
      objects: [{ id: "o", name: "o", kind: "run" as const, threadId: "t", geometry: { path: [[-w / 2, -h / 2], [w / 2, h / 2]] as [number, number][], closed: false }, params: { stitchLengthMm: 1000, repeats: 1 as const, exact: true } }],
    }) satisfies Parameters<typeof designFromStitches>[0];

  it("is the smallest one of the user's machine that holds it, never a turned one, so the stitches are not rotated on export", () => {
    // wider than tall: a turned portrait hoop would hold it, but export would then rotate every stitch
    for (const [w, h] of [[110, 40], [40, 110], [150, 60], [60, 150]]) {
      const { design, warnings } = designFromStitches(imp(w, h), { reference: brother });
      expect(hoopTurned(design.hoop), `${w}x${h} in ${design.hoop.name}`).toBe(false);
      expect(design.hoop.widthMm).toBeGreaterThanOrEqual(w);
      expect(design.hoop.heightMm).toBeGreaterThanOrEqual(h);
      expect(warnings).toEqual([]);
    }
    const small = designFromStitches(imp(20, 20), { reference: brother }).design.hoop;
    const big = designFromStitches(imp(100, 100), { reference: brother }).design.hoop;
    expect(small.widthMm * small.heightMm).toBeLessThan(big.widthMm * big.heightMm);
  });

  it("a design bigger than any hoop gets the closest one and a plain-words note", () => {
    const { design, warnings } = designFromStitches(imp(900, 900), { reference: brother });
    expect(design.hoop.widthMm).toBeGreaterThan(0);
    expect(warnings.join(" ")).toMatch(/bigger than any hoop/);
  });

  it("the user's own hoop wins when it is the smallest that fits", () => {
    const mine: Hoop = { name: "Tiny", id: "custom:tiny", widthMm: 30, heightMm: 30, shape: "rect" } as Hoop;
    expect(designFromStitches(imp(20, 20), { reference: brother, custom: [mine] }).design.hoop.name).toBe("Tiny");
  });

  it("exports the same needles it read, hoop included", async () => {
    const f = file("pes");
    const { design } = designFromStitches(await readStitchFile(engine, f), { reference: brother });
    const back = needles(designToEmbroidery(design, "pes", { label: "rooster" }).bytes, "pes");
    const was = needles(f.bytes, "pes");
    expect(back).toHaveLength(was.length);
    was.forEach((s, i) => {
      expect(Math.abs(back[i].x - s.x)).toBeLessThanOrEqual(0.1 + 1e-9);
      expect(Math.abs(back[i].y - s.y)).toBeLessThanOrEqual(0.1 + 1e-9);
    });
  });
});
