import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOOPS, validateDesign } from "../src/model";
import { readPes } from "../src/pes";
import { MAX_STITCH_MM } from "../src/stitch";
import { FIXTURES } from "./fixtures/fixtures";
import { imageToPes, objectCounts } from "./pipeline";

const goldenPath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "golden.json");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

interface Expectation {
  /** [min, max] design object count. */
  objects: [number, number];
  threads: string[];
  /** Kinds that must be present. */
  kinds: ("fill" | "satin" | "run")[];
}
const EXPECT: Record<string, Expectation> = {
  "k-logo": { objects: [3, 12], threads: ["Ultramarine", "Red"], kinds: ["satin"] },
  badge: { objects: [3, 10], threads: ["Ultramarine", "Red", "Deep Gold"], kinds: ["satin", "fill"] },
  "thin-lines": { objects: [3, 14], threads: ["Black"], kinds: ["satin", "run"] },
};

// UPDATE_GOLDEN rewrites golden.json from whatever the writers produce now, so it blesses bugs too.
// Only run it AFTER test/formats-crosscheck.test.ts passes against pyembroidery (XCHECK_PYTHON=... XCHECK_REQUIRED=1).
const golden: Record<string, { objects: number; stitches: number; colorChanges: number; pesSha256: string }> = existsSync(goldenPath)
  ? JSON.parse(readFileSync(goldenPath, "utf8"))
  : {};
const updated: typeof golden = {};

describe("golden fixtures: image -> design -> plan -> PES", () => {
  for (const f of FIXTURES) {
    describe(f.name, () => {
      let run: Awaited<ReturnType<typeof imageToPes>>;
      it("digitizes", async () => {
        run = await imageToPes(f.make(), {}, f.name);
        expect(validateDesign(run.design)).toEqual([]);
      }, 60_000);

      it("has a sane object and colour count", () => {
        const e = EXPECT[f.name];
        expect(run.design.objects.length).toBeGreaterThanOrEqual(e.objects[0]);
        expect(run.design.objects.length).toBeLessThanOrEqual(e.objects[1]);
        expect(run.design.threads.map((t) => t.name).sort()).toEqual([...e.threads].sort());
        const counts = objectCounts(run.design);
        for (const k of e.kinds) expect(counts[k]).toBeGreaterThan(0);
      });

      it("keeps every stitch within 12 mm and inside the hoop", () => {
        let prev: { x: number; y: number } | null = null;
        for (const s of run.plan.stitches) {
          if (s.type === "colorChange") continue;
          if (prev && s.type === "stitch") expect(Math.hypot(s.x - prev.x, s.y - prev.y)).toBeLessThanOrEqual(MAX_STITCH_MM + 1e-6);
          prev = s;
        }
        expect(run.stats.widthMm).toBeLessThanOrEqual(HOOPS[0].widthMm);
        expect(run.stats.heightMm).toBeLessThanOrEqual(HOOPS[0].heightMm);
        expect(run.warnings.filter((w) => w.code === "outside-hoop" || w.code === "object-failed")).toEqual([]);
      });

      it("defaults to a 60 mm longest side", () => {
        expect(Math.max(run.stats.widthMm, run.stats.heightMm)).toBeGreaterThan(55);
        expect(Math.max(run.stats.widthMm, run.stats.heightMm)).toBeLessThan(65);
      });

      it("writes a PES whose colours and stitch counts read back", () => {
        const back = readPes(run.pes);
        expect(back.stitches.filter((s) => s.type === "stitch")).toHaveLength(run.stats.stitchCount);
        expect(back.stitches.filter((s) => s.type === "colorChange")).toHaveLength(run.stats.colorChanges);
        expect(back.pecIndices).toHaveLength(run.plan.threads.length);
      });

      it("is deterministic and matches the golden hash", async () => {
        const again = await imageToPes(f.make(), {}, f.name);
        expect(sha(again.pes)).toBe(sha(run.pes));
        const entry = {
          objects: run.design.objects.length,
          stitches: run.stats.stitchCount,
          colorChanges: run.stats.colorChanges,
          pesSha256: sha(run.pes),
        };
        if (process.env.UPDATE_GOLDEN) updated[f.name] = entry;
        else expect(entry).toEqual(golden[f.name]);
      }, 60_000);
    });
  }

  it.runIf(process.env.UPDATE_GOLDEN)("writes golden.json", () => {
    writeFileSync(goldenPath, JSON.stringify(updated, null, 2) + "\n");
  });
});
