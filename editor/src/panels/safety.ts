import {
  checkSafe,
  DEFAULT_FILL_PARAMS,
  DEFAULT_SATIN_PARAMS,
  safeRangeFor,
  SAFE_SLIDER_PARAMS,
  satinWidthOf,
  type Design,
  type DesignObject,
  type SafeCheck,
  type SafeContext,
  type SafeSliderParam,
} from "@lilo/engine/light";

/**
 * The Stitch safety card and the per-object sliders share this: which objects a parameter applies to,
 * what value each one has, how to change it, and whether it sits in the green band. Pure, so it is easy to test.
 */

export interface SliderLimits {
  min: number;
  max: number;
  step: number;
}

/** How far each slider runs (wider than the green band). The same numbers drive the card and the object panel. */
export const SLIDER_LIMITS: Readonly<Record<SafeSliderParam, SliderLimits>> = {
  satinWidth: { min: 0.5, max: 12, step: 0.1 },
  satinDensity: { min: 0.2, max: 1.5, step: 0.01 },
  fillRowSpacing: { min: 0.2, max: 2, step: 0.05 },
  fillStitchLength: { min: 1, max: 8, step: 0.1 },
  runStitchLength: { min: 0.5, max: 8, step: 0.1 },
  pullComp: { min: 0, max: 1, step: 0.05 },
};

export const safeContextOf = (design: Pick<Design, "sewing"> | null | undefined): SafeContext => ({ threadWeight: design?.sewing?.threadWeight, fabric: design?.sewing?.fabric });

type SliderParam = SafeSliderParam;

const isRunSatin = (o: DesignObject): boolean => o.kind === "run" && o.params.type === "satin";
const isPlainRun = (o: DesignObject): boolean => o.kind === "run" && ((o.params.type ?? (o.params.repeats === 3 ? "triple" : "single")) === "single" || o.params.type === "triple");

/** The value of `param` on `o`, or null when the parameter does not apply to that object. */
export function safeValueOf(o: DesignObject, param: SliderParam): number | null {
  switch (param) {
    case "satinWidth":
      return satinWidthOf(o);
    case "satinDensity":
      if (o.kind === "satin") return o.params.densityMm;
      return isRunSatin(o) && o.kind === "run" ? o.params.satin?.densityMm ?? DEFAULT_SATIN_PARAMS.densityMm : null;
    case "pullComp":
      if (o.kind === "satin") return o.params.pullCompMm;
      if (o.kind === "fill") return o.params.pullCompMm ?? DEFAULT_FILL_PARAMS.pullCompMm;
      return isRunSatin(o) && o.kind === "run" ? o.params.satin?.pullCompMm ?? DEFAULT_SATIN_PARAMS.pullCompMm : null;
    case "fillRowSpacing":
      return o.kind === "fill" ? o.params.rowSpacingMm : null;
    case "fillStitchLength":
      return o.kind === "fill" ? o.params.stitchLengthMm : null;
    case "runStitchLength":
      return isPlainRun(o) && o.kind === "run" ? o.params.stitchLengthMm : null;
  }
}

/** Can the card change this parameter on `o`? A satin column's width is its shape, so only run-type satin has a width to set. */
export function safeSettable(o: DesignObject, param: SliderParam): boolean {
  if (o.locked) return false;
  if (param === "satinWidth") return isRunSatin(o);
  return safeValueOf(o, param) !== null;
}

/** Set `param` on `o` (an Immer draft). Does nothing where the parameter does not apply. */
export function setSafeValue(o: DesignObject, param: SliderParam, v: number): void {
  if (!safeSettable(o, param)) return;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const val = round(v);
  switch (param) {
    case "satinWidth":
      if (o.kind === "run") o.params.widthMm = val;
      break;
    case "satinDensity":
      if (o.kind === "satin") o.params.densityMm = val;
      else if (o.kind === "run") o.params.satin = { ...o.params.satin, densityMm: val };
      break;
    case "pullComp":
      if (o.kind === "satin" || o.kind === "fill") o.params.pullCompMm = val;
      else if (o.kind === "run") o.params.satin = { ...o.params.satin, pullCompMm: val };
      break;
    case "fillRowSpacing":
      if (o.kind === "fill") o.params.rowSpacingMm = Math.max(0.1, val);
      break;
    case "fillStitchLength":
      if (o.kind === "fill") o.params.stitchLengthMm = Math.max(0.5, val);
      break;
    case "runStitchLength":
      if (o.kind === "run") o.params.stitchLengthMm = Math.max(0.3, val);
      break;
  }
}

export interface SafeRow {
  param: SliderParam;
  label: string;
  /** Visible objects the parameter applies to. */
  ids: string[];
  /** Objects the card can change (not locked, and not a satin shape's fixed width). */
  settableIds: string[];
  min: number;
  max: number;
  mean: number;
  /** The status of the object furthest outside the green band (or ok). */
  check: SafeCheck;
  /** How many objects are outside the green band. */
  outside: number;
  /** The ids of the objects outside it. */
  outsideIds: string[];
}

const ROW_LABEL: Record<SliderParam, string> = {
  satinWidth: "Satin width",
  satinDensity: "Satin spacing",
  fillRowSpacing: "Fill row spacing",
  fillStitchLength: "Fill stitch length",
  runStitchLength: "Running stitch length",
  pullComp: "Pull compensation",
};

/** One row per parameter the design uses, in a fixed order. */
export function safetyRows(design: Design | null): SafeRow[] {
  if (!design) return [];
  const ctx = safeContextOf(design);
  const visible = design.objects.filter((o) => o.visible !== false);
  const rows: SafeRow[] = [];
  for (const param of SAFE_SLIDER_PARAMS as readonly SliderParam[]) {
    const items = visible.flatMap((o) => {
      const v = safeValueOf(o, param);
      return v === null ? [] : [{ o, v }];
    });
    if (items.length === 0) continue;
    const values = items.map((i) => i.v);
    const r = safeRangeFor(param, ctx);
    const gap = (v: number) => (r.min !== null && v < r.min ? r.min - v : r.max !== null && v > r.max ? v - r.max : 0);
    const bad = items.flatMap((i) => {
      const c = checkSafe(param, i.v, ctx);
      return c.status === "ok" ? [] : [{ id: i.o.id, gap: gap(i.v), c }];
    });
    // the worst one is the one furthest outside the band
    const worst = bad.length ? bad.reduce((a, b) => (b.gap > a.gap ? b : a)) : null;
    rows.push({
      param,
      label: ROW_LABEL[param],
      ids: items.map((i) => i.o.id),
      settableIds: items.filter((i) => safeSettable(i.o, param)).map((i) => i.o.id),
      min: Math.min(...values),
      max: Math.max(...values),
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      check: worst ? worst.c : { status: "ok", reason: "" },
      outside: bad.length,
      outsideIds: bad.map((b) => b.id),
    });
  }
  return rows;
}

/**
 * Plain sentences for the Send and Export windows: every amber row. Satin width is left out because the
 * `thin-satin` plan warning already says it.
 */
export function safetyNotes(design: Design | null): string[] {
  return safetyRows(design)
    .filter((r) => r.param !== "satinWidth" && r.check.status !== "ok")
    .map((r) => `${r.label}: ${r.outside === r.ids.length && r.ids.length === 1 ? "" : `${r.outside} of ${r.ids.length} shapes. `}${r.check.reason}`);
}
