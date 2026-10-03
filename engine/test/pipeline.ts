import { autoDigitize } from "../src/autodigitize";
import { initVtracerNode } from "../src/node";
import { applyOrigin, CENTER_ORIGIN, writePes } from "../src/pes";
import { designToStitchPlan, planStats, validatePlan } from "../src/stitch";
import type { AutoDigitizeOptions, ImageDataLike } from "../src/autodigitize";
import type { Design } from "../src/model";

/** Image -> design -> validated plan -> PES bytes, the whole product path. Shared by tests and the smoke script. */
export async function imageToPes(image: ImageDataLike, options: Partial<AutoDigitizeOptions> = {}, label = "design") {
  await initVtracerNode();
  const result = await autoDigitize(image, options);
  const plan0 = designToStitchPlan(result.design);
  const { plan, warnings } = validatePlan(plan0, result.design.hoop);
  const pes = writePes(applyOrigin(plan, CENTER_ORIGIN), { label });
  return { ...result, plan, warnings, pes, stats: planStats(plan) };
}

export const objectCounts = (d: Design) => ({
  fill: d.objects.filter((o) => o.kind === "fill").length,
  satin: d.objects.filter((o) => o.kind === "satin").length,
  run: d.objects.filter((o) => o.kind === "run").length,
});
