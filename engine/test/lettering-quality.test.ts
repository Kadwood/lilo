import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { customTypeface, initLettering, layoutText, loadCustomFont } from "../src/lettering";
import { customMinColumnFor, letterHeightWarning, minLetterHeightFor } from "../src/presets";
import { FIXTURE_FONTS_DIR, ready, thread } from "./lettering-helpers";

const t = thread();
const buf = (name: string): ArrayBuffer => {
  const b = readFileSync(`${FIXTURE_FONTS_DIR}/${name}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

beforeAll(async () => {
  await ready();
  await initLettering();
});

describe("custom-font lettering follows the sewing setup", () => {
  it("narrowest column: 1.5 mm Standard, 1.0 mm Premium", () => {
    expect(customMinColumnFor("standard")).toBe(1.5);
    expect(customMinColumnFor(undefined)).toBe(1.5);
    expect(customMinColumnFor("premium")).toBe(1);
  });

  it("an 'l' whose stem is between 1.0 and 1.5 mm is a run at Standard and a satin column at Premium", () => {
    const face = customTypeface(loadCustomFont(buf("Lato-Regular.ttf")));
    const kinds = (quality: "standard" | "premium") => layoutText("l", face, { heightMm: 10, threadId: t.id, sewing: { quality, threadWeight: 40 } }).objects.map((o) => o.kind);
    expect(kinds("premium")).toContain("satin");
    expect(kinds("standard")).not.toContain("satin");
  }, 60_000);

  it("the small-letter warning follows the thread weight", () => {
    const face = customTypeface(loadCustomFont(buf("Lato-Regular.ttf")));
    const warn = (h: number, w: 40 | 60) => layoutText("Hi", face, { heightMm: h, threadId: t.id, sewing: { quality: "standard", threadWeight: w } }).warnings.find((x) => x.code === "custom-font-small");
    expect(warn(5, 40)?.message).toMatch(/above 6 mm/);
    expect(warn(5, 60)).toBeUndefined();
    expect(warn(3, 60)?.message).toMatch(/above 4 mm/);
  }, 60_000);
});

describe("letterHeightWarning", () => {
  it("is 6 mm at 40 wt and 4 mm at 60 wt", () => {
    expect([minLetterHeightFor(40), minLetterHeightFor(60)]).toEqual([6, 4]);
    expect(letterHeightWarning(5.9, 40)).toMatch(/under 6 mm/);
    expect(letterHeightWarning(6, 40)).toBeNull();
    expect(letterHeightWarning(5, 60)).toBeNull();
    expect(letterHeightWarning(3.9, 60)).toMatch(/under 4 mm/);
  });
  it("suggests 60 wt only while on 40 wt", () => {
    expect(letterHeightWarning(5, 40)).toMatch(/60 wt/);
    expect(letterHeightWarning(3, 60)).not.toMatch(/switch/);
  });
});
