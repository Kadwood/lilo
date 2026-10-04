import type { Design, StitchPlan } from "@lilo/engine/light";

/**
 * How the canvas stacks pictures and stitches. Layers go bottom to top; a run of stitch layers is one "band"
 * of stitches, and a picture layer sits between bands (or under the first or over the last). Because the
 * plan is sewn in layer order, each band is a contiguous slice of `plan.stitches`.
 */
export interface StackLayout {
  /** Plan indices where band 1, 2, ... start (band 0 starts at 0). */
  splits: number[];
  /** Per picture layer id: how many bands are under it (0 = under all the stitches). */
  pictureBand: Record<string, number>;
}

export function stackLayout(design: Design | null, plan: StitchPlan | null): StackLayout {
  const layers = design?.layers ?? [];
  if (!design || layers.length === 0) return { splits: [], pictureBand: {} };
  const bandOfLayer = new Map<string, number>();
  const pictureBand: Record<string, number> = {};
  let bands = 0;
  let prevStitch = false;
  for (const l of layers) {
    if (l.kind === "stitch") {
      if (!prevStitch) bands++;
      bandOfLayer.set(l.id, bands - 1);
      prevStitch = true;
    } else {
      pictureBand[l.id] = bands;
      prevStitch = false;
    }
  }
  const splits: number[] = [];
  const list = plan?.stitches ?? [];
  for (let k = 1; k < bands; k++) {
    let at = list.length;
    for (let i = 0; i < list.length; i++) {
      const oi = list[i].objectIndex;
      const layer = oi >= 0 ? design.objects[oi]?.layerId : undefined;
      if (layer !== undefined && (bandOfLayer.get(layer) ?? 0) >= k) {
        at = i;
        break;
      }
    }
    splits.push(at);
  }
  return { splits, pictureBand };
}
