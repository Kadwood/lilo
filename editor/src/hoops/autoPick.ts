import { useMemo } from "react";
import { useStore } from "zustand";
import {
  DEFAULT_HOOP,
  DEFAULT_SAFE_MARGIN_MM,
  HOOPS,
  HOOP_LIBRARY,
  designBounds,
  findHoopSpec,
  hoopFromSpec,
  normalizeHoop,
  smallestFittingHoop,
  type AutoPick,
  type Design,
  type Hoop,
  type Size,
} from "@lilo/engine/light";
import { useEditor } from "../state/store";
import { hoopStore } from "../state/hoopStore";

/** The design's hoop as the editor reads it: old files (name and size only) are brought up to date on the way. */
export function useHoop(): Hoop {
  const { state } = useEditor();
  const h = state.design?.hoop;
  return useMemo(() => normalizeHoop(h ?? DEFAULT_HOOP), [h]);
}

/** The custom hoops (loaded once by the picker or the first auto-pick). */
export const useCustomHoops = (): Hoop[] => useStore(hoopStore, (s) => s.custom);

/** Size of the visible stitched shapes, or null for an empty design. */
export function designSize(design: Design | null): Size | null {
  if (!design || design.objects.length === 0) return null;
  const b = designBounds(design);
  return b ? { w: b.widthMm, h: b.heightMm } : null;
}

/**
 * The hoops worth suggesting: those of the same machine as the current hoop (a Brother 5 x 7 user is
 * offered Brother hoops, not Bernina ones), the first built-in pair for a hoop that came from nowhere in
 * particular, and always the user's own hoops.
 */
export function candidateHoops(current: Hoop, custom: readonly Hoop[]): Hoop[] {
  const spec = findHoopSpec(current.id);
  const own = custom.map((h) => normalizeHoop(h));
  const family = spec
    ? HOOP_LIBRARY.filter((h) => h.brand === spec.brand && h.machines.some((m) => spec.machines.includes(m)))
    : HOOP_LIBRARY.filter((h) => HOOPS.some((b) => b.name === h.name));
  const pool = family.map(hoopFromSpec);
  // the current hoop is always a candidate (an old file's hoop may be in neither list)
  if (!pool.some((h) => h.id !== undefined && h.id === current.id)) pool.push(current);
  return [...pool, ...own];
}

export const SAFE_MARGIN_MM = DEFAULT_SAFE_MARGIN_MM;

/** What auto-pick says for a design, among `candidateHoops`. Null for an empty design. */
export function pickFor(design: Design | null, current: Hoop, custom: readonly Hoop[]): AutoPick | null {
  const size = designSize(design);
  if (!size) return null;
  return smallestFittingHoop(size, candidateHoops(current, custom));
}

/** Same, but over every hoop in the library: the "Smallest hoop that fits" button's wider net. */
export function pickAnywhere(design: Design | null, custom: readonly Hoop[]): AutoPick | null {
  const size = designSize(design);
  if (!size) return null;
  return smallestFittingHoop(size, [...HOOP_LIBRARY.map(hoopFromSpec), ...custom]);
}
