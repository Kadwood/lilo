import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { arabicCanonical, positionArabic } from "../src/lettering/arabic";
import { joiningType } from "../src/lettering/joining-types";
import { builtinTypeface, layoutText } from "../src/lettering/layout";
import type { LiloFont } from "../src/lettering/types";
import { objectPoints, validateDesign } from "../src/model";
import { readPes } from "../src/pes";
import { designOf, loadBuiltin, ready, savePng, sew, thread } from "./lettering-helpers";

const ids = ["malika", "computer", "computer_small"];
const t = thread();
const samples: Record<string, string[][]> = {
  "مسلم": [["م.init", "س.medi", "ل.medi", "م.fina"]],
  "ملكة": [["م.init", "ل.medi", "ك.medi", "ة.fina"]],
  "سلام": [["س.init", "لا.fina", "م.isol"]],
  "السلام عليكم": [["ا.isol", "ل.init", "س.medi", "لا.fina", "م.isol"], ["ع.init", "ل.medi", "ي.medi", "ك.medi", "م.fina"]],
  "بسم الله الرحمن الرحيم": [["ب.init", "س.medi", "م.fina"], ["ا.isol", "ل.init", "ل.medi", "ه.fina"], ["ا.isol", "ل.init", "ر.fina", "ح.init", "م.medi", "ن.fina"], ["ا.isol", "ل.init", "ر.fina", "ح.init", "ي.medi", "م.fina"]],
  "محمد": [["م.init", "ح.medi", "م.medi", "د.fina"]],
  "عبد الله": [["ع.init", "ب.medi", "د.fina"], ["ا.isol", "ل.init", "ل.medi", "ه.fina"]],
  "الحمد لله": [["ا.isol", "ل.init", "ح.medi", "م.medi", "د.fina"], ["ل.init", "ل.medi", "ه.fina"]],
};
const markedSamples = [
  "مسلم",
  "مُسْلِم",
  "مُحَمَّد",
  "السَّلَامُ عَلَيْكُمْ",
  "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
];
const ctx = (f: LiloFont) => ({ heightMm: f.capHeightMm, letterSpacingMm: 0, wordSpacingMm: 0 });
const shape = (f: LiloFont, text: string, index = 0) => positionArabic(text, index, f, ctx(f));
const names = (f: LiloFont, text: string) => shape(f, text).glyphs.map((g) => arabicCanonical(g.name));

beforeAll(ready);

describe.each(ids)("built-in Arabic: %s", (id) => {
  const font = loadBuiltin(id);
  for (const [text, words] of Object.entries(samples)) {
    it(`shapes and sews ${text}`, () => {
      const expected = id === "malika" && text === "ملكة" ? ["ملكة"] : words.flat().reverse();
      const shaped = shape(font, text);
      expect(shaped.missing).toEqual([]);
      expect(shaped.glyphs.map((g) => arabicCanonical(g.name))).toEqual(expected);
      for (const g of shaped.glyphs) {
        expect(font.glyphs[g.name]).toBeDefined();
        expect(text.slice(g.index).normalize("NFC").startsWith(arabicCanonical(g.name).replace(/\.(isol|init|medi|fina)$/, ""))).toBe(true);
      }
      const result = layoutText(text, font, { heightMm: id === "computer_small" ? 5.6 : 20, threadId: t.id, align: "center", sewing: { threadWeight: id === "computer_small" ? 60 : 40 } });
      expect(result.warnings).toEqual([]);
      expect(result.objects.length).toBeGreaterThan(0);
      expect(result.objects.flatMap(objectPoints).every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
      const design = designOf(result.objects, [t]);
      design.hoop = { name: "Test", widthMm: 500, heightMm: 200 };
      expect(validateDesign(design)).toEqual([]);
      const stitched = sew(design, "arabic");
      expect(stitched.stats.stitchCount).toBeGreaterThan(100);
      expect(stitched.warnings.filter((w) => ["object-failed", "empty", "outside-hoop", "stitch-too-long"].includes(w.code))).toEqual([]);
      expect(readPes(stitched.pes).stitches.some((s) => s.type === "stitch")).toBe(true);
      if (process.env.LILO_SHOTS) savePng(process.env.LILO_SHOTS, `${id}-${Object.keys(samples).indexOf(text)}`, stitched.plan, 20);
    });
  }

  it("selects isolated, initial, medial and final forms with correct joining boundaries", () => {
    for (const letter of ["م", "س", "ل", "ك", "ة", "ا", "د", "ر"]) expect(names(font, letter)).toEqual([`${letter}.isol`]);
    expect(names(font, "ممم")).toEqual(["م.fina", "م.medi", "م.init"]);
    expect(names(font, "مامة")).toEqual(["ة.fina", "م.init", "ا.fina", "م.init"]);
    expect(names(font, "بءب")).toEqual(["ب.isol", "ء", "ب.isol"]);
  });

  it("handles all lam–alef variants and presentation equivalents", () => {
    for (const [logical, presentation] of [["لا", "ﻻ"], ["لأ", "ﻷ"], ["لإ", "ﻹ"], ["لآ", "ﻵ"]]) {
      expect(shape(font, presentation).missing).toEqual([]);
      expect(names(font, presentation)).toEqual(names(font, logical));
      expect(names(font, `ب${presentation}`)).toEqual(names(font, `ب${logical}`));
      expect(shape(font, `ب${logical}`).missing).toEqual([]);
    }
    expect(shape(font, "ﻣﺴﻠﻢ").glyphs).toEqual(shape(font, "مسلم").glyphs);
    expect(names(font, "ل\u200cا")).toEqual(["ا.isol", "ل.isol"]);
    // No lam–alef-madda drawing is present in Malika: use its individual contextual letters.
    expect(names(font, "لآ")).toEqual(id === "malika" ? ["آ.fina", "ل.init"] : ["لآ.isol"]);
  });

  it("keeps marks attached, transparent to joining and zero advance", () => {
    const plain = shape(font, "مسلم").glyphs;
    const marked = shape(font, "مُسْلِم");
    expect(marked.missing).toEqual([]);
    expect(marked.glyphs.filter((g) => !/^\p{M}$/u.test(g.name)).map(({ name, x }) => ({ name, x })))
      .toEqual(plain.map(({ name, x }) => ({ name, x })));
    expect(marked.glyphs.filter((g) => /^\p{M}$/u.test(g.name)).map((g) => g.index)).toEqual([5, 3, 1]);
    for (let i = 1; i < marked.glyphs.length; i++) {
      const g = marked.glyphs[i];
      if (!/^\p{M}$/u.test(g.name)) continue;
      const base = marked.glyphs[i - 1];
      expect(g.x + font.glyphs[g.name].w / 2).toBeCloseTo(base.x + font.glyphs[base.name].w / 2);
    }
    expect(names(font, "لَا")).toEqual(["لا.isol", "َ"]);
    expect(shape(font, "لَا").glyphs.map((g) => g.index)).toEqual([0, 1]);
    expect(names(font, "مﹸسلم")).toEqual(names(font, "مُسلم"));
  });

  it("attaches diacritics to ink bounds and produces stitches for fully marked phrases", () => {
    for (const [sampleIndex, text] of markedSamples.entries()) {
      const shaped = shape(font, text);
      expect(shaped.missing).toEqual(text.includes("ٰ") ? ["ٰ"] : []);
      const plainNames = names(font, text.replace(/\p{M}/gu, ""));
      expect(shaped.glyphs.filter((g) => !/^\p{M}$/u.test(g.name)).map((g) => arabicCanonical(g.name))).toEqual(plainNames);

      let base: (typeof shaped.glyphs)[number] | undefined;
      const occupied: { above: [number, number][]; below: [number, number][] } = { above: [], below: [] };
      for (const glyph of shaped.glyphs) {
        if (!/^\p{M}$/u.test(glyph.name)) {
          base = glyph;
          occupied.above = [];
          occupied.below = [];
          continue;
        }
        expect(base).toBeDefined();
        const baseBounds = glyphYBounds(font.glyphs[base!.name]);
        const markBounds = glyphYBounds(font.glyphs[glyph.name]);
        const placed: [number, number] = [markBounds[0] + glyph.y, markBounds[1] + glyph.y];
        expect(glyph.x + font.glyphs[glyph.name].w / 2).toBeCloseTo(base!.x + font.glyphs[base!.name].w / 2);
        const below = /[\u064d\u0650\u0656\u065c\u065f\u06e3\u06ea\u06ed\u08f2]/u.test(glyph.name);
        if (below) expect(placed[0]).toBeGreaterThan(baseBounds[1]);
        else expect(placed[1]).toBeLessThan(baseBounds[0]);
        for (const prior of occupied[below ? "below" : "above"]) expect(Math.min(placed[1], prior[1]) - Math.max(placed[0], prior[0])).toBeLessThanOrEqual(0);
        occupied[below ? "below" : "above"].push(placed);
      }

      const result = layoutText(text, font, { heightMm: id === "computer_small" ? 5.6 : 20, threadId: t.id, sewing: { threadWeight: id === "computer_small" ? 60 : 40 } });
      expect(result.warnings.map((w) => w.code)).toEqual(text.includes("ٰ") ? ["missing-glyph"] : []);
      const stitched = sew(designOf(result.objects, [t]), "arabic-marks");
      expect(stitched.stats.stitchCount).toBeGreaterThan(100);
      if (process.env.LILO_SHOTS) savePng(process.env.LILO_SHOTS, `${id}-marks-${sampleIndex}`, stitched.plan, 20);
    }
  });

  it("honors ZWJ/ZWNJ without drawing or warning about controls", () => {
    expect(names(font, "ب\u200cب")).toEqual(["ب.isol", "ب.isol"]);
    expect(names(font, "ب\u200dب")).toEqual(["ب.fina", "ب.init"]);
    expect(names(font, "ب\u200d")).toEqual(["ب.init"]);
    expect(names(font, "\u200dب")).toEqual(["ب.fina"]);
    expect(shape(font, "ب\u200dب").glyphs.map((g) => g.index)).toEqual([2, 0]);
    expect(shape(font, "\u2067مسلم\u2069").missing).toEqual([]);
  });

  it("preserves negative margins, advance arithmetic and intentional overlap", () => {
    const placed = shape(font, "مسلم").glyphs;
    const first = font.glyphs["م.fina"];
    const lam = font.glyphs["ل.medi"];
    expect(lam.x0).toBeLessThan(0);
    expect(placed[1].x).toBeCloseTo(font.adv["م.fina"] - first.x0 + lam.x0);
    expect(placed[1].x).toBeLessThan(first.w);
    const wider = positionArabic("مسلم", 0, font, { ...ctx(font), letterSpacingMm: 1 }).glyphs;
    wider.forEach((g, i) => expect(g.x - placed[i].x).toBeCloseTo(i));
    const phrase = shape(font, "مسلم مسلم").glyphs;
    const spaced = positionArabic("مسلم مسلم", 0, font, { ...ctx(font), wordSpacingMm: 3 }).glyphs;
    spaced.forEach((g, i) => expect(g.x - phrase[i].x).toBeCloseTo(i < 4 ? 0 : 3));
  });

  it("reports unsupported source characters and uses the repaired fallback", () => {
    const r = shape(font, "م☃😀");
    expect(r.missing).toEqual(["☃", "😀"]);
    expect(r.glyphs.filter((g) => g.name === "؟").map((g) => g.index).sort()).toEqual([1, 2]);
    const noFallback = { ...font, defaultGlyph: " " };
    expect(shape(noFallback, "م☃").glyphs.map((g) => g.name)).toEqual(["م.isol"]);
    expect(shape(noFallback, "م☃").missing).toEqual(["☃"]);
    const r2 = layoutText("م☃", font, { heightMm: font.capHeightMm * font.minScale, threadId: t.id });
    expect(r2.warnings.map((w) => w.code)).toEqual(["missing-glyph"]);
    expect(r2.warnings[0].message).toContain("☃");
    const isolatedUnsupported = builtinTypeface(font).shapeLine("☃", 0, ctx(font));
    expect(isolatedUnsupported.missing).toEqual(["☃"]);
    expect(isolatedUnsupported.glyphs.map((g) => g.char)).toEqual(["؟"]);
    expect(builtinTypeface(font).shapeLine("١٢٣", 0, ctx(font)).glyphs.map((g) => g.char)).toEqual(["١", "٢", "٣"]);
    expect(builtinTypeface(font).shapeLine(" \t ", 0, ctx(font))).toEqual({ glyphs: [], missing: [] });
  });
});

function glyphYBounds(glyph: LiloFont["glyphs"][string]): [number, number] {
  const ys: number[] = [];
  const add = (points: readonly number[]) => {
    for (let i = 1; i < points.length; i += 2) ys.push(points[i]);
  };
  for (const element of glyph.els) {
    if (element.k === "s") {
      element.rails.forEach(add);
      element.rungs.forEach(add);
    } else if (element.k === "f") {
      add(element.shell);
      element.holes?.forEach(add);
    } else add(element.path);
  }
  return [Math.min(...ys), Math.max(...ys)];
}

describe("Arabic aliases, source mapping and bidi", () => {
  const malika = loadBuiltin("malika");
  const computer = loadBuiltin("computer");

  it("uses Malika's final lam–alef metric alias and prefers original exact metrics", () => {
    const r = shape(malika, "سلام").glyphs;
    expect(r[1].name).toBe("ﻻ.fina");
    expect(r[2].x - r[1].x).toBeCloseTo(23.28 - malika.glyphs["ﻻ.fina"].x0 + malika.glyphs["س.init"].x0);
    const override = { ...malika, adv: { ...malika.adv, "ﻻ.fina": 30 } };
    expect(shape(override, "سلام").glyphs[2].x - r[2].x).toBeCloseTo(30 - 23.28);
    const c = shape(computer, "س لا").glyphs;
    expect(c[1].x).toBeCloseTo(computer.adv["ﻟﺎ.isol"] - computer.glyphs["ﻟﺎ.isol"].x0 + computer.spaceMm);
  });

  it("places whole words atomically and uses their width when no advance exists", () => {
    const r = shape(malika, "ملكة ملكة").glyphs;
    expect(r.map((g) => [g.name, g.index])).toEqual([["ملكة", 5], ["ملكة", 0]]);
    expect(r[1].x).toBeCloseTo(malika.glyphs["ملكة"].w + malika.spaceMm);
    expect(names(malika, "ملكةم")).not.toContain("ملكة");
  });

  it("keeps UTF-16 offsets through expansion, composition, trimming and CRLF", () => {
    expect(shape(computer, "  بﻼم", 10).glyphs.map((g) => g.index)).toEqual([14, 13, 12]);
    expect(shape(computer, "ا\u0654م").glyphs.map((g) => g.index)).toEqual([2, 0]);
    expect(names(computer, "ا\u0654م")).toEqual(["م.isol", "أ.isol"]);
    expect(shape(computer, "😀مسلم").glyphs.map((g) => g.index).sort((a, b) => a - b)).toEqual([0, 2, 3, 4, 5]);
    const r = layoutText("ا\u0654م\r\n  مسلم", computer, { heightMm: 20, threadId: t.id });
    expect([...new Set(r.objects.filter((o) => o.sourceText?.line === 1).map((o) => o.sourceText?.index))]).toEqual([10, 9, 8, 7]);
    expect(arabicCanonical("ﬃ①Ａﻻ")).toBe("ﬃ①Ａلا");
    const latin = { ...computer, glyphs: { ...computer.glyphs, "Å": computer.glyphs["م.isol"] } };
    const composed = layoutText("م\nÅ", latin, { heightMm: 20, threadId: t.id });
    const decomposed = layoutText("م\nA\u030a", latin, { heightMm: 20, threadId: t.id });
    expect(decomposed).toEqual(composed);
  });

  // The real Arabic fonts have no Latin/ASCII-digit drawings. Supply simple test drawings to
  // assert bidi positions separately from coverage/fallback, then test real-font warnings below.
  const mixed = (): LiloFont => ({
    ...computer,
    glyphs: { ...computer.glyphs, ...Object.fromEntries([..."ABC123()-"].map((c) => [c, { w: 3, x0: 0, els: [{ k: "r" as const, path: [0, 0, 3, -3] }] }])) },
    adv: { ...computer.adv, ...Object.fromEntries([..."ABC123()-"].map((c) => [c, 4])) },
  });

  it("orders Latin, numbers, Arabic-Indic digits, paired brackets and isolates correctly", () => {
    const f = mixed();
    expect(names(f, "مسلم ABC 123")).toEqual(["A", "B", "C", "1", "2", "3", "م.fina", "ل.medi", "س.medi", "م.init"]);
    expect(names(f, "مسلم ١٢٣").slice(0, 3)).toEqual(["١", "٢", "٣"]);
    expect(names(f, "(مسلم)")).toEqual(["(", "م.fina", "ل.medi", "س.medi", "م.init", ")"]);
    expect(shape(f, "(مسلم)").glyphs.map((g) => g.index)).toEqual([5, 4, 3, 2, 1, 0]);
    expect(names(f, "مسلم \u2066ABC 123\u2069")).toEqual(names(f, "مسلم ABC 123"));
    expect(names({ ...f, textDirection: "ltr" }, "ABC مسلم 123").slice(0, 3)).toEqual(["A", "B", "C"]);
    const missing = shape(computer, "مسلم ABC 123");
    expect(missing.missing).toEqual(["A", "B", "C", "1", "2", "3"]);
    expect(missing.glyphs.slice(0, 6).map((g) => g.index)).toEqual([5, 6, 7, 9, 10, 11]);
  });

  it("uses logical RTL kerning pairs, with canonical aliases only as fallback", () => {
    const baseline = shape(computer, "مسلم").glyphs;
    const kerned = { ...computer, kerning: { "ل.medi م.fina": 2 } };
    expect(shape(kerned, "مسلم").glyphs[1].x).toBeCloseTo(baseline[1].x - 2);
    const alias = { ...malika, kerning: { "س.init لا.fina": 2 } };
    expect(shape(alias, "سلام").glyphs[2].x).toBeCloseTo(shape(malika, "سلام").glyphs[2].x - 2);
  });

  it("uses Unicode joining properties beyond a short Arabic alphabet list", () => {
    expect(["ب", "ة", "ء", "ٹ", "\u200d", "\u200c", "\u0651", "\u0301"].map(joiningType)).toEqual(["D", "R", "U", "D", "C", "U", "T", "T"]);
  });

  it("retains unchanged Latin, Cyrillic and Hebrew layout results", () => {
    for (const [id, text, height, hash] of [
      ["geneva_simple", "AV Lilo 123", 10, "48bbcf9229648c0ff5fbf7de346991e9eca8cea58b92c38e01f952252cc98b8d"],
      ["cyrillic", "Привет мир", 20, "513bf92e00487ce71d19800abd4328cf5f5f1b4c982d7b0c2d90cbb66dfcc6c7"],
      ["hebrew_font_medium", "שלום", 10, "9efc0ee91fb3eadfb9f8c5151f05bf39b0927828874e98c21171921aebb5d7af"],
    ] as const) {
      const result = layoutText(text, loadBuiltin(id), { heightMm: height, threadId: "regression" });
      expect(result.objects.length).toBeGreaterThan(0);
      expect(createHash("sha256").update(JSON.stringify(result)).digest("hex")).toBe(hash);
    }
  });

  it("scales placement through the public typeface without altering glyph geometry", () => {
    const face = builtinTypeface(computer);
    const a = face.shapeLine("مسلم", 0, ctx(computer));
    const b = face.shapeLine("مسلم", 0, { ...ctx(computer), heightMm: computer.capHeightMm / 2 });
    expect(a.glyphs.map((g) => [g.char, g.index])).toEqual(b.glyphs.map((g) => [g.char, g.index]));
    const left = (g: (typeof a.glyphs)[number]) => Math.min(...g.els.flatMap((e) => e.k === "satin" ? e.strip : e.k === "fill" ? e.shell : e.path).map((p) => p[0]));
    a.glyphs.forEach((g, i) => expect(left(b.glyphs[i])).toBeCloseTo(left(g) / 2, 2));
  });
});
