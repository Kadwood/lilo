import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { customTypeface, initLettering, layoutText, loadCustomFont, type LayoutOptions } from "../src/lettering";
import { readPes } from "../src/pes";
import { MAX_STITCH_MM } from "../src/stitch";
import { designOf, FIXTURE_FONTS_DIR, loadBuiltin, ready, savePng, sew, thread } from "./lettering-helpers";

/**
 * Golden lettering: a few texts go through the whole product path (layout -> plan -> validate -> PES)
 * and we assert invariants plus a stable PES hash. UPDATE_FIXTURES=1 rewrites the hashes; set
 * LILO_SHOTS=<dir> to also write stitch-plan PNG previews there.
 */
const goldenPath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "lettering-golden.json");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const t = thread();

beforeAll(async () => {
  await ready();
  await initLettering();
});

const lato = () => {
  const b = readFileSync(`${FIXTURE_FONTS_DIR}/Lato-Regular.ttf`);
  return customTypeface(loadCustomFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer));
};

interface Case {
  name: string;
  text: string;
  face: () => Parameters<typeof layoutText>[1];
  opts: Omit<LayoutOptions, "threadId">;
  minStitches: number;
  maxWarnings?: string[];
}

const CASES: Case[] = [
  { name: "jk-10mm-builtin", text: "JK", face: () => loadBuiltin("geneva_simple"), opts: { heightMm: 10 }, minStitches: 150 },
  { name: "jk-10mm-custom", text: "JK", face: lato, opts: { heightMm: 10 }, minStitches: 150 },
  { name: "kadwood-15mm-script", text: "Kadwood", face: () => loadBuiltin("pacificlo"), opts: { heightMm: 15 }, minStitches: 800 },
  { name: "monogram-3-lines", text: "JK\nKADWOOD\nSTUDIO", face: () => loadBuiltin("geneva_simple"), opts: { heightMm: 10, align: "center", lineSpacing: 1.1 }, minStitches: 900 },
  {
    name: "arc-text",
    text: "KADWOOD ATELIER",
    face: () => loadBuiltin("geneva_simple"),
    opts: { heightMm: 10, align: "center", onPath: { kind: "arc", center: [0, 0], radiusMm: 45, startDeg: 180, endDeg: 360 } },
    minStitches: 700,
  },
];

const golden: Record<string, { hash: string; stitches: number }> = existsSync(goldenPath) ? JSON.parse(readFileSync(goldenPath, "utf8")) : {};
const next: typeof golden = {};

describe("lettering golden", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const r = layoutText(c.text, c.face(), { ...c.opts, threadId: t.id });
      const design = designOf(r.objects, [t]);
      const s = sew(design, c.name);

      // Invariants
      expect(s.stats.stitchCount).toBeGreaterThanOrEqual(c.minStitches);
      const bad = s.warnings.filter((w) => ["object-failed", "stitch-too-long", "outside-hoop", "empty"].includes(w.code));
      expect(bad).toEqual([]);
      let prev: { x: number; y: number; type: string } | undefined;
      for (const p of s.plan.stitches) {
        if (prev && p.type === "stitch" && prev.type === "stitch") expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThanOrEqual(MAX_STITCH_MM + 1e-6);
        prev = p;
      }
      // Locks: every trim/jump landing is tied (validatePlan adds lock stitches).
      expect(s.plan.stitches.some((p) => p.lock)).toBe(true);
      const back = readPes(s.pes);
      expect(back.stitches.filter((x) => x.type === "stitch").length).toBeGreaterThan(s.stats.stitchCount * 0.9);

      // Stable hash
      const hash = sha(s.pes);
      next[c.name] = { hash, stitches: s.stats.stitchCount };
      if (process.env.UPDATE_FIXTURES !== "1") {
        expect(golden[c.name], `no golden entry for ${c.name}; run with UPDATE_FIXTURES=1`).toBeDefined();
        expect({ hash, stitches: s.stats.stitchCount }).toEqual(golden[c.name]);
      }
      if (process.env.LILO_SHOTS) savePng(process.env.LILO_SHOTS, c.name, s.plan, 20);
    }, 60_000);
  }

  it("writes goldens when asked", () => {
    if (process.env.UPDATE_FIXTURES === "1") writeFileSync(goldenPath, JSON.stringify(next, null, 2) + "\n");
  });
});
