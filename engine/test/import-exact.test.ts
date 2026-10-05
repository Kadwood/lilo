/**
 * Opening a stitch file in the editor must not move a single needle: PES (or any format) in, edited
 * nothing, same format out = the same needle drops, within 0.1 mm. The editor opens a file as `exact`
 * manual-stitch objects (`planToManualDesign`); the export pipeline then adds no tie stitches and merges
 * nothing for them.
 *
 * Also read back with pyembroidery (see formats-crosscheck.test.ts for how to install it; XCHECK_PYTHON
 * and XCHECK_REQUIRED work the same here), so Lilo's own reader can't agree with its own writer by accident.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { designToEmbroidery } from "../src/export";
import { FORMATS, planToManualDesign, readEmbroidery, stitchPlanToManualObjects, writeEmbroidery, type FormatExt } from "../src/formats";
import { applyOrigin } from "../src/pes";
import { sampleDesign } from "../src/stitch/sample-design";
import { designToStitchPlan, type StitchPlan } from "../src/stitch";

const required = process.env.XCHECK_REQUIRED === "1";
const READABLE = FORMATS.filter((f) => f.canRead).map((f) => f.ext);

/** What the editor's export would write for a plan that was just read back: a plain "open, then save in the same format". */
const sampleFile = (ext: FormatExt) => designToEmbroidery(sampleDesign(), ext, { label: "rooster" }).bytes;
const needles = (plan: StitchPlan) => plan.stitches.filter((s) => s.type === "stitch");
const colourBlocks = (plan: StitchPlan) => plan.stitches.filter((s) => s.type === "colorChange").length + 1;

describe("an imported file exports the same needle drops", () => {
  for (const ext of READABLE) {
    it(ext, () => {
      const original = sampleFile(ext);
      const first = readEmbroidery(original, ext);
      const design = planToManualDesign(first.plan);
      expect(design.objects.length).toBeGreaterThan(0);
      for (const o of design.objects) expect(o.kind === "run" && o.params.exact).toBe(true);
      const again = readEmbroidery(designToEmbroidery(design, ext, { label: "rooster" }).bytes, ext);
      const a = needles(first.plan);
      const b = needles(again.plan);
      expect(b).toHaveLength(a.length);
      let worst = 0;
      a.forEach((s, i) => (worst = Math.max(worst, Math.abs(s.x - b[i].x), Math.abs(s.y - b[i].y))));
      expect(worst, "largest move of any needle, mm").toBeLessThanOrEqual(0.1 + 1e-9);
      expect(colourBlocks(again.plan)).toBe(colourBlocks(first.plan));
    });
  }

  it("a file that was not centred comes back as the same shape, shifted as a whole by the export's centring", () => {
    const base = designToStitchPlan(sampleDesign());
    const off = { ...base, stitches: base.stitches.map((s) => ({ ...s, x: s.x + 40, y: s.y - 25 })) };
    const bytes = writeEmbroidery(off, "dst");
    const first = readEmbroidery(bytes, "dst");
    const again = readEmbroidery(designToEmbroidery(planToManualDesign(first.plan), "dst").bytes, "dst");
    const a = needles(first.plan);
    const b = needles(again.plan);
    expect(b).toHaveLength(a.length);
    const dx = b[0].x - a[0].x;
    const dy = b[0].y - a[0].y;
    a.forEach((s, i) => {
      expect(Math.abs(b[i].x - s.x - dx)).toBeLessThanOrEqual(0.1 + 1e-9);
      expect(Math.abs(b[i].y - s.y - dy)).toBeLessThanOrEqual(0.1 + 1e-9);
    });
  });

  it("pixel art placed by the editor still gets its tie stitches (only a file's stitches are exact)", () => {
    const plan = applyOrigin(readEmbroidery(sampleFile("pes"), "pes").plan);
    const { objects } = stitchPlanToManualObjects(plan, "Pixel art");
    expect(objects.every((o) => o.kind === "run" && o.params.exact === undefined)).toBe(true);
  });
});

interface PyOut {
  files: Record<string, { error?: string; stitches: [number, number, string][] }>;
}
const script = join(new URL(".", import.meta.url).pathname, "xcheck", "read.py");
function findPython(): string | null {
  for (const python of [process.env.XCHECK_PYTHON, "python3", "python"].filter((p): p is string => !!p)) {
    const r = spawnSync(python, ["-c", "import pyembroidery"], { encoding: "utf8" });
    if (r.status === 0) return python;
  }
  return null;
}
const python = findPython();

describe.skipIf(!python && !required)("the same, read by pyembroidery", () => {
  const dir = mkdtempSync(join(tmpdir(), "lilo-import-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it("python is there", () => expect(python).not.toBeNull());
  for (const ext of READABLE.filter((e) => e !== "vip")) {
    it(`${ext}: original and re-exported file hold the same needles (within 0.1 mm)`, () => {
      const original = sampleFile(ext);
      const design = planToManualDesign(readEmbroidery(original, ext).plan);
      const exported = designToEmbroidery(design, ext, { label: "rooster" }).bytes;
      const a = join(dir, `a.${ext}`);
      const b = join(dir, `b.${ext}`);
      writeFileSync(a, original);
      writeFileSync(b, exported);
      const r = spawnSync(python!, [script, a, b], { encoding: "utf8", maxBuffer: 1 << 30 });
      expect(r.status, r.stderr).toBe(0);
      const out = JSON.parse(r.stdout) as PyOut;
      const pa = out.files[`a.${ext}`];
      const pb = out.files[`b.${ext}`];
      expect(pa.error).toBeUndefined();
      expect(pb.error).toBeUndefined();
      const na = pa.stitches.filter((s) => s[2] === "stitch");
      const nb = pb.stitches.filter((s) => s[2] === "stitch");
      expect(nb).toHaveLength(na.length);
      na.forEach((s, i) => {
        // pyembroidery works in 0.1 mm units
        expect(Math.abs(s[0] - nb[i][0])).toBeLessThanOrEqual(1);
        expect(Math.abs(s[1] - nb[i][1])).toBeLessThanOrEqual(1);
      });
    });
  }
});
