/**
 * Every stitch default in Lilo, in one place. Other modules import from here; nothing else should
 * hard-code a stitch number.
 *
 * UNITS. Satin "density" / "spacing" is the commercial number: mm between two needle penetrations on
 * the SAME side of the column (Hatch: "Stitch spacing is the distance in millimeters between two needle
 * penetrations on the same side of a shape"; Embird density 4.0 = 0.4 mm). Smaller = denser. It is passed
 * to stitchjs unchanged. A leg crosses the column between the two sides, so 0.40 mm is a leg every
 * 0.2 mm: 2 / density legs per mm (50 per cm), matching Amefird's 125 legs per running inch for
 * 2 to 3 mm satin. Fill "row spacing" is the true distance between rows (measured in stitchjs tatami).
 * Everything else is millimetres.
 *
 * SOURCES, short ids defined in `sewing.ts`: IS-* Ink/Stitch docs and source, EH-* embroideryhooping.com,
 * HS-CHEAT, TD-PULL, MF-60WT, NAA, plus HATCH (Hatch help), AMEFIRD (thread-maker bulletin) and CAL
 * (the sourced calibration table supplied with this change). LEGACY = what Lilo shipped before, kept so
 * output does not move. UNVERIFIED = practice without a source. Recalibrate here and only here.
 */

export const DEFAULTS = {
  satin: {
    /** Standard density, 40 wt. [HATCH][CAL] 0.40; [AMEFIRD] 125 legs/inch = 0.4 same-side. */
    densityMm: 0.4,
    /** Premium by column width, 40 wt. [CAL] 0.38 to 0.42: tighter on medium columns, a little more open on very narrow and very wide. */
    premiumDensityMediumMm: 0.38,
    premiumDensityWideMm: 0.42,
    /** Small text / columns under 1.5 mm. [CAL] 0.45. */
    premiumDensityNarrowMm: 0.45,
    /** Width bands for the premium density ramp (mm): narrow up to `narrowUpToMm`, medium from `mediumFromMm` to `mediumToMm`, wide from `wideFromMm`. UNVERIFIED shape. */
    densityBands: { narrowUpToMm: 1.5, mediumFromMm: 2.5, mediumToMm: 5, wideFromMm: 8 },
    /** Never tighter than this at 40 wt; 60 wt scales it by the thread factor. [CAL] */
    densityFloorMm: 0.35,
    /** Never looser than this after fabric adjustments. [CAL] terry tops out at 0.70. */
    densityCeilMm: 0.7,
    /** Nominal width shown in the UI before a column has real widths. LEGACY. */
    widthMm: 2,
    /** Pull compensation per side, woven. [CAL] 0.15 to 0.20; [TD-PULL]. Standard 0.15, Premium 0.20. */
    pullCompMm: 0.15,
    premiumPullCompMm: 0.2,
    /** Underlay for a hand-drawn column. [IS-SATIN] centre walk is "all you need for thin columns". */
    underlay: "center" as const,
    /** Underlay type by width (mm). [CAL] <2.5 centre walk; 2.5 to 4 centre + edge; 4 to 6 edge + zig-zag; >6 double zig-zag. */
    underlayBands: { centreBelowMm: 2.5, centreEdgeBelowMm: 4, edgeZigzagBelowMm: 6 },
    /** Premium: hairline satin below this gets no underlay (no room for a walk, and crossings knot). UNVERIFIED. */
    premiumNoUnderlayBelowMm: 1.2,
    /** Underlay stitch length. [CAL] 2 to 3. */
    underlayStitchMm: 2.5,
    /** Zig-zag underlay peak-to-peak spacing, mm: single zig-zag (edge+zigzag band) and the wider first pass of a double zig-zag (the second pass is half). [IS-SRC] 3 mm default; [CAL] "zigzag" bands; 2.5 UNVERIFIED tightening for 4-6 mm columns. */
    zigzagSpacingMm: 2.5,
    doubleZigzagSpacingMm: 3,
    /** Edge-walk inset. [CAL] 0.35 standard, 0.4 premium (0.6 to 0.7 on tight curves: not modelled). */
    underlayInsetMm: 0.35,
    premiumUnderlayInsetMm: 0.4,
    /** Narrowest satin column. [CAL] Standard 1.5 (below: bean/triple run); Premium 1.5 at 40 wt and 1.0 at 60 wt, so hairlines come out at the safe width (`SAFE_RANGES.satinWidth`). */
    minWidthMm: { standard: 1.5, premium40: 1.5, premium60: 1.0 },
    /** Columns wider than this are split into stitched halves, so a satin leg (plus pull and slant) stays under the 7 mm snag limit. [CAL] split 8 (hard cap 12.1); Lilo lowers it to 5 so defaults never trip `long-stitch-snag`. */
    splitMm: 5,
    /** Shortest hairline that becomes a narrow satin column, else a triple run. UNVERIFIED. */
    hairlineSatinMinLengthMm: 1.6,
    /** Columns that meet overlap by this much. UNVERIFIED (practice: "a hair"). */
    junctionOverlapMm: 0.3,
    /** Smallest letter (cap height) that stays legible, by thread. [CAL] 6 mm at 40 wt, 4 mm at 60 wt. */
    minCapHeightMm: { w40: 6, w60: 4 },
  },
  fill: {
    /** Distance between rows. [CAL][EH-WILCOM] 0.40 at 40 wt. */
    rowSpacingMm: 0.4,
    /** Longest stitch in a row. [CAL] 4.0 (3 to 4.5); [IS-SRC] 4.0. */
    stitchLengthMm: 4,
    angleDeg: 45,
    /** Push compensation per side, woven. [CAL] 0.15 to 0.20 (Premium 0.20). */
    pullCompMm: 0.2,
    /** Underlay rows perpendicular to the top, 3 to 4 mm apart, inset 0.4. [CAL][IS-FILL] */
    underlayRowSpacingMm: 3.5,
    underlayStitchMm: 4,
    underlayInsetMm: 0.4,
    /** Fills smaller than this (mm^2) get no underlay: it would be all edge. LEGACY. */
    underlayMinAreaMm2: 6,
    /** Running outline after the tatami. LEGACY. */
    edgeRunStitchMm: 2,
    /** Premium edge-walk underlay inside the edge, sewn before the tatami underlay. [CAL][IS-SRC] */
    premiumEdgeWalkInsetMm: 0.4,
    premiumEdgeWalkStitchMm: 2.5,
    /** Premium row spacing clamp, mm. [CAL][EH-THEORY] */
    rowSpacingMinMm: 0.3,
    rowSpacingMaxMm: 0.6,
    /** Auto-digitize: fills with less area than this are specks. LEGACY. */
    minRegionMm2: 2,
  },
  run: {
    /** Plain running stitch. [CAL] 2.5 (min 0.5, max 7 on wearables). */
    stitchLengthMm: 2.5,
    /** Auto-digitized outlines and hairline runs. [CAL] 2.5. */
    autoStitchLengthMm: 2.5,
    /** A run through the middle of a 0.6 mm or wider stroke is sewn triple (bean, 3 passes). LEGACY. */
    tripleAtWidthMm: 0.6,
    /** Shortest centre-line run kept. LEGACY. */
    minRunMm: 1.5,
  },
  pixelArt: {
    /** Tatami row spacing, satin spacing (same-side, as everywhere), pull comp, stitch length. LEGACY. */
    rowSpacingMm: 0.4,
    satinDensityMm: 0.4,
    pullCompMm: 0.1,
    stitchLengthMm: 3,
  },
  lettering: {
    /** Narrowest satin column in custom-font lettering. [CAL] Standard 1.5 (thinner strokes run). Premium 1.5 at 40 wt (a 1 mm column is too thin to look shiny and breaks thread); 1.0 only at 60 wt. Matches `SAFE_RANGES.satinWidth`. */
    customMinColumnMm: { standard: 1.5, premium40: 1.5, premium60: 1.0 },
    /** Custom-font fills. LEGACY. */
    fillPullCompMm: 0.15,
    fillUnderlayMinAreaMm2: 6,
  },
  /** Needle-and-machine limits applied to every plan (validatePlan). */
  limits: {
    /** Longest needle-to-needle distance; longer is split. [CAL] 12.1 hard cap. */
    maxStitchMm: 12.1,
    /** Jumps longer than this get a thread trim. [CAL] about 3. */
    trimJumpMm: 3,
    /** PEC/PES delta limit; longer jumps are split. File format. */
    maxJumpMm: 200,
    /** Needle drops per 1 mm^2 cell above which a density warning is raised. LEGACY. */
    densityWarnPerMm2: 10,
    /** Shorter needle drops within one object are merged away. [CAL] 0.5 floor; Premium 0.6 (`minStitchPremiumMm`). */
    minStitchMm: 0.5,
    minStitchPremiumMm: 0.6,
    /** Tie-in / tie-off: 3 small stitches of this length. [CAL] */
    lockStitchMm: 0.4,
    /** Moves shorter than this are not worth a jump. */
    sameSpotMm: 0.05,
  },
} as const;

/** Satin legs per cm of column for a density (same-side spacing): 2 / density per mm. */
export const satinLegsPerCm = (densityMm: number): number => (densityMm > 0 ? 20 / densityMm : 0);
/** Fill rows per cm for a row spacing. */
export const fillRowsPerCm = (rowSpacingMm: number): number => (rowSpacingMm > 0 ? 10 / rowSpacingMm : 0);
