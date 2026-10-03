import { describe, expect, it } from "vitest";
import { designToEmbroidery, designToPes } from "../src/export";
import { FORMAT_EXTENSIONS, readEmbroidery } from "../src/formats";
import { sampleDesign } from "../src/stitch/sample-design";

describe("designToEmbroidery", () => {
  const design = sampleDesign();

  it("writes every format, and each one reads back with stitches", () => {
    for (const ext of FORMAT_EXTENSIONS) {
      const r = designToEmbroidery(design, ext, { label: "test" });
      expect(r.bytes.length, ext).toBeGreaterThan(100);
      const back = readEmbroidery(r.bytes, ext);
      expect(back.plan.stitches.filter((s) => s.type === "stitch").length, ext).toBeGreaterThan(100);
    }
  });

  it("the PES it writes is the PES designToPes writes", () => {
    const a = designToEmbroidery(design, "pes", { label: "same" });
    const b = designToPes(design, { label: "same" });
    expect(Array.from(a.bytes)).toEqual(Array.from(b.pes));
    expect(a.stats.stitchCount).toBe(b.stats.stitchCount);
  });
});
