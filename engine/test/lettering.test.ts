import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { collectionSize, customTypeface, extractCollectionFace, initLettering, layoutText, loadCustomFont, type CustomFont } from "../src/lettering";
import { stripWidths } from "../src/lettering/satin";
import { MAX_STITCH_MM } from "../src/stitch";
import { objectPoints, validateDesign, type DesignObject } from "../src/model";
import { designOf, FIXTURE_FONTS_DIR, loadBuiltin, ready, sew, thread } from "./lettering-helpers";

const t = thread();
const buf = (name: string): ArrayBuffer => {
  const b = readFileSync(`${FIXTURE_FONTS_DIR}/${name}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

beforeAll(async () => {
  await ready();
  await initLettering();
});

const bounds = (objs: DesignObject[]) => {
  const pts = objs.flatMap((o) => objectPoints(o));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

describe("built-in fonts", () => {
  const font = loadBuiltin("geneva_simple");

  it("lays out a word as satin columns with a design that validates", () => {
    const r = layoutText("Lilo", font, { heightMm: 10, threadId: t.id });
    expect(r.objects.length).toBeGreaterThan(4);
    expect(r.objects.every((o) => o.kind === "satin" || o.kind === "run")).toBe(true);
    expect(validateDesign(designOf(r.objects, [t]))).toEqual([]);
    expect(r.objects.every((o) => o.sourceText?.group === "txt")).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("scales so the capital height matches heightMm", () => {
    for (const h of [10, 14]) {
      const b = bounds(layoutText("H", font, { heightMm: h, threadId: t.id }).objects);
      expect(b.maxY - b.minY).toBeGreaterThan(h * 0.9);
      expect(b.maxY - b.minY).toBeLessThan(h * 1.15);
    }
  });

  it("stacks lines and aligns them", () => {
    const left = layoutText("AB\nA", font, { heightMm: 10, threadId: t.id, align: "left" });
    const center = layoutText("AB\nA", font, { heightMm: 10, threadId: t.id, align: "center" });
    const right = layoutText("AB\nA", font, { heightMm: 10, threadId: t.id, align: "right" });
    const line = (r: typeof left, n: number) => bounds(r.objects.filter((o) => o.sourceText?.line === n));
    expect(line(left, 1).minY).toBeGreaterThan(line(left, 0).maxY - 1);
    expect(line(left, 0).minX).toBeCloseTo(line(left, 1).minX, 3);
    const c0 = line(center, 0);
    const c1 = line(center, 1);
    expect((c0.minX + c0.maxX) / 2).toBeCloseTo((c1.minX + c1.maxX) / 2, 3);
    expect(line(right, 0).maxX).toBeCloseTo(line(right, 1).maxX, 3);
  });

  it("applies letter and word spacing", () => {
    const base = bounds(layoutText("AB AB", font, { heightMm: 10, threadId: t.id }).objects);
    const wide = bounds(layoutText("AB AB", font, { heightMm: 10, threadId: t.id, letterSpacingMm: 1, wordSpacingMm: 3 }).objects);
    expect(wide.maxX - wide.minX).toBeCloseTo(base.maxX - base.minX + 2 + 3, 1);
  });

  it("kerning follows the SVG hkern convention: a positive pair moves the next glyph LEFT", () => {
    const firstX = (f: typeof font, ch: string) => bounds(layoutText("AB", f, { heightMm: 10, threadId: t.id }).objects.filter((o) => o.sourceText?.char === ch)).minX;
    const tight = { ...font, kerning: { "A B": 2 } };
    const loose = { ...font, kerning: { "A B": -2 } };
    const s = 10 / font.capHeightMm;
    const base = firstX(font, "B");
    expect(firstX(tight, "B")).toBeCloseTo(base - 2 * s, 6);
    expect(firstX(loose, "B")).toBeCloseTo(base + 2 * s, 6);
    expect(firstX(tight, "A")).toBeCloseTo(firstX(font, "A"), 6); // the first glyph does not move
  });

  it("warns below the font's designed height and reports missing glyphs", () => {
    const r = layoutText("A☃", font, { heightMm: 3, threadId: t.id });
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["below-min-height", "missing-glyph"]));
  });

  it("returns an empty-text warning for blank input", () => {
    const r = layoutText("  \n ", font, { heightMm: 10, threadId: t.id });
    expect(r.objects).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain("empty-text");
  });

  it("places text on an arc: every point lies near the circle", () => {
    const r = layoutText("ARC", font, {
      heightMm: 10,
      threadId: t.id,
      onPath: { kind: "arc", center: [0, 0], radiusMm: 40, startDeg: 180, endDeg: 360 },
      align: "center",
    });
    const b = bounds(r.objects);
    for (const o of r.objects) {
      for (const [x, y] of objectPoints(o)) {
        const d = Math.hypot(x, y);
        expect(d).toBeGreaterThan(36);
        expect(d).toBeLessThan(54);
      }
    }
    // Over the top of the circle (y negative), centred around x = 0.
    expect(b.maxY).toBeLessThan(0);
    expect(Math.abs((b.minX + b.maxX) / 2)).toBeLessThan(2);
  });

  it("warns when the text is longer than the path", () => {
    const r = layoutText("LONG TEXT HERE", font, { heightMm: 10, threadId: t.id, onPath: { kind: "polyline", points: [[0, 0], [20, 0]] } });
    expect(r.warnings.map((w) => w.code)).toContain("text-longer-than-path");
  });

  it("sews: no stitch above 12 mm", () => {
    const r = layoutText("Kadwood 12", font, { heightMm: 12, threadId: t.id });
    const s = sew(designOf(r.objects, [t]));
    expect(s.stats.stitchCount).toBeGreaterThan(300);
    let prev: { x: number; y: number; type: string } | undefined;
    for (const p of s.plan.stitches) {
      if (prev && p.type === "stitch" && prev.type === "stitch") expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThanOrEqual(MAX_STITCH_MM + 1e-6);
      prev = p;
    }
  });
});

describe("custom fonts", () => {
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const fonts: [string, CustomFont][] = [
    ["Lato", loadCustomFont(buf("Lato-Regular.ttf"))],
    ["PT Serif", loadCustomFont(buf("PTSerif-Regular.ttf"))],
  ];

  it("reads the font name", () => {
    expect(fonts[0][1].name).toContain("Lato");
    expect(fonts[1][1].name).toContain("PT Serif");
  });

  for (const [label, cf] of fonts) {
    it(`${label}: every glyph A-Z a-z 0-9 produces objects within stitch and width limits`, () => {
      const face = customTypeface(cf);
      for (const h of [8, 25]) {
        for (const ch of CHARS) {
          const r = layoutText(ch, face, { heightMm: h, threadId: t.id });
          expect(r.objects.length, `${label} ${ch} @${h}mm`).toBeGreaterThan(0);
          for (const o of r.objects) {
            if (o.kind === "satin") {
              const w = stripWidths(o.geometry.strip);
              const med = [...w].sort((a, b) => a - b)[Math.floor(w.length / 2)];
              expect(med, `${label} ${ch} @${h}mm satin median width`).toBeGreaterThanOrEqual(0.9);
              expect(med, `${label} ${ch} @${h}mm satin median width`).toBeLessThanOrEqual(7.2);
            }
          }
          const s = sew(designOf(r.objects, [t]));
          let prev: { x: number; y: number; type: string } | undefined;
          for (const p of s.plan.stitches) {
            if (prev && p.type === "stitch" && prev.type === "stitch") {
              expect(Math.hypot(p.x - prev.x, p.y - prev.y), `${label} ${ch} @${h}mm stitch length`).toBeLessThanOrEqual(MAX_STITCH_MM + 1e-6);
            }
            prev = p;
          }
          expect(s.warnings.filter((w) => w.code === "object-failed"), `${label} ${ch} @${h}mm`).toEqual([]);
        }
      }
    }, 120_000);

    it(`${label}: layout is deterministic`, () => {
      const run = () => JSON.stringify(layoutText("Hamburg 42", customTypeface(loadCustomFont(buf(label === "Lato" ? "Lato-Regular.ttf" : "PTSerif-Regular.ttf"))), { heightMm: 12, threadId: t.id }).objects);
      expect(run()).toBe(run());
    }, 120_000);
  }

  it("warns below 6 mm", () => {
    const r = layoutText("Hi", customTypeface(fonts[0][1]), { heightMm: 4, threadId: t.id });
    const w = r.warnings.find((x) => x.code === "custom-font-small");
    expect(w?.message).toMatch(/6 mm/);
    expect(w?.message).toMatch(/built-in/);
  });

  it("splits a TrueType Collection into stand-alone faces", () => {
    // Build a one-face TTC around Lato and check we can read it back.
    const ttf = new Uint8Array(buf("Lato-Regular.ttf"));
    const v = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
    const numTables = v.getUint16(4);
    const headerLen = 16; // ttcf + version + numFonts + 1 offset
    const out = new Uint8Array(headerLen + ttf.length);
    const ov = new DataView(out.buffer);
    out.set([0x74, 0x74, 0x63, 0x66], 0); // ttcf
    ov.setUint32(4, 0x00010000);
    ov.setUint32(8, 1);
    ov.setUint32(12, headerLen);
    out.set(ttf, headerLen);
    // shift every table offset by headerLen
    for (let i = 0; i < numTables; i++) ov.setUint32(headerLen + 12 + 16 * i + 8, v.getUint32(12 + 16 * i + 8) + headerLen);
    expect(collectionSize(out.buffer)).toBe(1);
    expect(extractCollectionFace(out.buffer, 0).byteLength).toBeGreaterThan(100_000);
    const cf = loadCustomFont(out.buffer);
    expect(cf.name).toContain("Lato");
    expect(layoutText("A", customTypeface(cf), { heightMm: 10, threadId: t.id }).objects.length).toBeGreaterThan(0);
    expect(() => extractCollectionFace(out.buffer, 3)).toThrow(/no font number 4/);
  });

  it("rejects non-font files with a readable message", () => {
    expect(() => loadCustomFont(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]).buffer)).toThrow(/not a usable font/);
  });
});
