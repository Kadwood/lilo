/**
 * Cross-check against pyembroidery (MIT), the reference the format code was ported from.
 *
 * Skipped unless XCHECK_DIR is set. Two directions, driven by a Python script kept OUTSIDE the repo
 * (pyembroidery lives in a scratch venv):
 *
 *   XCHECK_DIR=/tmp/x XCHECK_PHASE=write  vitest run test/formats-crosscheck.test.ts
 *       writes <dir>/ts/<plan>.<ext> and <dir>/<plan>.plan.json (the input in 0.1 mm units)
 *   (python reads every file with pyembroidery, writes <dir>/py/<plan>.<ext>)
 *   XCHECK_DIR=/tmp/x XCHECK_PHASE=read   vitest run test/formats-crosscheck.test.ts
 *       reads <dir>/py/* with Lilo and checks needle positions and colour blocks
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FORMATS, planToPattern, readEmbroidery, writeEmbroidery } from "../src/formats";
import { islandsPlan, samplePlan } from "../src/formats/test-plans";

const dir = process.env.XCHECK_DIR;
const phase = process.env.XCHECK_PHASE ?? "write";
const plans = { sample: samplePlan(), islands: islandsPlan() };
const needles = (p: ReturnType<typeof samplePlan>) =>
  p.stitches.filter((s) => s.type === "stitch").map((s) => [Math.round(s.x * 10) + 0, Math.round(s.y * 10) + 0]);
const blocks = (p: ReturnType<typeof samplePlan>) => p.stitches.filter((s) => s.type === "colorChange").length + 1;

describe.skipIf(!dir)("pyembroidery cross-check", () => {
  if (!dir) return;
  if (phase === "write") {
    it("writes every format for pyembroidery to read", () => {
      mkdirSync(join(dir, "ts"), { recursive: true });
      for (const [name, plan] of Object.entries(plans)) {
        const pattern = planToPattern(plan, name);
        writeFileSync(
          join(dir, `${name}.plan.json`),
          JSON.stringify({ name, stitches: pattern.stitches, threads: pattern.threads }),
        );
        for (const f of FORMATS) {
          writeFileSync(join(dir, "ts", `${name}.${f.ext}`), writeEmbroidery(plan, f.ext, { label: name, jefDate: "20260101000000" }));
        }
      }
    });
  } else {
    it("reads what pyembroidery wrote", () => {
      let checked = 0;
      for (const [name, plan] of Object.entries(plans)) {
        for (const f of FORMATS) {
          const path = join(dir, "py", `${name}.${f.ext}`);
          if (!existsSync(path)) continue;
          const back = readEmbroidery(new Uint8Array(readFileSync(path)), f.ext);
          // 1. Lilo reads the file exactly as pyembroidery does
          const ref = JSON.parse(readFileSync(`${path}.read.json`, "utf8")) as { needles: number[][]; blocks: number; trims: number };
          expect(needles(back.plan), `${name}.${f.ext} needles vs pyembroidery's reading`).toEqual(ref.needles);
          expect(blocks(back.plan), `${name}.${f.ext} blocks vs pyembroidery's reading`).toBe(ref.blocks);
          // 2. ...and the file still holds the design (pyembroidery's VP3 truncates deltas, so allow 0.1 mm)
          const want = needles(plan);
          const got = needles(back.plan);
          expect(got.length, `${name}.${f.ext} needle count`).toBe(want.length);
          const worst = Math.max(...got.map((g, i) => Math.max(Math.abs(g[0] - want[i][0]), Math.abs(g[1] - want[i][1]))));
          expect(worst, `${name}.${f.ext} worst needle error (0.1 mm)`).toBeLessThanOrEqual(f.ext === "vp3" || f.ext === "u01" ? 1 : 0);
          expect(blocks(back.plan), `${name}.${f.ext} blocks`).toBe(blocks(plan));
          checked++;
        }
      }
      console.log(`read ${checked} pyembroidery-written files`);
      expect(checked).toBeGreaterThan(0);
    });
  }
});
