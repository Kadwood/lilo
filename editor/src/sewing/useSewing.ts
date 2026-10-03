import { useMemo } from "react";
import { normaliseSewing, resolveSewingSetup, type DesignSewing, type SewingSetup } from "@lilo/engine/light";
import { useEditor } from "../state/store";

/**
 * The sewing setup in force: the design's own, or, for a design that has none yet (a blank page, a file
 * from before the setting existed), what the selectors say, which is also what the next Digitize uses.
 */
export function useSewing(): DesignSewing {
  const { state } = useEditor();
  const { design, options } = state;
  return useMemo(
    () => normaliseSewing(design?.sewing ?? { fabric: options.fabric, threadWeight: options.threadWeight, quality: options.quality }),
    [design?.sewing, options.fabric, options.threadWeight, options.quality],
  );
}

/** The resolved setup (labels, needle, stabiliser, checklist, summary) for the one in force. */
export function useResolvedSewing(): SewingSetup {
  const s = useSewing();
  return useMemo(() => resolveSewingSetup(s), [s]);
}

/** "Suiting" from "Suiting (woven wool / blends)", "Shirting" from "Shirting / lining (light woven)". */
export const shortFabric = (label: string): string => label.split(/\s*[(/]/)[0].trim();
