import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILL_PARAMS,
  DEFAULT_HOOP,
  DEFAULT_RUN_PARAMS,
  FILL_PATTERNS,
  emptyDesign,
  getCatalogue,
  makeFill,
  makeRun,
  rectNodes,
  toDesignThread,
  type Design,
  type DesignObject,
  type Pt,
  type RunType,
} from "../src";
import { designToStitchPlan, validatePlan, MAX_STITCH_MM, MIN_STITCH_MM } from "../src/stitch";

const thread = toDesignThread(getCatalogue().threads.find((t) => t.name === "Blue")!);

function check(o: DesignObject, label: string) {
  const d: Design = { ...emptyDesign({ name: "big", widthMm: 400, heightMm: 400 }), threads: [thread], objects: [o] };
  const { plan } = validatePlan(designToStitchPlan(d), d.hoop);
  let prev: { x: number; y: number } | null = null;
  let short = 0;
  let long = 0;
  let worst = Infinity;
  let worstLong = 0;
  for (const s of plan.stitches) {
    if (s.type === "stitch") {
      if (prev && !s.lock) {
        const len = Math.hypot(s.x - prev.x, s.y - prev.y);
        if (len < MIN_STITCH_MM - 1e-9) {
          short++;
          worst = Math.min(worst, len);
        }
        if (len > MAX_STITCH_MM + 1e-6) {
          long++;
          worstLong = Math.max(worstLong, len);
        }
      }
    }
    // a jump or trim starts a new run: the stitch after it is the run's first needle drop, not a stitch
    prev = s.type === "stitch" ? s : null;
  }
  expect({ label, short, worst: short ? worst : null, long, worstLong: long ? worstLong : null }).toEqual({ label, short: 0, worst: null, long: 0, worstLong: null });
  expect(plan.stitches.filter((s) => s.type === "stitch").length).toBeGreaterThan(5);
}

const shapes: { name: string; make: (id: string) => DesignObject["kind"] extends never ? never : ReturnType<typeof makeFill> }[] = [
  { name: "40x30", make: (id) => makeFill(id, id, thread.id, rectNodes(0, 0, 40, 30)) },
  {
    name: "concave+hole",
    make: (id) => {
      const f = makeFill(id, id, thread.id, [{ p: [0, 0] }, { p: [40, 0] }, { p: [40, 14] }, { p: [18, 14] }, { p: [18, 30] }, { p: [0, 30] }], [[[4, 4], [14, 4], [14, 12], [4, 12]]]);
      return f;
    },
  },
  { name: "150x100", make: (id) => makeFill(id, id, thread.id, rectNodes(0, 0, 150, 100)) },
];

describe("no stitch is shorter than 0.3 mm or longer than 12 mm (lock stitches aside)", () => {
  for (const p of FILL_PATTERNS) {
    for (const sh of shapes) {
      it(`${p.id} on ${sh.name}`, () => {
        const f = sh.make("f");
        check({ ...f, params: { ...DEFAULT_FILL_PARAMS, pattern: p.id, angleDeg: p.defaultAngleDeg } }, `${p.id}/${sh.name}`);
      }, 120_000);
    }
  }

  const path: Pt[] = [[0, 0], [30, 8], [60, -4], [90, 6]];
  for (const type of ["single", "triple", "satin", "estitch", "doublerope", "triplerope", "manual"] as RunType[]) {
    it(`run type ${type}`, () => {
      const manual: Pt[] = [[0, 0], [0.1, 0.05], [1.5, 0.5], [1.55, 0.5], [4, 2], [9, 3]]; // includes deliberately tiny steps
      const run = makeRun("r", "r", thread.id, (type === "manual" ? manual : path).map((p) => ({ p })), false, { ...DEFAULT_RUN_PARAMS, type, widthMm: type === "satin" ? 3 : type === "estitch" ? 3 : undefined });
      check(run, type);
    });
  }
});
