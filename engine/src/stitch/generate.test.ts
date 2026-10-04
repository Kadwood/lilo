import { describe, expect, it } from "vitest";
import { DEFAULT_HOOP } from "../model";
import { getCatalogue, toDesignThread } from "../threads";
import { sampleDesign } from "./sample-design";
import { colorBlocks, planStats } from "./plan";
import { designToStitchPlan } from "./generate";
import { validatePlan } from "./validate";

const cat = getCatalogue().threads;
const blue = toDesignThread(cat.find((t) => t.name === "Blue")!);

describe("designToStitchPlan", () => {
  const plan = designToStitchPlan(sampleDesign());
  const stats = planStats(plan);

  it("makes hundreds of stitches, one colour change, no failures", () => {
    expect(plan.warnings).toEqual([]);
    expect(stats.stitchCount).toBeGreaterThan(600);
    expect(stats.colorChanges).toBe(1);
    expect(plan.threads.map((t) => t.name)).toEqual(["Blue", "Red"]);
  });

  it("keeps the fill inside its outline (plus pull comp) and out of the hole", () => {
    const fill = plan.stitches.filter((s) => s.objectIndex === 0 && s.type === "stitch");
    expect(fill.length).toBeGreaterThan(300);
    for (const s of fill) {
      expect(s.x).toBeGreaterThan(-15.5);
      expect(s.x).toBeLessThan(15.5);
      // hole is +-8 x +-4, pulled in to +-7.8 x +-3.8. At the 4 mm default stitch length stitchjs can clip a
      // hole corner by a few tenths of a mm, so the test box is 0.5 mm further in.
      const inHole = s.x > -7.3 && s.x < 7.3 && s.y > -3.3 && s.y < 3.3;
      expect(inHole).toBe(false);
    }
  });

  it("tags colour blocks consistently", () => {
    const blocks = colorBlocks(plan);
    expect(blocks.map((b) => b.threadIndex)).toEqual([0, 1]);
    const cc = plan.stitches.find((s) => s.type === "colorChange")!;
    expect(cc.threadIndex).toBe(1);
  });

  it("is deterministic", () => {
    expect(designToStitchPlan(sampleDesign())).toEqual(plan);
  });

  it("skips hidden objects and reports unknown threads", () => {
    const d = sampleDesign();
    d.objects[0] = { ...d.objects[0], visible: false };
    const p = designToStitchPlan(d);
    expect(p.threads.map((t) => t.name)).toEqual(["Red"]);
    d.objects[1] = { ...d.objects[1], threadId: "nope" };
    expect(designToStitchPlan(d).warnings[0]?.code).toBe("object-failed");
  });
});

describe("validatePlan", () => {
  it("splits long stitches, trims long jumps and passes a sane design", () => {
    const { plan, warnings } = validatePlan(
      {
        threads: [blue],
        warnings: [],
        stitches: [
          { x: 0, y: 0, type: "jump", threadIndex: 0, objectIndex: 0 },
          { x: 0, y: 0, type: "stitch", threadIndex: 0, objectIndex: 0 },
          { x: 30, y: 0, type: "stitch", threadIndex: 0, objectIndex: 0 },
          { x: 30, y: 20, type: "jump", threadIndex: 0, objectIndex: 0 },
          { x: 30, y: 20, type: "stitch", threadIndex: 0, objectIndex: 0 },
          { x: 31, y: 20, type: "jump", threadIndex: 0, objectIndex: 0 },
        ],
      },
      DEFAULT_HOOP,
    );
    expect(warnings.map((w) => w.code)).toEqual(["stitch-too-long"]);
    let prev = plan.stitches[1];
    for (const s of plan.stitches.slice(2)) {
      if (s.type === "stitch") expect(Math.hypot(s.x - prev.x, s.y - prev.y)).toBeLessThanOrEqual(12.0001);
      prev = s;
    }
    expect(plan.stitches.filter((s) => s.type === "trim")).toHaveLength(1);
    expect(plan.stitches.filter((s) => s.type === "jump")).toHaveLength(2); // initial + the 1 mm hop
  });

  it("warns when the design does not fit the hoop and when it is too dense", () => {
    const stitches = [];
    // 12 drops in each of two touching 1 mm cells: a patch of piled-up thread
    for (let i = 0; i < 12; i++) stitches.push({ x: 0.5, y: 0.5, type: "stitch" as const, threadIndex: 0, objectIndex: 0 }, { x: 1.5, y: 0.5, type: "stitch" as const, threadIndex: 0, objectIndex: 0 });
    stitches.push({ x: 200, y: 0.5, type: "jump" as const, threadIndex: 0, objectIndex: 0 });
    stitches.push({ x: 200, y: 0.5, type: "stitch" as const, threadIndex: 0, objectIndex: 0 });
    const { warnings } = validatePlan({ threads: [blue], warnings: [], stitches }, { name: "tiny", widthMm: 100, heightMm: 100 }, { minStitchMm: 0 }); // stacked drops, so don't merge them
    expect(warnings.map((w) => w.code).sort()).toEqual(["density", "outside-hoop"]);
  });

  it("one crossing cell is not a density warning, but a patch or a pile twice the limit is", () => {
    const at = (x: number, n: number) => Array.from({ length: n }, () => ({ x, y: 0.5, type: "stitch" as const, threadIndex: 0, objectIndex: 0 }));
    const run = (stitches: ReturnType<typeof at>) => validatePlan({ threads: [blue], warnings: [], stitches }, DEFAULT_HOOP, { minStitchMm: 0, lockStitchMm: 0 }).warnings.map((w) => w.code);
    expect(run(at(0.5, 13))).not.toContain("density"); // two lines crossing
    expect(run(at(0.5, 21))).toContain("density"); // a pile
    expect(run([...at(0.5, 11), ...at(1.5, 11)])).toContain("density"); // a patch
    expect(run([...at(0.5, 11), ...at(5.5, 11)])).not.toContain("density"); // two separate crossings
  });

  it("warns on an empty plan", () => {
    expect(validatePlan({ threads: [], warnings: [], stitches: [] }, DEFAULT_HOOP).warnings[0].code).toBe("empty");
  });
});
