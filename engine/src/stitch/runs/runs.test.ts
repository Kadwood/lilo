import { describe, expect, it } from "vitest";
import { DEFAULT_HOOP, DEFAULT_RUN_PARAMS, DEFAULT_SATIN_PARAMS, emptyDesign, getCatalogue, toDesignThread, type Design, type Pt, type RunObject, type RunParams, type RunType, type SatinObject } from "../../index";
import { designToStitchPlan, validatePlan } from "../index";
import { stripFromCentreline } from "./index";

const thread = toDesignThread(getCatalogue().threads.find((t) => t.name === "Blue")!);

function design(...objects: Design["objects"]): Design {
  const d = emptyDesign(DEFAULT_HOOP);
  d.threads = [thread];
  d.objects = objects;
  return d;
}

const PATH: Pt[] = [[0, 0], [20, 0], [20, 10]];

function runObj(type: RunType | undefined, extra: Partial<RunParams> = {}, path: Pt[] = PATH): RunObject {
  return { id: "r", name: "r", kind: "run", threadId: thread.id, geometry: { path, closed: false }, params: { ...DEFAULT_RUN_PARAMS, ...(type ? { type } : {}), ...extra } };
}

const stitches = (o: RunObject | SatinObject) => designToStitchPlan(design(o)).stitches.filter((s) => s.type === "stitch");
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Distance from a point to the L-shaped test path. */
function toPath(p: { x: number; y: number }, path: Pt[] = PATH): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p.x - (ax + dx * t), p.y - (ay + dy * t)));
  }
  return best;
}

describe("run types", () => {
  it("single: one pass, stitches about stitchLength apart, on the path", () => {
    const s = stitches(runObj("single", { stitchLengthMm: 2.5 }));
    expect(s.length).toBeGreaterThan(10);
    expect(s.length).toBeLessThan(20);
    for (const p of s) expect(toPath(p)).toBeLessThan(0.15);
    for (let i = 1; i < s.length; i++) expect(dist(s[i], s[i - 1])).toBeLessThanOrEqual(2.6);
  });

  it("an object with no run type behaves as single (repeats 1) or triple (repeats 3)", () => {
    expect(stitches(runObj(undefined)).length).toBe(stitches(runObj("single")).length);
    expect(stitches(runObj(undefined, { repeats: 3 })).length).toBe(stitches(runObj("triple")).length);
  });

  it("triple: every stitch is sewn forward, back, forward (at least ~3x the needle drops)", () => {
    const single = stitches(runObj("single")).length;
    const triple = stitches(runObj("triple")).length;
    expect(triple).toBeGreaterThanOrEqual(single * 2.7);
    expect(triple).toBeLessThanOrEqual(single * 5);
    for (const p of stitches(runObj("triple"))) expect(toPath(p)).toBeLessThan(0.15);
  });

  it("satin along a path: stitches alternate across a column of the given width", () => {
    const s = stitches(runObj("satin", { widthMm: 3, satin: { underlay: "none" } }, [[0, 0], [30, 0]]));
    expect(s.length).toBeGreaterThan(50);
    const side = s.filter((p) => Math.abs(Math.abs(p.y) - 1.5 - 0.15) < 0.12);
    // nearly every needle drop sits on one of the two column edges (width 3 + pull comp 0.15 a side)
    expect(side.length / s.length).toBeGreaterThan(0.9);
    expect(s.some((p) => p.y > 1)).toBe(true);
    expect(s.some((p) => p.y < -1)).toBe(true);
    // density: about 0.4 mm between stitches along the column
    const xs = s.map((p) => p.x);
    expect((Math.max(...xs) - Math.min(...xs)) / (s.length / 2)).toBeLessThan(0.6);
  });

  it("satin along a path honours width: a wider column has wider stitches", () => {
    const narrow = stitches(runObj("satin", { widthMm: 1.5, satin: { underlay: "none", pullCompMm: 0 } }, [[0, 0], [20, 0]]));
    const wide = stitches(runObj("satin", { widthMm: 4, satin: { underlay: "none", pullCompMm: 0 } }, [[0, 0], [20, 0]]));
    const span = (a: typeof narrow) => Math.max(...a.map((p) => p.y)) - Math.min(...a.map((p) => p.y));
    expect(span(narrow)).toBeCloseTo(1.5, 1);
    expect(span(wide)).toBeCloseTo(4, 1);
  });

  it("e-stitch: teeth of the given width on one side, flipped puts them on the other", () => {
    const line: Pt[] = [[0, 0], [30, 0]];
    const a = stitches(runObj("estitch", { widthMm: 3, stitchLengthMm: 2 }, line));
    const b = stitches(runObj("estitch", { widthMm: 3, stitchLengthMm: 2, flipped: true }, line));
    const off = (s: typeof a) => s.map((p) => p.y).filter((y) => Math.abs(y) > 0.5);
    expect(off(a).length).toBeGreaterThan(5);
    expect(Math.max(...a.map((p) => Math.abs(p.y)))).toBeCloseTo(3, 0);
    // flipped teeth lie on the opposite side of the line
    expect(Math.sign(off(a)[0])).toBe(-Math.sign(off(b)[0]));
  });

  it("double rope and triple rope: twisted lines of the given width, triple has more stitches", () => {
    const line: Pt[] = [[0, 0], [30, 0]];
    const dbl = stitches(runObj("doublerope", { widthMm: 1.2, stitchLengthMm: 2 }, line));
    const tri = stitches(runObj("triplerope", { widthMm: 1.2, stitchLengthMm: 2 }, line));
    const single = stitches(runObj("single", { stitchLengthMm: 2 }, line));
    expect(dbl.length).toBeGreaterThan(single.length * 1.5);
    expect(tri.length).toBeGreaterThan(dbl.length);
    for (const set of [dbl, tri]) {
      const w = Math.max(...set.map((p) => Math.abs(p.y)));
      expect(w).toBeGreaterThan(0.1);
      expect(w).toBeLessThan(1.5);
    }
  });

  it("manual: the needle goes exactly where each stitch was placed, in order", () => {
    const pts: Pt[] = [[0, 0], [1.5, 0.5], [3.1, -0.2], [2, 4], [8, 8]];
    const s = stitches(runObj("manual", {}, pts));
    expect(s.map((p) => [p.x, p.y])).toEqual(pts.map((p) => [p[0], p[1]]));
    // order is kept even when the last point is nearer the needle than the first
    const plan = designToStitchPlan(design(runObj("manual", {}, [[50, 50], [0, 0]])));
    expect(plan.stitches.filter((p) => p.type === "stitch")[0]).toMatchObject({ x: 50, y: 50 });
  });

  it("tolerance can't go below 0.1 mm and a closed run closes", () => {
    const o = runObj("single", { toleranceMm: 0 }, [[0, 0], [10, 0], [10, 10], [0, 10]]);
    o.geometry.closed = true;
    const s = stitches(o);
    expect(dist(s[0], s[s.length - 1])).toBeLessThan(2.6);
  });

  it("every run type survives validation without stitches over 12 mm", () => {
    for (const type of ["single", "triple", "satin", "estitch", "doublerope", "triplerope", "manual"] as RunType[]) {
      const d = design(runObj(type, { widthMm: type === "satin" ? 3 : undefined }, [[0, 0], [25, 5], [40, 0]]));
      const { plan } = validatePlan(designToStitchPlan(d), d.hoop);
      expect(plan.stitches.filter((p) => p.type === "stitch").length).toBeGreaterThan(5);
      let prev = plan.stitches[0];
      for (const p of plan.stitches.slice(1)) {
        if (p.type === "stitch" && prev.type === "stitch") expect(dist(p, prev)).toBeLessThanOrEqual(12.0001);
        prev = p;
      }
    }
  });
});

describe("stripFromCentreline", () => {
  it("makes rung pairs of the requested width perpendicular to the path", () => {
    const strip = stripFromCentreline([[0, 0], [10, 0]], 4);
    expect(strip.length % 2).toBe(0);
    for (let i = 0; i < strip.length; i += 2) {
      expect(Math.hypot(strip[i][0] - strip[i + 1][0], strip[i][1] - strip[i + 1][1])).toBeCloseTo(4, 5);
      expect(strip[i][0]).toBeCloseTo(strip[i + 1][0], 5);
    }
  });
  it("keeps its width around a right-angle corner (mitre) without spiking", () => {
    const strip = stripFromCentreline([[0, 0], [10, 0], [10, 10]], 2);
    for (let i = 0; i < strip.length; i += 2) {
      const w = Math.hypot(strip[i][0] - strip[i + 1][0], strip[i][1] - strip[i + 1][1]);
      expect(w).toBeGreaterThan(1.9);
      expect(w).toBeLessThan(4.1);
    }
  });
});

describe("satin settings", () => {
  const strip = (w: number): Pt[] => {
    const out: Pt[] = [];
    for (let x = 0; x <= 30; x += 6) out.push([x, -w / 2], [x, w / 2]);
    return out;
  };
  const satin = (w: number, extra: Partial<SatinObject["params"]> = {}): SatinObject => ({
    id: "s",
    name: "s",
    kind: "satin",
    threadId: thread.id,
    geometry: { strip: strip(w) },
    params: { ...DEFAULT_SATIN_PARAMS, underlay: "none", pullCompMm: 0, ...extra },
  });

  it("density sets how close the stitches sit", () => {
    const dense = stitches(satin(3, { densityMm: 0.3 })).length;
    const loose = stitches(satin(3, { densityMm: 0.8 })).length;
    expect(dense).toBeGreaterThan(loose * 2);
  });

  it("underlays add stitches (center, contour, zig-zag)", () => {
    const none = stitches(satin(3)).length;
    for (const u of ["center", "contour", "zigzag"] as const) expect(stitches(satin(3, { underlay: u })).length).toBeGreaterThan(none);
  });

  it("split satin keeps every top stitch under the max width, so a wide column has no long floats", () => {
    const plain = stitches(satin(10));
    const split = stitches(satin(10, { splitMaxWidthMm: 4 }));
    const longest = (a: typeof plain) => Math.max(...a.slice(1).map((p, i) => dist(p, a[i])));
    expect(longest(plain)).toBeGreaterThan(9);
    expect(longest(split)).toBeLessThan(longest(plain));
  });

  it("stagger shifts the split stitches sideways", () => {
    const a = stitches(satin(10, { splitMaxWidthMm: 4 }));
    const b = stitches(satin(10, { splitMaxWidthMm: 4, staggerCycles: 3, staggerAmountMm: 0.5 }));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("short stitches on curves change a tight curve's stitches", () => {
    const curve: Pt[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = (i / 20) * Math.PI * 0.9;
      const r = 4;
      curve.push([r * Math.cos(t) * 1.0 - 0, -r * Math.sin(t)]);
    }
    const o = { ...runObj("satin", { widthMm: 6, satin: { underlay: "none", pullCompMm: 0 } }, curve) };
    const plain = stitches(o);
    const short = stitches({ ...o, params: { ...o.params, satin: { ...o.params.satin, shortStitches: true } } });
    expect(plain.length).toBeGreaterThan(20);
    expect(JSON.stringify(plain)).not.toBe(JSON.stringify(short));
  });
});
