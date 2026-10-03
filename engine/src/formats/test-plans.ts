import { applyOrigin, CENTER_ORIGIN } from "../pes";
import { designToStitchPlan, validatePlan, type StitchPlan } from "../stitch";
import { sampleDesign } from "../stitch/sample-design";
import { DEFAULT_RUN_PARAMS, emptyDesign, type Design } from "../model";
import { getCatalogue, toDesignThread } from "../threads";

/** The sample design (fill, satin, run, 2 colours) as a validated, centred plan. */
export function samplePlan(): StitchPlan {
  const d = sampleDesign();
  const { plan } = validatePlan(designToStitchPlan(d), d.hoop, { lockStitchMm: 0.4 });
  return applyOrigin(plan, CENTER_ORIGIN);
}

/** Three colours, two far-apart islands (forces trims and long jumps), a >12 mm gap inside one colour. */
export function islandsPlan(): StitchPlan {
  const cat = getCatalogue().threads;
  const t = (name: string) => toDesignThread(cat.find((c) => c.name === name)!);
  const d: Design = emptyDesign();
  d.threads = [t("Blue"), t("Red"), t("Black")];
  const run = (id: string, thread: string, path: [number, number][]) =>
    d.objects.push({ id, name: id, kind: "run", threadId: t(thread).id, geometry: { path, closed: false }, params: { ...DEFAULT_RUN_PARAMS, stitchLengthMm: 2 } });
  run("a", "Blue", [[-40, -20], [-20, -10], [-30, 5]]);
  run("b", "Blue", [[40, 30], [55, 30]]); // far island, same colour: trim + long jump
  run("c", "Red", [[0, 0], [10, 10], [20, 0]]);
  run("d", "Black", [[-60, 40], [-30, 40], [-30, 55]]);
  const { plan } = validatePlan(designToStitchPlan(d), d.hoop, { lockStitchMm: 0 });
  return applyOrigin(plan, CENTER_ORIGIN);
}

