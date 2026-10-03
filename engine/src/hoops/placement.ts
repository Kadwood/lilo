/**
 * Placement guides: translucent outlines of where a design usually goes on a garment, with the largest
 * design that usually looks right there. These are APPROXIMATE rules of thumb from common tailoring and
 * embroidery practice (not from a standard, and not checked against a manufacturer): a tailor's own
 * pattern always wins. Sizes in mm, centred on the hoop's centre.
 */

export type PlacementKind = "rect" | "cap" | "cuff" | "pocket";

export interface PlacementGuide {
  id: string;
  label: string;
  /** The garment area, mm. */
  widthMm: number;
  heightMm: number;
  /** The largest design that usually looks right there, mm. */
  maxDesignMm: { w: number; h: number };
  kind: PlacementKind;
  /** One line shown with the guide. */
  note: string;
}

export const PLACEMENT_GUIDES: readonly PlacementGuide[] = [
  {
    id: "suit-lining-pocket",
    label: "Suit lining, inside pocket",
    widthMm: 150,
    heightMm: 170,
    maxDesignMm: { w: 90, h: 40 },
    kind: "pocket",
    note: "Area around the inside breast pocket of a jacket lining. A monogram or name fits above the welt; keep clear of the seams.",
  },
  {
    id: "shirt-cuff",
    label: "Shirt cuff",
    widthMm: 100,
    heightMm: 70,
    maxDesignMm: { w: 40, h: 25 },
    kind: "cuff",
    note: "The face of a barrel cuff. Initials of about 25 mm tall sit above the buttonhole edge.",
  },
  {
    id: "cap-front",
    label: "Cap front",
    widthMm: 140,
    heightMm: 60,
    maxDesignMm: { w: 110, h: 50 },
    kind: "cap",
    note: "The front panel of a structured cap, drawn flat. About 110 x 50 mm is the usual limit; a cap frame is needed.",
  },
  {
    id: "garment-bag-panel",
    label: "Garment bag panel",
    widthMm: 400,
    heightMm: 600,
    maxDesignMm: { w: 200, h: 120 },
    kind: "rect",
    note: "The upper front of a garment bag. A logo about 200 mm wide, set a hand below the top seam.",
  },
  {
    id: "left-chest",
    label: "Left chest",
    widthMm: 160,
    heightMm: 160,
    maxDesignMm: { w: 100, h: 100 },
    kind: "rect",
    note: "Left side of a shirt or jacket front. A logo up to about 100 mm (4 in) wide is the common limit.",
  },
];

export const findPlacementGuide = (id: string | null | undefined): PlacementGuide | undefined => PLACEMENT_GUIDES.find((g) => g.id === id);

export interface PlacementCheck {
  fits: boolean;
  /** How far the design is over the recommended maximum, mm per axis (0 = within). */
  overMm: { w: number; h: number };
}

/** Is a design of `size` within the guide's recommended maximum? */
export function checkPlacement(guide: PlacementGuide, size: { w: number; h: number }): PlacementCheck {
  const w = Math.max(0, size.w - guide.maxDesignMm.w);
  const h = Math.max(0, size.h - guide.maxDesignMm.h);
  return { fits: w <= 1e-9 && h <= 1e-9, overMm: { w, h } };
}
