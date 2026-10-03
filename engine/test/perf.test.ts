import { writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { autoDigitize } from "../src/autodigitize";
import { initVtracerNode } from "../src/node";
import { addHistorySnapshot, createProject, loadProject, saveProject } from "../src/project";
import { designToStitchPlan, planStats, validatePlan } from "../src/stitch";
import { logo1200, photo1200, stressDesign } from "./perf-fixtures";

/**
 * Opt-in performance numbers: `LILO_PERF=1 LILO_PERF_OUT=perf.json pnpm --filter @lilo/engine exec vitest run test/perf.test.ts`.
 * Prints one JSON object. Not part of the normal run (it takes a minute and asserts only loose ceilings).
 */
const on = process.env.LILO_PERF === "1";
const out: Record<string, unknown> = {};
const time = async <T>(fn: () => T | Promise<T>): Promise<{ ms: number; value: T }> => {
  const t0 = performance.now();
  const value = await fn();
  return { ms: Math.round(performance.now() - t0), value };
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe.skipIf(!on)("perf", () => {
  beforeAll(initVtracerNode);

  it("auto-digitize 1200 px logo (6 colours) and photo-like image", async () => {
    const logo = logo1200();
    const photo = photo1200();
    const a = await time(() => autoDigitize(logo, { colors: 6 }));
    const planA = await time(() => validatePlan(designToStitchPlan(a.value.design), a.value.design.hoop));
    out.logo = { digitizeMs: a.ms, planMs: planA.ms, objects: a.value.design.objects.length, stitches: planStats(planA.value.plan).stitchCount };
    const b = await time(() => autoDigitize(photo, { colors: 6 }));
    const planB = await time(() => validatePlan(designToStitchPlan(b.value.design), b.value.design.hoop));
    out.photo = { digitizeMs: b.ms, planMs: planB.ms, objects: b.value.design.objects.length, stitches: planStats(planB.value.plan).stitchCount };
    expect(a.value.design.objects.length).toBeGreaterThan(0);
  }, 300_000);

  it("stress design: stitch generation and re-stitch after one change", async () => {
    const d = stressDesign(300);
    const gen = await time(() => designToStitchPlan(d));
    const full = await time(() => validatePlan(designToStitchPlan(d), d.hoop));
    const val = await time(() => validatePlan(gen.value, d.hoop));
    const stats = planStats(full.value.plan);
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const moved = { ...d, objects: d.objects.map((o, k) => (k === 150 && o.kind === "fill" ? { ...o, params: { ...o.params, angleDeg: 10 + i } } : o)) };
      runs.push((await time(() => validatePlan(designToStitchPlan(moved), moved.hoop))).ms);
    }
    out.stress = { objects: d.objects.length, stitches: stats.stitchCount, firstMs: full.ms, generateMs: gen.ms, validateMs: val.ms, restitchMs: median(runs) };
    expect(stats.stitchCount).toBeGreaterThan(60_000);
  }, 300_000);

  it(".lilo save and load with 50 history snapshots", async () => {
    let p = createProject({ title: "stress", design: stressDesign(300) });
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      p = { ...p, doc: { ...p.doc, design: { ...p.doc.design, objects: p.doc.design.objects.map((o, k) => (k === i ? { ...o, name: `edit ${i}` } : o)) } } };
      p = addHistorySnapshot(p, new Date(2026, 0, 1, 0, i));
    }
    const snapMs = Math.round(performance.now() - t0);
    const save = await time(() => saveProject(p));
    const load = await time(() => loadProject(save.value));
    out.lilo = { snapshotsMs: snapMs, saveMs: save.ms, loadMs: load.ms, bytes: save.value.length, docJsonBytes: JSON.stringify(p.doc).length, history: p.history.length };
    expect(load.value.project.history.length).toBe(50);
  }, 300_000);

  it("writes the stress project (no history) for the browser run: LILO_STRESS_OUT=<file>", () => {
    if (!process.env.LILO_STRESS_OUT) return;
    writeFileSync(process.env.LILO_STRESS_OUT, saveProject(createProject({ title: "Stress", design: stressDesign(300) })));
  });

  it("writes the numbers", () => {
    console.log(JSON.stringify(out, null, 2));
    if (process.env.LILO_PERF_OUT) writeFileSync(process.env.LILO_PERF_OUT, JSON.stringify(out, null, 2));
  });
});
