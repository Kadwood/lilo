/**
 * Applying a sewing setup to a design that already exists: the fabric, thread weight and quality of
 * `Design.sewing`, and the "Before you sew" numbers that follow from them.
 *
 * Auto-generated objects carry `autoParams`: the values the setup gave them. Changing the setup re-applies
 * the new values to exactly those keys that still equal their snapshot, and leaves any key the user
 * has since edited alone (and forgets it, so it stays theirs). Objects without `autoParams` (drawn by
 * hand, typed text, click-to-stitch) are never touched.
 */
import { satinParamsFor } from "../autodigitize/profile";
import { DEFAULT_FILL_PARAMS, type Design, type DesignObject, type DesignSewing } from "../model";
import { canonicalFabric, DEFAULT_SEWING_SETUP, FABRICS, resolveSewingSetup, type FabricInput, type Quality, type SewingEngineParams, type SewingSetupInput, type ThreadWeight } from "./sewing";

/** Fill settings a setup controls (the rest of a fill is the user's). */
const FILL_KEYS = ["rowSpacingMm", "stitchLengthMm", "pullCompMm", "underlay", "underlays", "edgeWalk", "edgeRun"] as const;

/** The setup a design is sewn with (the defaults for a design that has none). */
export function sewingOf(design: Pick<Design, "sewing"> | null | undefined): DesignSewing {
  const s = design?.sewing;
  return normaliseSewing(s ?? {});
}

/** Any partial setup as the plain, complete form that is stored. */
export function normaliseSewing(input: SewingSetupInput | Partial<DesignSewing>): DesignSewing {
  const fabric = canonicalFabric((input.fabric ?? DEFAULT_SEWING_SETUP.fabric) as FabricInput);
  const threadWeight: ThreadWeight = input.threadWeight === 60 ? 60 : 40;
  const quality: Quality = input.quality === "premium" ? "premium" : "standard";
  return { fabric: fabric in FABRICS ? fabric : "suiting", threadWeight, quality };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The values a setup gives one object, or null for a kind it does not control. */
export function presetParamsFor(o: DesignObject, sew: SewingEngineParams): Record<string, unknown> | null {
  if (o.kind === "satin") {
    const { widthMm: _w, ...rest } = satinParamsFor(o.params.widthMm, sew);
    void _w;
    return rest as Record<string, unknown>;
  }
  if (o.kind === "fill") {
    const merged: Record<string, unknown> = { ...DEFAULT_FILL_PARAMS, ...sew.fill };
    const out: Record<string, unknown> = {};
    for (const k of FILL_KEYS) if (merged[k] !== undefined) out[k] = merged[k];
    return out;
  }
  return null;
}

const clean = (r: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined));

/**
 * Record, on every shape the auto-digitizer made, the values the setup gave it, and store the setup on
 * the design. Call right after generation.
 */
export function markAutoParams(design: Design, setup: SewingSetupInput): Design {
  const sewing = normaliseSewing(setup);
  const sew = resolveSewingSetup(sewing).engine;
  return {
    ...design,
    sewing,
    objects: design.objects.map((o) => {
      const t = presetParamsFor(o, sew);
      return t ? { ...o, autoParams: clean(t) } : o;
    }),
  };
}

export interface ApplyResult {
  /** Objects whose values were re-applied. */
  updated: number;
  /** Individual values left alone because the user had edited them. */
  kept: number;
}

/**
 * Change the setup of `design` in place (pass an Immer draft or a clone). Returns how many objects were
 * updated and how many hand-edited values were kept.
 */
export function applySewingSetupTo(design: Design, next: SewingSetupInput): ApplyResult {
  const sewing = normaliseSewing(next);
  const sew = resolveSewingSetup(sewing).engine;
  design.sewing = sewing;
  let updated = 0;
  let kept = 0;
  for (const o of design.objects) {
    if (!o.autoParams) continue;
    const target = presetParamsFor(o, sew);
    if (!target) continue;
    const before = o.autoParams;
    const params = o.params as unknown as Record<string, unknown>;
    const snapshot: Record<string, unknown> = {};
    let touched = false;
    for (const k of new Set([...Object.keys(before), ...Object.keys(target)])) {
      const now = target[k];
      if (!same(params[k], before[k])) {
        // the user changed this one: it is theirs from now on. (A key that is no longer in the snapshot was
        // already given up on an earlier change; it stays theirs without being counted again.)
        if (k in before) kept++;
        continue;
      }
      if (now === undefined) delete params[k];
      else params[k] = JSON.parse(JSON.stringify(now));
      if (now !== undefined) snapshot[k] = JSON.parse(JSON.stringify(now));
      if (!same(now, before[k])) touched = true;
    }
    o.autoParams = snapshot;
    if (touched) updated++;
  }
  return { updated, kept };
}

/** How many auto-generated objects a setup change could affect. */
export const autoObjectCount = (design: Design): number => design.objects.filter((o) => o.autoParams).length;

export interface SewingSpeed {
  /** Stitches per minute: a sensible range for a first sew-out. */
  minSpm: number;
  maxSpm: number;
  /** The figure the time estimate in "Before you sew" uses. */
  estimateSpm: number;
  note: string;
}

/**
 * A sewing-speed range by fabric and thread. Practitioner rules of thumb, UNVERIFIED (no machine
 * maker publishes a per-fabric table): slower on heavy or fragile cloth, finer thread and leather.
 */
export function recommendedSpeed(fabricInput: FabricInput, threadWeight: ThreadWeight): SewingSpeed {
  const fabric = canonicalFabric(fabricInput);
  const base: Record<string, [number, number, string]> = {
    suiting: [600, 800, "Wool holds well; stay in the middle of the range for fine serifs."],
    shirting: [500, 700, "Thin cloth puckers when pushed; keep it gentle."],
    twill: [650, 850, "Stable cloth: most machines are happy near the top of the range."],
    knit: [500, 700, "Stretch cloth moves under the needle; slow and steady."],
    denim: [550, 750, "Thick seams: slow down over them."],
    towel: [500, 700, "Pile and topping: slower keeps the stitches from sinking."],
    leather: [400, 600, "Every hole is permanent: go slow and test first."],
  };
  const [lo, hi, note] = base[fabric];
  const f = threadWeight === 60 ? 0.85 : 1;
  const minSpm = Math.round((lo * f) / 50) * 50;
  const maxSpm = Math.round((hi * f) / 50) * 50;
  return { minSpm, maxSpm, estimateSpm: Math.round((minSpm + maxSpm) / 100) * 50, note };
}
