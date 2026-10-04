import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { autoDigitize, autoDigitizeSvg } from "../src/autodigitize";
import { initVtracerNode } from "../src/node";
import { regionToObjects, DEFAULT_REGION_SETTINGS, type TraceRegion } from "../src/clickstitch";
import { fontHeightRange } from "../src/lettering/font";
import { customTypeface, initLettering, layoutText, loadCustomFont, builtinTypeface } from "../src/lettering";
import { DEFAULT_HOOP, makeIdGen, type Design, type DesignObject } from "../src/model";
import { checkSafe, FABRIC_IDS, safeRangeFor, type SafeSliderParam } from "../src/presets";
import { designToStitchPlan, validatePlan } from "../src/stitch";
import { sampleDesign } from "../src/stitch/sample-design";
import { getCatalogue, toDesignThread } from "../src/threads";
import { FIXTURES } from "./fixtures/fixtures";
import { designOf, FIXTURE_FONTS_DIR, loadBuiltin, ready, thread } from "./lettering-helpers";
import { wordmarkSvg } from "./wordmark";

/**
 * A design made only with Lilo's defaults must raise ZERO amber items: no thin-satin, no long-stitch-snag,
 * no density warning, and every stitch setting inside its safe range. Swept over every quality, thread
 * weight and fabric, through auto-digitize, click-to-stitch, lettering (built-in and custom fonts) and the sample design.
 */

const QUALITIES = ["standard", "premium"] as const;
const WEIGHTS = [40, 60] as const;
const AMBER = ["thin-satin", "long-stitch-snag", "density", "stitch-too-long", "object-failed"];

/** Every stitch setting of every object, checked against the safe range for the design's setup. */
function outOfRange(design: Design): string[] {
  const ctx = { threadWeight: design.sewing?.threadWeight, fabric: design.sewing?.fabric };
  const bad: string[] = [];
  const chk = (o: DesignObject, p: SafeSliderParam, v: number | undefined) => {
    if (v === undefined) return;
    const c = checkSafe(p, v, ctx);
    if (c.status !== "ok") bad.push(`${o.id}/${p}=${v} (${c.status}; ${JSON.stringify(safeRangeFor(p, ctx).min)}..${JSON.stringify(safeRangeFor(p, ctx).max)})`);
  };
  for (const o of design.objects) {
    if (o.kind === "satin") {
      chk(o, "satinDensity", o.params.densityMm);
      chk(o, "pullComp", o.params.pullCompMm);
    } else if (o.kind === "fill") {
      chk(o, "fillRowSpacing", o.params.rowSpacingMm);
      chk(o, "fillStitchLength", o.params.stitchLengthMm);
      chk(o, "pullComp", o.params.pullCompMm);
    } else if (o.kind === "run") {
      if (o.params.type === "satin") {
        chk(o, "satinDensity", o.params.satin?.densityMm);
        chk(o, "pullComp", o.params.satin?.pullCompMm);
        chk(o, "satinWidth", o.params.widthMm);
      } else if (!o.params.type || o.params.type === "single" || o.params.type === "triple") chk(o, "runStitchLength", o.params.stitchLengthMm);
    }
  }
  return bad;
}

function amber(design: Design): string[] {
  const { warnings, plan } = validatePlan(designToStitchPlan(design), design.hoop, { quality: design.sewing?.quality, design });
  void plan;
  return [...warnings.filter((w) => AMBER.includes(w.code)).map((w) => `${w.code}: ${w.message}`), ...outOfRange(design)];
}

beforeAll(async () => {
  await ready();
  await initVtracerNode();
  await initLettering();
});

const combos = QUALITIES.flatMap((quality) => WEIGHTS.flatMap((threadWeight) => FABRIC_IDS.map((fabric) => ({ quality, threadWeight, fabric }))));
const label = (c: (typeof combos)[number]) => `${c.quality} ${c.threadWeight}wt ${c.fabric}`;

describe("defaults are safe: no amber items", () => {
  describe("auto-digitize (sample images and an SVG wordmark)", () => {
    for (const c of combos) {
      it(label(c), async () => {
        for (const f of FIXTURES) {
          const { design } = await autoDigitize(f.make(), c);
          expect(amber(design), `${f.name} @ ${label(c)}`).toEqual([]);
        }
        const { design } = await autoDigitizeSvg(wordmarkSvg("DOVE"), { widthMm: 80, ...c });
        expect(amber(design), `DOVE @ ${label(c)}`).toEqual([]);
      }, 120_000);
    }
  });

  describe("lettering (built-in and custom fonts)", () => {
    const fonts = ["Lato-Regular.ttf", "PlayfairDisplay-VF.ttf", "PTSerif-Regular.ttf"];
    const buf = (n: string): ArrayBuffer => {
      const b = readFileSync(`${FIXTURE_FONTS_DIR}/${n}`);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    };
    // lettering does not depend on the fabric, so lay the text out once per quality and thread weight and check it on every fabric
    for (const quality of QUALITIES) {
      for (const threadWeight of WEIGHTS) {
        it(`${quality} ${threadWeight}wt, every fabric`, () => {
          const t = thread();
          const faces = [
            ...["geneva_simple", "pacificlo"].map((id) => {
              const r = fontHeightRange(loadBuiltin(id));
              return { name: id, face: builtinTypeface(loadBuiltin(id)), heights: [Math.ceil(r.minMm), Math.floor(r.maxMm)] };
            }),
            ...fonts.map((n) => ({ name: n, face: customTypeface(loadCustomFont(buf(n))), heights: [8, 20] })),
          ];
          for (const { name, face, heights } of faces) {
            for (const heightMm of heights) {
              const r = layoutText("Erin Kadwood", face, { heightMm, threadId: t.id, sewing: { quality, threadWeight } });
              for (const fabric of FABRIC_IDS) {
                const c = { quality, threadWeight, fabric };
                const design = designOf(r.objects, [t]);
                design.sewing = c;
                expect(amber(design), `${name} ${heightMm} mm @ ${label(c)}`).toEqual([]);
              }
            }
          }
        }, 300_000);
      }
    }
  });

  describe("click-to-stitch and the sample design", () => {
    it("a clicked region uses defaults inside the safe range", () => {
      const region: TraceRegion = { id: "r1", shell: [[0, 0], [30, 0], [30, 20], [0, 20]], holes: [], thread: toDesignThread(getCatalogue().threads[0]) } as never;
      for (const style of ["fill", "outline"] as const) {
        const { objects, thread: th } = regionToObjects(region, { ...DEFAULT_REGION_SETTINGS, style }, makeIdGen(designOf([], [])));
        for (const c of combos) {
          const design = designOf(objects, [th]);
          design.hoop = DEFAULT_HOOP;
          design.sewing = c;
          expect(amber(design), `${style} @ ${label(c)}`).toEqual([]);
        }
      }
    });
    it("the sample design", () => {
      for (const c of combos) {
        const d = sampleDesign();
        d.sewing = c;
        expect(amber(d), label(c)).toEqual([]);
      }
    });
  });
});
