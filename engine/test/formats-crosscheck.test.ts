/**
 * Cross-check every export format against pyembroidery (MIT), an independent implementation.
 *
 * Lilo's own readers only prove the writers agree with themselves (a PES header bug shipped that
 * way). Here each design is written in every format and read by `xcheck/read.py` with pyembroidery;
 * the needle positions, colour changes, trim counts (JEF cannot carry any: see NO_TRIM_CHECK), thread count and the header fields pyembroidery's writers
 * fill in must match what Lilo planned, within 0.1 mm.
 *
 * Needs Python with `pip install pyembroidery==1.5.1`. Point `XCHECK_PYTHON` at it (default: python3,
 * then python). If it is missing the suite skips with a console warning, unless `XCHECK_REQUIRED=1`
 * (set in CI), where a missing or wrong pyembroidery is a failure so CI can never skip silently.
 *
 * VIP is not here: pyembroidery has no VIP reader, so VIP is covered only by Lilo's own round trip
 * (export-formats.test.ts) and is untested against any other software.
 *
 * Run this and see it pass BEFORE regenerating test/fixtures/golden.json (UPDATE_GOLDEN=1).
 *
 * PES/PEC: pyembroidery 1.5.1 skips 16 bytes of stitch-block header, but Brother machines (and
 * stitchjs) use 20: two big-endian words `0x9000 | -minX` and `0x9000 | -minY` (0.1 mm). So a correct
 * Lilo file reads in pyembroidery with those words as one leading JUMP, which is dropped before
 * comparing (later positions are relative to it, so they are shifted back by it). The header words themselves are asserted in their own test.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FORMATS, readEmbroidery, writeEmbroidery, type FormatExt } from "../src/formats";
import { applyOrigin, type Origin } from "../src/pes";
import type { PlanStitch, StitchPlan, StitchType } from "../src/stitch";

const PINNED = "1.5.1";
const required = process.env.XCHECK_REQUIRED === "1";

// ---------------------------------------------------------------- designs

type Step = [StitchType | "c", number, number];

const HEXES = [
  "#1f3a93", "#c0392b", "#27ae60", "#f39c12", "#8e44ad", "#16a085", "#d35400", "#2c3e50", "#e84393",
  "#6ab04c", "#7f8c8d", "#2980b9", "#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#ffff00",
];

/** Steps in mm; "c" starts the next colour block (its x/y is where the needle is parked). */
function planOf(steps: Step[]): StitchPlan {
  let block = 0;
  const stitches: PlanStitch[] = steps.map(([k, x, y]) => {
    if (k === "c") {
      block++;
      return { x, y, type: "colorChange", threadIndex: block, objectIndex: -1 };
    }
    return { x, y, type: k, threadIndex: block, objectIndex: block };
  });
  return {
    threads: Array.from({ length: block + 1 }, (_, i) => ({
      id: `t${i}`,
      brand: "Test",
      code: String(i),
      name: `Thread ${i}`,
      hex: HEXES[i % HEXES.length],
    })),
    stitches,
    warnings: [],
  };
}

const ring = (cx: number, cy: number, r: number, n: number): Step[] =>
  Array.from({ length: n }, (_, i): Step => ["stitch", cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);

/** 160 x 260 mm fill: rows 0.4 mm apart, every leg 11.4 mm or less. */
function hoopFill(): Step[] {
  const out: Step[] = [["jump", -80, -130]];
  const legs = 14;
  for (let row = 0, y = -130; y <= 130 + 1e-9; row++, y += 0.4) {
    for (let i = 0; i <= legs; i++) {
      const x = row % 2 === 0 ? -80 + (160 / legs) * i : 80 - (160 / legs) * i;
      out.push(["stitch", x, y]);
    }
  }
  return out;
}

const DESIGNS: Record<string, Step[]> = {
  simple: [["jump", 0, 0], ["stitch", 0, 0], ["stitch", 3, 0], ["stitch", 3, 3], ["stitch", 0, 3], ["stitch", 0, 0], ["c", 0, 0], ["jump", 5, 5], ["stitch", 5, 5], ["stitch", 8, 7], ["stitch", 10, 5]],
  quadrants: [
    ["jump", 10, 10], ["stitch", 10, 10], ["stitch", 25, 12], ["stitch", 12, 30],
    ["jump", -10, 10], ["stitch", -10, 10], ["stitch", -30, 12], ["stitch", -12, 25],
    ["c", -12, 25],
    ["jump", -10, -10], ["stitch", -10, -10], ["stitch", -20, -14], ["stitch", -11, -33],
    ["jump", 10, -10], ["stitch", 10, -10], ["stitch", 31, -11], ["stitch", 13, -26],
  ],
  "long-jumps": [
    ["jump", 0, 0], ["stitch", 0, 0], ["stitch", 4, 0],
    ["jump", 4 + 15, 0], ["stitch", 19, 0], ["stitch", 22, 3], // 15 mm jump
    ["jump", 22, 3 + 25], ["stitch", 22, 28], ["stitch", 25, 28], // 25 mm jump
    ["jump", 25 - 30, 28 - 18], ["stitch", -5, 10], ["stitch", -2, 10], // 30 x 18 mm diagonal
    ["jump", -80, 60], ["stitch", -80, 60], ["stitch", -78, 62], // far
  ],
  "long-trims": [
    ["jump", 0, 0], ["stitch", 0, 0], ["stitch", 4, 0],
    ["trim", 19, 0], ["stitch", 19, 0], ["stitch", 22, 3],
    ["trim", 22, 28], ["stitch", 22, 28], ["stitch", 25, 28],
    ["c", 25, 28],
    ["trim", -40, -50], ["stitch", -40, -50], ["stitch", -37, -48],
  ],
  "many-colours": Array.from({ length: 18 }, (_, i): Step[] => [
    ...(i > 0 ? ([["c", (i - 1) * 3, (i - 1) % 5]] as Step[]) : []),
    ["jump", i * 3, i % 5], ["stitch", i * 3, i % 5], ["stitch", i * 3 + 2, (i % 5) + 2], ["stitch", i * 3 + 1, (i % 5) + 4],
  ]).flat(),
  "trims-mid-colour": [
    ["jump", 0, 0], ["stitch", 0, 0], ["stitch", 5, 0], ["stitch", 5, 5],
    ["trim", 30, 0], ["stitch", 30, 0], ["stitch", 35, 0], ["stitch", 35, 5],
    ["trim", 0, 40], ["stitch", 0, 40], ["stitch", 5, 42],
    ["c", 5, 42],
    ["trim", -30, 10], ["stitch", -30, 10], ["stitch", -25, 12],
    ["trim", 20, 20], ["stitch", 20, 20], ["stitch", 24, 23],
  ],
  "single-stitch": [["stitch", 0, 0]],
  "short-stitches": [
    ["jump", 0, 0], ["stitch", 0, 0], ["stitch", 0.1, 0], ["stitch", 0.2, 0.1], ["stitch", 0.2, 0.3], ["stitch", 0.5, 0.3],
    ["stitch", 0.5, 0.4], ["stitch", 0.7, 0.4], ["stitch", 0.7, 0.8], ["stitch", 1.0, 0.8], ["stitch", 1.1, 0.9],
  ],
  // 12.4 mm legs (past the XXX short-form limit once converted), on each axis, both directions
  "12.4mm-legs": [
    ["jump", -12.4, -12.4], ["stitch", -12.4, -12.4], ["stitch", 0, -12.4], ["stitch", 12.4, -12.4], ["stitch", 12.4, 0],
    ["stitch", 12.4, 12.4], ["stitch", 0, 12.4], ["stitch", -12.4, 12.4], ["stitch", -12.4, 0], ["stitch", -12.4, -12.4],
  ],
  ring: [["jump", 10, 0], ...ring(0, 0, 10, 40), ["stitch", 10, 0]],
  "hoop-fill-160x260": hoopFill(),
};

const ORIGINS: Record<string, Origin> = {
  center: { h: "center", v: "center" },
  left: { h: "left", v: "center" },
  right: { h: "right", v: "center" },
  top: { h: "center", v: "top" },
  bottom: { h: "center", v: "bottom" },
  "top-left": { h: "left", v: "top" },
  "bottom-right": { h: "right", v: "bottom" },
};

interface Case {
  name: string;
  plan: StitchPlan;
}
const CASES: Case[] = [
  ...Object.entries(DESIGNS).map(([name, steps]) => ({ name, plan: applyOrigin(planOf(steps), ORIGINS.center) })),
  ...Object.entries(ORIGINS)
    .filter(([n]) => n !== "center")
    .map(([n, o]) => ({ name: `origin-${n}`, plan: applyOrigin(planOf(DESIGNS.quadrants), o) })),
];

// ---------------------------------------------------------------- python

interface PyFile {
  error?: string;
  stitches: [number, number, string][];
  threads: string[];
  bounds: [number, number, number, number];
  header?: Record<string, number>;
}
interface PyOut {
  pyembroidery: string;
  files: Record<string, PyFile>;
}

const here = new URL(".", import.meta.url).pathname;
const script = join(here, "xcheck", "read.py");

function findPython(): { python: string; version: string } | { problem: string } {
  const tried: string[] = [];
  for (const python of [process.env.XCHECK_PYTHON, "python3", "python"].filter((p): p is string => !!p)) {
    const r = spawnSync(python, ["-c", "from importlib.metadata import version; print(version('pyembroidery'))"], { encoding: "utf8" });
    if (r.status === 0) return { python, version: r.stdout.trim() };
    tried.push(`${python}: ${r.error ? r.error.message : r.stderr.trim().split("\n").pop()}`);
  }
  return { problem: `pyembroidery is not available (${tried.join("; ")}). Run: pip install pyembroidery==${PINNED}, or set XCHECK_PYTHON.` };
}

const found = findPython();
const FMT_EXTS = FORMATS.filter((f) => f.ext !== "vip").map((f) => f.ext);

if ("problem" in found && !required) {
  // Not in describe.skipIf: vitest drops console output of a fully skipped file, and this must be seen.
  describe("pyembroidery cross-check (skipped)", () => {
    it("pyembroidery is not installed, so the cross-check is skipped", (ctx) => {
      console.warn(`\n[xcheck] SKIPPED: ${found.problem}\n[xcheck] CI sets XCHECK_REQUIRED=1 so this cannot be skipped there.\n`);
      ctx.skip();
    });
  });
}

describe.skipIf("problem" in found && !required)("pyembroidery cross-check", () => {
  if ("problem" in found) {
    it("pyembroidery is installed", () => {
      throw new Error(`XCHECK_REQUIRED=1 but ${found.problem}`);
    });
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "lilo-xcheck-"));
  const bytesOf = new Map<string, Uint8Array>();
  let py: PyOut;
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it(`uses pyembroidery ${PINNED}`, () => {
    if (required) expect(found.version).toBe(PINNED);
    else if (found.version !== PINNED) console.warn(`[xcheck] pyembroidery ${found.version} found, CI pins ${PINNED}`);
  });

  beforeAll(() => {
    const paths: string[] = [];
    for (const c of CASES) {
      for (const ext of FMT_EXTS) {
        const bytes = writeEmbroidery(c.plan, ext, { label: c.name.slice(0, 12), jefDate: "20260101000000" });
        const path = join(dir, `${c.name}.${ext}`);
        writeFileSync(path, bytes);
        bytesOf.set(`${c.name}.${ext}`, bytes);
        paths.push(path);
      }
    }
    const r = spawnSync(found.python, [script, ...paths], { encoding: "utf8", maxBuffer: 1 << 30 });
    if (r.status !== 0) throw new Error(`read.py failed: ${r.stderr}`);
    py = JSON.parse(r.stdout) as PyOut;
  }, 120_000);

  const needlesOf = (plan: StitchPlan) => plan.stitches.filter((s) => s.type === "stitch").map((s) => [s.x * 10, s.y * 10]);
  /**
   * Trims worth encoding: a trim after at least one needle since the last colour change or trim.
   * A trim right after a colour change (or at the start) is dropped by every writer, because the
   * machine already cuts on a colour change.
   */
  const trimsOf = (plan: StitchPlan): number => {
    let n = 0;
    let sewn = false;
    for (const s of plan.stitches) {
      if (s.type === "stitch") sewn = true;
      else if (s.type === "colorChange") sewn = false;
      else if (s.type === "trim" && sewn) {
        n++;
        sewn = false;
      }
    }
    return n;
  };
  /** Formats where no trim count can be compared, and why (documented, not skipped silently). */
  const NO_TRIM_CHECK: Partial<Record<FormatExt, string>> = {
    jef: "JEF has no trim record. pyembroidery's reader invents trims from long jumps, so its count says nothing about ours.",
  };
  const jumpLegsOver = (plan: StitchPlan, mm: number): boolean => {
    let px = 0;
    let py = 0;
    for (const s of plan.stitches) {
      if (s.type === "jump" && Math.max(Math.abs(s.x - px), Math.abs(s.y - py)) > mm) return true;
      px = s.x;
      py = s.y;
    }
    return false;
  };
  /**
   * What pyembroidery must report as TRIM for this plan, per format (null = cannot check).
   * Observed against pyembroidery 1.5.1:
   * - EXP, XXX, U01, HUS: one trim per trim between needle runs.
   * - PES/PEC: every plan trim is written, even one right after a colour change.
   * - DST: a trim is three zero-net jumps, and pyembroidery also reads any run of 3+ jumps (a jump
   *   over ~24 mm is split into that many) as a trim, so a long plain jump can only add.
   * - VP3: one trim per trim, plus one pyembroidery always reports for the file.
   * - TBF: one trim per trim, plus the explicit trim the writer puts before each colour change.
   * - G-code: writes only needle moves, so there are none.
   */
  const expectedTrims = (ext: FormatExt, plan: StitchPlan): { n: number; atLeast?: boolean; why: string } | null => {
    const tr = trimsOf(plan);
    const all = plan.stitches.filter((s) => s.type === "trim").length;
    const cc = blocksOf(plan) - 1;
    switch (ext) {
      case "jef":
        return null;
      case "gcode":
        return { n: 0, why: "G-code has no trims" };
      case "pes":
      case "pec":
        return { n: all, why: "every plan trim is written" };
      case "vp3":
        return { n: tr + 1, why: "plan trims + 1 pyembroidery reports for every VP3" };
      case "tbf":
        return { n: tr + cc, why: "plan trims + one before each colour change" };
      case "dst":
        return { n: tr, atLeast: jumpLegsOver(plan, 24), why: "plan trims, long plain jumps may add" };
      default:
        return { n: tr, why: "plan trims" };
    }
  };
  const blocksOf = (plan: StitchPlan) => plan.stitches.filter((s) => s.type === "colorChange").length + 1;
  const head = (f: PyFile, key: string): number => {
    const v = f.header?.[key];
    if (v === undefined) throw new Error(`header field ${key} missing`);
    return v;
  };

  /** PES/PEC stitch block start, and the stitch bytes' position relative to it. */
  const blockStart = (bytes: Uint8Array, ext: FormatExt): number => {
    if (ext === "pes") return (bytes[8] | (bytes[9] << 8) | (bytes[10] << 16) | (bytes[11] << 24)) + 512;
    return String.fromCharCode(...bytes.subarray(0, 3)) === "LA:" ? 512 : 520;
  };
  const near12 = (a: number, b: number) => Math.min((a - b) & 0xfff, (b - a) & 0xfff) <= 2;
  /** The two big-endian words `0x9000|-minX`, `0x9000|-minY` a Brother-style header carries, if present and right. */
  const wordsOk = (bytes: Uint8Array, at: number, plan: StitchPlan): boolean => {
    if ((bytes[at + 16] & 0xf0) !== 0x90 || (bytes[at + 18] & 0xf0) !== 0x90) return false;
    const n = needlesOf(plan);
    const minX = Math.min(...n.map((p) => p[0]));
    const minY = Math.min(...n.map((p) => p[1]));
    const wx = ((bytes[at + 16] << 8) | bytes[at + 17]) & 0xfff;
    const wy = ((bytes[at + 18] << 8) | bytes[at + 19]) & 0xfff;
    return near12(wx, -Math.round(minX) & 0xfff) && near12(wy, -Math.round(minY) & 0xfff);
  };

  for (const c of CASES) {
    describe(c.name, () => {
      for (const ext of FMT_EXTS) {
        it(ext, () => {
          const bytes = bytesOf.get(`${c.name}.${ext}`)!;
          const f = py.files[`${c.name}.${ext}`];
          expect(f.error, "pyembroidery could not read the file").toBeUndefined();
          let entries = f.stitches;

          if (ext === "pes" || ext === "pec") {
            const at = blockStart(bytes, ext);
            if (wordsOk(bytes, at, c.plan)) {
              expect(entries[0][2], "the header words read as one leading jump").toBe("jump");
              // pyembroidery moves by the jump, so every later position is shifted by it
              const [ox, oy] = entries[0];
              entries = entries.slice(1).map(([x, y, k]) => [x - ox, y - oy, k]);
            }
          }
          const other = entries.filter((e) => e[2].startsWith("other:") || e[2] === "sequenceBreak");
          expect(other, "unexpected commands").toEqual([]);

          // needles: same count, same order, within 0.1 mm
          const want = needlesOf(c.plan);
          const got = entries.filter((e) => e[2] === "stitch");
          expect(got.length, "needle count").toBe(want.length);
          let worst = 0;
          got.forEach((g, i) => {
            worst = Math.max(worst, Math.abs(g[0] - want[i][0]), Math.abs(g[1] - want[i][1]));
          });
          expect(worst, "worst needle error (0.1 mm)").toBeLessThanOrEqual(1);

          // trims between needle runs: how each format shows them to pyembroidery is in expectedTrims
          const trimsGot = entries.filter((e) => e[2] === "trim").length;
          const t = expectedTrims(ext, c.plan);
          if (t === null) expect(NO_TRIM_CHECK[ext], `${ext} trim check is documented as impossible`).toBeTruthy();
          else if (t.atLeast) expect(trimsGot, `trims (>= ${t.n}: ${t.why})`).toBeGreaterThanOrEqual(t.n);
          else expect(trimsGot, `trims (expected ${t.n}: ${t.why})`).toBe(t.n);

          // colours: needle-set formats mark every block (the first too), the rest mark the changes
          const needleSet = ext === "u01" || ext === "tbf";
          const changes = entries.filter((e) => e[2] === "colorChange" || e[2] === "stop").length;
          const sets = entries.filter((e) => e[2] === "needleSet").length;
          if (needleSet) expect(sets, "needle sets").toBe(blocksOf(c.plan));
          else expect(changes, "colour changes").toBe(blocksOf(c.plan) - 1);

          const colourFormat = FORMATS.find((x) => x.ext === ext)!.hasColors;
          if (colourFormat && ext !== "gcode") expect(f.threads.length, "thread count").toBe(blocksOf(c.plan));
          if (ext === "xxx" || ext === "vp3") expect(f.threads, "exact thread colours").toEqual(c.plan.threads.map((t) => t.hex));

          // header fields pyembroidery's own writers set, checked against its reading of the body
          const [minX, minY, maxX, maxY] = f.bounds;
          if (ext === "dst") {
            expect(Math.abs(head(f, "+X") - Math.abs(maxX)), "DST +X").toBeLessThanOrEqual(1);
            expect(Math.abs(head(f, "-X") - Math.abs(minX)), "DST -X").toBeLessThanOrEqual(1);
            expect(Math.abs(head(f, "+Y") - Math.abs(maxY)), "DST +Y").toBeLessThanOrEqual(1);
            expect(Math.abs(head(f, "-Y") - Math.abs(minY)), "DST -Y").toBeLessThanOrEqual(1);
          }
          if (ext === "jef") {
            const w = maxX - minX;
            const h = maxY - minY;
            expect(Math.abs(head(f, "left") - w / 2), "JEF half width").toBeLessThanOrEqual(1);
            expect(Math.abs(head(f, "right") - w / 2), "JEF half width").toBeLessThanOrEqual(1);
            expect(Math.abs(head(f, "top") - h / 2), "JEF half height").toBeLessThanOrEqual(1);
            expect(Math.abs(head(f, "bottom") - h / 2), "JEF half height").toBeLessThanOrEqual(1);
            expect(head(f, "hoop"), "JEF hoop code (pyembroidery picks it from the same size)").toBe(head(f, "expectedHoop"));
          }
          if (ext === "vp3") {
            expect(Math.abs(head(f, "right") - maxX * 100), "VP3 right").toBeLessThanOrEqual(100);
            expect(Math.abs(head(f, "left") - minX * 100), "VP3 left").toBeLessThanOrEqual(100);
            expect(Math.abs(head(f, "top") - minY * 100), "VP3 top").toBeLessThanOrEqual(100);
            expect(Math.abs(head(f, "bottom") - maxY * 100), "VP3 bottom").toBeLessThanOrEqual(100);
          }

          // Lilo reads its own file the same way (sanity: the two readers agree on the needle count)
          if (FORMATS.find((x) => x.ext === ext)!.canRead) {
            expect(readEmbroidery(bytes, ext).plan.stitches.filter((s) => s.type === "stitch").length, "Lilo's own reading").toBe(want.length);
          }
        });
      }
      for (const ext of ["pes", "pec"] as const) {
        it(`${ext} stitch-block header has the 0x9000|-min words at +16..+20`, () => {
          const bytes = bytesOf.get(`${c.name}.${ext}`)!;
          const at = blockStart(bytes, ext);
          expect([...bytes.subarray(at + 12, at + 16)], "0x1e0, 0x1b0").toEqual([0xe0, 0x01, 0xb0, 0x01]);
          expect(
            wordsOk(bytes, at, c.plan),
            `bytes +16..+20 are ${[...bytes.subarray(at + 16, at + 20)].map((b) => b.toString(16).padStart(2, "0")).join(" ")}, expected 0x9000|-minX and 0x9000|-minY (big-endian)`,
          ).toBe(true);
        });
      }
    });
  }
});
