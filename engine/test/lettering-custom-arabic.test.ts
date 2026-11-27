import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { customTypeface, initLettering, layoutText, loadCustomFont } from "../src/lettering";
import { designToEmbroidery } from "../src/export";
import { readEmbroidery } from "../src/formats";
import { objectPoints, validateDesign } from "../src/model";
import { designOf, ready, savePng, sew, thread } from "./lettering-helpers";

const TEST_FONT = process.env.LILO_ARABIC_TEST_FONT ?? new URL("./fixtures/fonts/NotoSansArabic-Bold.ttf", import.meta.url).pathname;
const t = thread();

const bytes = (): ArrayBuffer => {
  const file = readFileSync(TEST_FONT);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
};

beforeAll(async () => {
  await ready();
  await initLettering();
});

describe("custom OpenType Arabic shaping", () => {
  const samples = [
    "مسلم",
    "مُسْلِم",
    "محمد",
    "السلام عليكم",
    "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
    "لا إله إلا الله",
  ];

  it("applies contextual forms, ligatures and mark positioning to Arabic phrases", () => {
    const face = customTypeface(loadCustomFont(bytes()));
    for (const [sampleIndex, text] of samples.entries()) {
      const shaped = face.shapeLine(text, 0, { heightMm: 20, letterSpacingMm: 0, wordSpacingMm: 0 });
      expect(shaped.missing).toEqual([]);
      expect(shaped.glyphs.length).toBeGreaterThan(0);
      const result = layoutText(text, face, { heightMm: 20, threadId: t.id });
      expect(result.warnings).toEqual([]);
      expect(result.objects.length).toBeGreaterThan(0);
      expect(result.objects.flatMap(objectPoints).every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
      expect(validateDesign(designOf(result.objects, [t]))).toEqual([]);
      const stitched = sew(designOf(result.objects, [t]), "custom-arabic");
      expect(stitched.stats.stitchCount).toBeGreaterThan(0);
      if (process.env.LILO_SHOTS) savePng(process.env.LILO_SHOTS, `custom-arabic-${sampleIndex}`, stitched.plan, 20);
    }
  }, 120_000);

  it("returns visual RTL order with source UTF-16 offsets and a lam-alef cluster", () => {
    const face = customTypeface(loadCustomFont(bytes()));
    const ctx = { heightMm: 20, letterSpacingMm: 0, wordSpacingMm: 0 };
    expect(face.shapeLine("مسلم", 0, ctx).glyphs.map((glyph) => glyph.index)).toEqual([3, 2, 1, 0]);
    expect(face.shapeLine("  مسلم  ", 10, ctx).glyphs.map((glyph) => glyph.index)).toEqual([15, 14, 13, 12]);
    expect(face.shapeLine("لا", 0, ctx).glyphs.map(({ char, index }) => ({ char, index }))).toEqual([{ char: "لا", index: 0 }]);
    const isolatedMeem = face.shapeLine("م", 0, ctx).glyphs[0];
    const initialMeem = face.shapeLine("مس", 0, ctx).glyphs.find((glyph) => glyph.index === 0)!;
    expect(initialMeem.els).not.toEqual(isolatedMeem.els);
    const marked = face.shapeLine("مُسْلِم", 0, ctx);
    expect(marked.glyphs.map((glyph) => glyph.index)).toEqual([6, 5, 4, 3, 2, 1, 0]);
  });

  it("normalizes Arabic presentation forms without changing source offsets", () => {
    const face = customTypeface(loadCustomFont(bytes()));
    const ctx = { heightMm: 20, letterSpacingMm: 0, wordSpacingMm: 0 };
    const logical = face.shapeLine("مسلم", 0, ctx);
    const presentation = face.shapeLine("ﻣﺴﻠﻢ", 0, ctx);
    expect(presentation.missing).toEqual([]);
    expect(presentation.glyphs.map((glyph) => glyph.index)).toEqual([3, 2, 1, 0]);
    expect(presentation.glyphs.map((glyph) => glyph.els)).toEqual(logical.glyphs.map((glyph) => glyph.els));
  });

  it("uses bidi runs for mixed Arabic, English, numbers and punctuation", () => {
    const face = customTypeface(loadCustomFont(bytes()));
    const shaped = face.shapeLine("123 العربية 456", 0, { heightMm: 20, letterSpacingMm: 0, wordSpacingMm: 0 });
    expect(shaped.glyphs.map((glyph) => glyph.index)).toEqual([12, 13, 14, 10, 9, 8, 7, 6, 5, 4, 0, 1, 2]);
    const mixed = face.shapeLine("ABC العربية 123", 0, { heightMm: 20, letterSpacingMm: 0, wordSpacingMm: 0 });
    expect(mixed.glyphs.map((glyph) => glyph.index)).toEqual([0, 1, 2, 12, 13, 14, 10, 9, 8, 7, 6, 5, 4]);
    const punctuated = face.shapeLine("(العربية) ABC-123", 0, { heightMm: 20, letterSpacingMm: 0, wordSpacingMm: 0 });
    expect(punctuated.glyphs.map((glyph) => glyph.index)).toEqual([10, 11, 12, 13, 14, 15, 16, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    const multiline = layoutText("مسلم\n  محمد  ", face, { heightMm: 20, threadId: t.id });
    expect([...new Set(multiline.objects.filter((object) => object.sourceText?.line === 1).map((object) => object.sourceText?.index))]).toEqual([10, 9, 8, 7]);
    if (process.env.LILO_SHOTS) {
      const mixedResult = layoutText("ABC العربية 123", face, { heightMm: 20, threadId: t.id });
      savePng(process.env.LILO_SHOTS, "custom-arabic-mixed", sew(designOf(mixedResult.objects, [t]), "custom-arabic-mixed").plan, 20);
      savePng(process.env.LILO_SHOTS, "custom-arabic-multiline", sew(designOf(multiline.objects, [t]), "custom-arabic-multiline").plan, 20);
    }
  });

  it("keeps stacked-mark offsets distinct and ignores joining controls", () => {
    const face = customTypeface(loadCustomFont(bytes()));
    const ctx = { heightMm: 20, letterSpacingMm: 0, wordSpacingMm: 0 };
    const stacked = face.shapeLine("رَّ", 0, ctx);
    const stackedOffsets = stacked.glyphs.map((glyph) => glyph.index);
    expect(stackedOffsets).toContain(0);
    expect(stackedOffsets.some((index) => index === 1 || index === 2)).toBe(true);
    expect(stackedOffsets.every((index) => index >= 0 && index <= 2)).toBe(true);
    const controlled = face.shapeLine("ب\u200dب ب\u200cب", 0, ctx);
    expect(controlled.missing).toEqual([]);
    expect(controlled.glyphs.every((glyph) => glyph.index !== 1 && glyph.index !== 5)).toBe(true);
    if (process.env.LILO_SHOTS) {
      const result = layoutText("رَّ مُحَمَّد", face, { heightMm: 20, threadId: t.id });
      savePng(process.env.LILO_SHOTS, "custom-arabic-stacked-marks", sew(designOf(result.objects, [t]), "custom-arabic-stacked-marks").plan, 20);
    }
  });

  it("reports unsupported characters without suppressing supported Arabic", () => {
    const face = customTypeface(loadCustomFont(bytes()));
    const result = layoutText("مسلم ☃", face, { heightMm: 20, threadId: t.id });
    expect(result.warnings.map((warning) => warning.code)).toEqual(["missing-glyph"]);
    expect(result.warnings[0].message).toContain("☃");
    expect(result.objects.length).toBeGreaterThan(0);
  });

  it("exports structurally readable JEF stitches", () => {
    const face = customTypeface(loadCustomFont(bytes()));
    const result = layoutText("السَّلَامُ عَلَيْكُمْ", face, { heightMm: 20, threadId: t.id });
    const exported = designToEmbroidery(designOf(result.objects, [t]), "jef", { label: "Arabic" });
    expect(exported.bytes.length).toBeGreaterThan(100);
    const back = readEmbroidery(exported.bytes, "jef");
    expect(back.plan.stitches.filter((stitch) => stitch.type === "stitch").length).toBeGreaterThan(100);
    expect(back.plan.stitches.every((stitch) => Number.isFinite(stitch.x) && Number.isFinite(stitch.y))).toBe(true);
  });
});
