import type { Design } from "@lilo/engine/light";
import type { PlanResult } from "../engine/client";
import type { WorkflowStepId } from "./data";

/** What the five-step strip reads. Everything but `previewed` and `exported` comes from the design and its plan. */
export interface StripInput {
  design: Design | null;
  planResult: PlanResult | null;
  previewed: boolean;
  exported: boolean;
}

/** Plan warnings that mean "the stitches have a quality problem" (outside-hoop belongs to step 2). */
export const QUALITY_WARNING_CODES = ["density", "stitch-too-long", "object-failed", "empty"] as const;

/**
 * Which steps are done, from real state:
 * 1. the canvas has objects,
 * 2. the stitched design fits the hoop (no `outside-hoop` warning from `validatePlan`),
 * 3. `validatePlan` found no quality warnings,
 * 4. the player was played or the realistic view was used,
 * 5. the design was exported or sent.
 */
export function workflowTicks(i: StripInput): Record<WorkflowStepId, boolean> {
  const has = !!i.design && i.design.objects.length > 0;
  const planned = has && !!i.planResult && i.planResult.stats.stitchCount > 0;
  const codes = new Set((i.planResult?.warnings ?? []).map((w) => w.code));
  return {
    design: has,
    size: planned && !codes.has("outside-hoop"),
    stitches: planned && QUALITY_WARNING_CODES.every((c) => !codes.has(c)),
    preview: has && i.previewed,
    send: has && i.exported,
  };
}

/** The first step that is not done yet (the one to point at), or null when all five are. */
export function currentStep(ticks: Record<WorkflowStepId, boolean>, order: readonly WorkflowStepId[]): WorkflowStepId | null {
  return order.find((id) => !ticks[id]) ?? null;
}
