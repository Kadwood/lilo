import {
  DESIGN_VERSION,
  type Design,
  type DesignObject,
  type FillParams,
  type Hoop,
  type Pt,
  type RunParams,
  type SatinParams,
} from "./types";

export * from "./types";
export * from "./patterns";
export * from "./path";
export * from "./transform";
export * from "./edit";

/** Brother NV2700 hoops. */
export const HOOPS: readonly Hoop[] = [
  { name: "NV2700 160 x 260", widthMm: 160, heightMm: 260 },
  { name: "NV2700 130 x 180", widthMm: 130, heightMm: 180 },
];
export const DEFAULT_HOOP: Hoop = HOOPS[0];

export const DEFAULT_FILL_PARAMS: FillParams = {
  angleDeg: 45,
  rowSpacingMm: 0.4,
  stitchLengthMm: 3,
  pullCompMm: 0.2,
  underlay: true,
  edgeRun: true,
};
export const DEFAULT_SATIN_PARAMS: SatinParams = {
  densityMm: 0.4,
  widthMm: 2,
  pullCompMm: 0.15,
  underlay: "center",
};
export const DEFAULT_RUN_PARAMS: RunParams = { stitchLengthMm: 2.5, repeats: 1 };

export function emptyDesign(hoop: Hoop = DEFAULT_HOOP): Design {
  return { version: DESIGN_VERSION, unitsMm: 1, hoop, threads: [], objects: [] };
}

/** Every point of an object's geometry. */
export function objectPoints(o: DesignObject): Pt[] {
  switch (o.kind) {
    case "fill":
      return o.geometry.shell;
    case "satin":
      return o.geometry.strip;
    case "run":
      return o.geometry.path;
  }
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  widthMm: number;
  heightMm: number;
}

/** Bounding box of the visible objects' geometry (fills: shell only). Null when empty. */
export function designBounds(design: Design): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const o of design.objects) {
    if (o.visible === false) continue;
    for (const [x, y] of objectPoints(o)) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, widthMm: maxX - minX, heightMm: maxY - minY };
}

/** Translate every object by (dx, dy) mm. Returns a new design. */
export function translateDesign(design: Design, dx: number, dy: number): Design {
  const mv = (p: Pt): Pt => [p[0] + dx, p[1] + dy];
  return {
    ...design,
    objects: design.objects.map((o): DesignObject => {
      switch (o.kind) {
        case "fill":
          return { ...o, geometry: { shell: o.geometry.shell.map(mv), holes: o.geometry.holes.map((h) => h.map(mv)) } };
        case "satin":
          return { ...o, geometry: { strip: o.geometry.strip.map(mv) } };
        case "run":
          return { ...o, geometry: { ...o.geometry, path: o.geometry.path.map(mv) } };
      }
    }),
  };
}

/**
 * Structural checks a design must pass before stitching. Returns human-readable problems
 * (empty = valid).
 */
export function validateDesign(design: Design): string[] {
  const problems: string[] = [];
  if (design.version !== DESIGN_VERSION) problems.push(`Unsupported design version ${String(design.version)}`);
  const threadIds = new Set<string>();
  for (const t of design.threads) {
    if (threadIds.has(t.id)) problems.push(`Duplicate thread id ${t.id}`);
    threadIds.add(t.id);
    if (!/^#[0-9a-fA-F]{6}$/.test(t.hex)) problems.push(`Thread ${t.id} has a bad hex colour`);
  }
  const ids = new Set<string>();
  for (const o of design.objects) {
    if (ids.has(o.id)) problems.push(`Duplicate object id ${o.id}`);
    ids.add(o.id);
    if (!threadIds.has(o.threadId)) problems.push(`Object ${o.id} uses unknown thread ${o.threadId}`);
    const pts = objectPoints(o);
    if (pts.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) problems.push(`Object ${o.id} has non-finite coordinates`);
    if (o.kind === "fill" && o.geometry.shell.length < 3) problems.push(`Fill ${o.id} has fewer than 3 points`);
    if (o.kind === "satin" && (o.geometry.strip.length < 4 || o.geometry.strip.length % 2 !== 0))
      problems.push(`Satin ${o.id} needs an even number (>= 4) of strip points`);
    if (o.kind === "run" && o.geometry.path.length < 2) problems.push(`Run ${o.id} has fewer than 2 points`);
  }
  return problems;
}

export const serializeDesign = (design: Design): string => JSON.stringify(design);

/** Parse a design from JSON text. Throws on unknown versions or structural problems. */
export function parseDesign(json: string): Design {
  const d = JSON.parse(json) as Design;
  if (d.version !== DESIGN_VERSION) throw new Error(`Unsupported design version ${String(d.version)}`);
  const problems = validateDesign(d);
  if (problems.length) throw new Error(`Invalid design: ${problems.join("; ")}`);
  return d;
}
