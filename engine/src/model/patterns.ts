/**
 * Metadata for every fill pattern: what it is called, which extra settings it has and what they do.
 * This is data only (no stitchjs, no geometry), so the editor's main thread can read it to build
 * the pattern picker and the settings panel. The generators live in `stitch/fills`.
 */

export interface PatternSetting {
  /** Key in `FillParams.patternParams`. */
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Shown as the tooltip. */
  help: string;
}

export interface PatternInfo {
  id: string;
  label: string;
  /**
   * - rows: parallel rows of stitches that can be bent or broken (supports the spacing gradient)
   * - motif: a small shape repeated on a lattice
   * - path: rings, spirals, rays or flow lines that follow the shape
   */
  family: "rows" | "motif" | "path";
  /** Who defined it: the 24 Ember-documented fills or Lilo's own additions. */
  origin: "ember" | "lilo";
  help: string;
  settings: PatternSetting[];
  /** The gradient setting only applies to row patterns. */
  gradient: boolean;
  /** Pattern has a movable centre. */
  centred?: boolean;
  /** Pattern is steered by guide curves. */
  guided?: boolean;
  /** Stitch angle the picker applies when this pattern is chosen (motifs look best upright). */
  defaultAngleDeg: number;
  /**
   * Does the automatic underlay suit this pattern? Open patterns (motifs, crosshatch...) would show
   * it through the gaps, so they get none unless the user adds underlay passes by hand.
   */
  underlay: boolean;
}

const size = (def: number, label = "Size"): PatternSetting => ({
  key: "size",
  label,
  min: 2,
  max: 20,
  step: 0.5,
  default: def,
  help: "Width of each repeated shape in millimetres.",
});

const rows = (id: string, label: string, help: string, settings: PatternSetting[] = [], origin: PatternInfo["origin"] = "ember", underlay = true): PatternInfo => ({
  id,
  label,
  family: "rows",
  origin,
  help,
  settings,
  gradient: true,
  defaultAngleDeg: 45,
  underlay,
});
const motif = (id: string, label: string, help: string, def: number, origin: PatternInfo["origin"] = "ember", extra: PatternSetting[] = []): PatternInfo => ({
  id,
  label,
  family: "motif",
  origin,
  help,
  settings: [size(def, id === "hexweave" ? "Cell size" : "Size"), ...extra],
  gradient: false,
  defaultAngleDeg: 0,
  underlay: false,
});
const path = (id: string, label: string, help: string, settings: PatternSetting[], extra: Partial<PatternInfo> = {}, origin: PatternInfo["origin"] = "ember"): PatternInfo => ({
  id,
  label,
  family: "path",
  origin,
  help,
  settings,
  gradient: false,
  defaultAngleDeg: 45,
  underlay: true,
  ...extra,
});

const tightness: PatternSetting = { key: "tightness", label: "Tightness", min: 0.5, max: 4, step: 0.1, default: 1, help: "Higher packs the lines closer together." };

/** Every pattern the picker offers, in picker order. 24 from Ember's manual, 12 of our own. */
export const FILL_PATTERNS: readonly PatternInfo[] = [
  rows("tatami", "Tatami", "The classic fill: parallel rows with each row's stitches offset from its neighbours."),
  rows("original", "Original", "Parallel rows with a four-step stagger, giving a softer, less regular texture than tatami."),
  rows("triangle", "Triangle", "Rows that zig-zag in a triangle wave, so stitches form rows of small triangles."),
  rows("waves", "Waves", "Smooth wavy rows.", [
    { key: "steps", label: "Steps", min: 2, max: 12, step: 1, default: 4, help: "Needle points per half wave. More steps make smoother curves." },
    { key: "amplitude", label: "Amplitude", min: 0.2, max: 6, step: 0.1, default: 1, help: "How far each wave swings sideways, in millimetres." },
  ]),
  rows("columns", "Columns", "Rows whose needle points line up, so stitches stack into straight columns."),
  rows("offset-columns", "Offset columns", "Like Columns, but every other row is shifted by half a stitch."),
  motif("hearts-s", "Hearts S", "A lattice of small hearts.", 3.5),
  motif("hearts-m", "Hearts M", "A lattice of medium hearts, each with an inner heart.", 5.5),
  motif("hearts-l", "Hearts L", "A lattice of large hearts with two inner hearts.", 8),
  motif("diamonds-s", "Diamonds S", "A lattice of small diamonds.", 3.5),
  motif("diamonds-m", "Diamonds M", "A lattice of medium diamonds, each with an inner diamond.", 5.5),
  motif("diamonds-l", "Diamonds L", "A lattice of large diamonds with two inner diamonds.", 8),
  rows("zigzag", "Zig-zag", "Rows of zig-zag stitches that swing across a band, like a wide satin.", [
    { key: "width", label: "Band width", min: 0.8, max: 8, step: 0.1, default: 2.5, help: "How wide each zig-zag band is." },
  ]),
  motif("circles-s", "Circles S", "A lattice of small circles.", 3.5),
  motif("circles-m", "Circles M", "A lattice of medium circles with an inner ring.", 5.5),
  motif("circles-l", "Circles L", "A lattice of large circles with two inner rings.", 8),
  rows("heartbeat", "Heartbeat", "Rows that run flat and then spike like a heart monitor.", [
    { key: "intensity", label: "Intensity", min: 1, max: 5, step: 0.5, default: 2.5, help: "How tall the spikes are." },
  ]),
  path("spiral", "Spiral", "One or more arms spiralling out from the centre.", [
    tightness,
    { key: "rotations", label: "Arms", min: 1, max: 6, step: 1, default: 1, help: "How many spiral arms wind out from the centre." },
  ], { centred: true }),
  rows("staircase", "Staircase", "Rows that climb in steps.", [
    { key: "stepHeight", label: "Step height", min: 0.2, max: 4, step: 0.1, default: 1, help: "How far each step climbs, in millimetres." },
    { key: "steps", label: "Steps", min: 1, max: 8, step: 1, default: 2, help: "Stitches along each tread before the next riser." },
  ]),
  rows("rainfall", "Rainfall", "Randomly staggered, randomly sized stitches, like rain streaks.", [
    { key: "chaos", label: "Chaos", min: 0, max: 1, step: 0.05, default: 0.5, help: "How much stitch lengths and starts vary." },
    { key: "density", label: "Density", min: 0.4, max: 2, step: 0.1, default: 1, help: "Higher packs the rows closer together." },
  ]),
  motif("hexweave", "Hexweave", "A lattice of hexagons, each with three spokes so it reads as woven cubes.", 6),
  path("tornado", "Tornado", "Curved lines swirling out from the centre.", [
    tightness,
    { key: "rotations", label: "Rotations", min: 0.25, max: 4, step: 0.25, default: 1, help: "How many full turns each line makes on its way out." },
  ], { centred: true }),
  path("streamlines", "Streamlines", "Flow lines that follow the stitch angle, and bend toward any guide curves you draw.", [
    { key: "separation", label: "Separation", min: 0.25, max: 3, step: 0.05, default: 0.5, help: "Distance between neighbouring flow lines, in millimetres." },
  ], { guided: true }),
  path("circular", "Circular", "Concentric rings around a centre you can move.", [], { centred: true }),

  motif("brick", "Brick", "Brick wall outlines: rectangles with every other row offset.", 5, "lilo"),
  motif("herringbone", "Herringbone", "Diagonal strokes that alternate direction column by column.", 4, "lilo"),
  motif("basketweave", "Basketweave", "Square blocks of three parallel lines, alternating across and down.", 6, "lilo"),
  motif("scales", "Scales", "Overlapping fish scale arcs.", 5, "lilo"),
  motif("stars", "Stars", "A lattice of five-point stars.", 5, "lilo"),
  motif("chevrons", "Chevrons", "Stacked V shapes that join into zig-zag lines.", 4, "lilo"),
  rows("crosshatch", "Crosshatch", "Two sets of thin lines crossing at right angles.", [
    { key: "pitch", label: "Line pitch", min: 0.6, max: 6, step: 0.1, default: 1.4, help: "Distance between the lines in each direction." },
  ], "lilo", false),
  path("sunburst", "Sunburst", "Straight rays fanning out from the centre.", [
    { key: "pitch", label: "Ray pitch", min: 0.4, max: 5, step: 0.1, default: 1.2, help: "Distance between neighbouring rays at the outer edge." },
  ], { centred: true, underlay: false }, "lilo"),
  path("contour", "Contour", "Echoes of the shape's outline, stepping inward to the middle.", [
    { key: "pitch", label: "Ring pitch", min: 0.3, max: 4, step: 0.1, default: 0.6, help: "Distance between each ring and the next." },
  ], {}, "lilo"),
  path("stipple", "Stipple", "A random scribble of short stitches joined into a mesh.", [
    { key: "pitch", label: "Dot spacing", min: 0.8, max: 5, step: 0.1, default: 1.8, help: "Average distance between dots." },
  ], { underlay: false }, "lilo"),
  motif("honeycomb", "Honeycomb", "Hexagon outlines sharing their edges.", 5, "lilo"),
  rows("plaid", "Plaid", "Bands of three tight lines, crossing at right angles with open gaps.", [
    { key: "pitch", label: "Band pitch", min: 2, max: 12, step: 0.5, default: 4, help: "Distance from one band to the next." },
  ], "lilo", false),
];

export const FILL_PATTERN_IDS: readonly string[] = FILL_PATTERNS.map((p) => p.id);

export const DEFAULT_FILL_PATTERN = "tatami";

export function patternInfo(id: string | undefined): PatternInfo {
  return FILL_PATTERNS.find((p) => p.id === (id ?? DEFAULT_FILL_PATTERN)) ?? FILL_PATTERNS[0];
}

/** A pattern's setting value: the object's override, else the default. */
export function patternValue(id: string | undefined, params: Record<string, number> | undefined, key: string): number {
  const s = patternInfo(id).settings.find((x) => x.key === key);
  const v = params?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : (s?.default ?? 0);
}
