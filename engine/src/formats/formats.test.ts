import { describe, expect, it } from "vitest";
import { validateDesign } from "../model";
import { designToStitchPlan, type StitchPlan } from "../stitch";
import { islandsPlan, samplePlan } from "./test-plans";
import {
  FORMATS,
  FormatError,
  convert,
  formatFromName,
  planToManualDesign,
  readEmbroidery,
  stitchPlanToManualObjects,
  writeEmbroidery,
  type FormatExt,
} from "./index";

const needles = (p: StitchPlan): string[] => p.stitches.filter((s) => s.type === "stitch").map((s) => `${Math.round(s.x * 10)},${Math.round(s.y * 10)}`);
const blockCount = (p: StitchPlan) => p.stitches.filter((s) => s.type === "colorChange").length + 1;

const ALL: FormatExt[] = ["pes", "pec", "dst", "exp", "jef", "vp3", "xxx", "u01", "hus", "vip", "tbf"];

describe("embroidery formats", () => {
  for (const name of ["sample", "islands"] as const) {
    const plan = name === "sample" ? samplePlan() : islandsPlan();
    for (const ext of ALL) {
      it(`${ext}: ${name} plan round-trips (needle positions, colour blocks)`, () => {
        const bytes = writeEmbroidery(plan, ext, { label: "Test", jefDate: "20260101000000" });
        expect(bytes.length).toBeGreaterThan(20);
        const back = readEmbroidery(bytes, ext);
        expect(needles(back.plan)).toEqual(needles(plan));
        expect(blockCount(back.plan)).toBe(blockCount(plan));
        expect(back.warnings.filter((w) => w.code === "empty")).toEqual([]);
      });
    }
  }

  it("keeps exact colours where the format stores them (VP3, XXX), nearest slot otherwise", () => {
    const plan = islandsPlan();
    const want = [...new Set(plan.threads.map((t) => t.hex))];
    for (const ext of ["vp3", "xxx", "vip", "tbf"] as const) {
      const got = readEmbroidery(writeEmbroidery(plan, ext), ext).plan.threads.map((t) => t.hex);
      expect(got).toEqual(plan.threads.map((t) => t.hex));
    }
    for (const ext of ["jef", "pes", "pec", "hus"] as const) {
      const got = readEmbroidery(writeEmbroidery(plan, ext), ext).plan.threads;
      expect(got).toHaveLength(plan.threads.length);
      expect(new Set(got.map((t) => t.hex)).size).toBe(want.length);
    }
  });

  it("VP3 carries thread names, codes and brands", () => {
    const plan = islandsPlan();
    const t = readEmbroidery(writeEmbroidery(plan, "vp3"), "vp3").plan.threads[0];
    expect(t).toMatchObject({ brand: "Brother", name: plan.threads[0].name, code: plan.threads[0].code });
  });

  it("colourless formats get placeholder colours and a warning", () => {
    const r = readEmbroidery(writeEmbroidery(islandsPlan(), "dst"), "dst");
    expect(r.placeholderColors).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain("no-colors-in-source");
    expect(new Set(r.plan.threads.map((t) => t.hex)).size).toBe(3);
  });

  it("long gaps are split to what each format allows and trims survive", () => {
    const plan = islandsPlan();
    for (const ext of ["dst", "exp", "jef", "xxx", "u01", "vp3", "hus", "vip", "tbf"] as const) {
      const back = readEmbroidery(writeEmbroidery(plan, ext), ext).plan;
      expect(back.stitches.some((s) => s.type === "trim"), ext).toBe(true);
    }
    const dst = writeEmbroidery(plan, "dst");
    // every DST record moves at most 12.1 mm per axis
    let last = { x: 0, y: 0 };
    for (const s of readEmbroidery(dst, "dst").plan.stitches) {
      if (s.type === "colorChange") continue;
      expect(Math.abs(s.x - last.x)).toBeLessThanOrEqual(12.1 + 1e-9);
      expect(Math.abs(s.y - last.y)).toBeLessThanOrEqual(12.1 + 1e-9);
      last = s;
    }
  });

  it("convert() goes A to B and says what was lost", () => {
    const plan = samplePlan();
    const pes = writeEmbroidery(plan, "pes");
    const dst = convert(pes, "pes", "dst");
    expect(needles(readEmbroidery(dst.bytes, "dst").plan)).toEqual(needles(readEmbroidery(pes, "pes").plan));
    expect(dst.warnings.map((w) => w.code)).toContain("no-colors-in-target");
    // and back through every other format
    for (const ext of ALL) {
      const r = convert(dst.bytes, "dst", ext);
      expect(needles(readEmbroidery(r.bytes, ext).plan)).toEqual(needles(readEmbroidery(pes, "pes").plan));
    }
    const jef = convert(pes, "PES", ".JEF", { jefDate: "20260101000000" });
    expect(readEmbroidery(jef.bytes, "jef").plan.threads.length).toBe(plan.threads.length);
  });

  it("recognises extensions and rejects unknown ones", () => {
    expect(formatFromName("Design.DST")).toBe("dst");
    expect(formatFromName(".pes")).toBe("pes");
    expect(formatFromName("a.zip")).toBeNull();
    expect(() => convert(new Uint8Array(10), "pes", "svg")).toThrow(/can't read or write/);
    expect(FORMATS.map((f) => f.ext).sort()).toEqual([...ALL, "gcode"].sort());
  });

  it("refuses to write an empty design", () => {
    for (const ext of ALL) expect(() => writeEmbroidery({ threads: [], stitches: [], warnings: [] }, ext)).toThrow(FormatError);
  });

  it("rejects garbage, truncated and wrong-format files with a FormatError (never a crash)", () => {
    const plan = samplePlan();
    for (const ext of ALL) {
      expect(() => readEmbroidery(new Uint8Array(0), ext), `${ext} empty`).toThrow(FormatError);
      // EXP has no header, so any bytes are "valid" stitches
      if (ext !== "exp") expect(() => readEmbroidery(new Uint8Array(40).fill(0x41), ext), `${ext} junk`).toThrow(FormatError);
      const good = writeEmbroidery(plan, ext, { jefDate: "20260101000000" });
      // truncation either throws a FormatError or yields a shorter pattern, but never anything else
      for (const cut of [10, 100, good.length >> 1]) {
        try {
          readEmbroidery(good.subarray(0, cut), ext);
        } catch (e) {
          expect(e, `${ext} cut ${cut}`).toBeInstanceOf(FormatError);
        }
      }
    }
  });

  it("opens an existing file as manual-stitch objects that regenerate the same needle points", () => {
    const plan = islandsPlan();
    const read = readEmbroidery(writeEmbroidery(plan, "pes"), "pes").plan;
    const { objects, threads } = stitchPlanToManualObjects(read);
    expect(objects.length).toBeGreaterThanOrEqual(3);
    expect(objects.every((o) => o.kind === "run" && o.geometry.path.length >= 2)).toBe(true);
    expect(validateDesign(planToManualDesign(read))).toEqual([]);
    expect(threads.length).toBe(3);
    const design = planToManualDesign(read);
    const regenerated = designToStitchPlan(design);
    expect(regenerated.warnings).toEqual([]);
    expect(needles(regenerated)).toEqual(needles(read));
    expect(blockCount(regenerated)).toBe(blockCount(read));
  });
});
