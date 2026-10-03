import { deltaE2000, hexToRgb, rgbToLab, type Lab } from "../color";

/**
 * The Brother PEC 64-colour machine palette. A PES/PEC file stores, per colour block, a 1-based
 * index into this table (the machine shows the colour and name on screen); it is NOT a spool code.
 *
 * Values ported from pyembroidery's `EmbThreadPec.py` (MIT, https://github.com/EmbroidePy/pyembroidery).
 * See NOTICE.md.
 */
export interface PecColor {
  /** 1..64, the byte stored in the file. */
  index: number;
  name: string;
  rgb: readonly [number, number, number];
}

const RAW: readonly [number, number, number, string][] = [
  [14, 31, 124, "Prussian Blue"],
  [10, 85, 163, "Blue"],
  [0, 135, 119, "Teal Green"],
  [75, 107, 175, "Cornflower Blue"],
  [237, 23, 31, "Red"],
  [209, 92, 0, "Reddish Brown"],
  [145, 54, 151, "Magenta"],
  [228, 154, 203, "Light Lilac"],
  [145, 95, 172, "Lilac"],
  [158, 214, 125, "Mint Green"],
  [232, 169, 0, "Deep Gold"],
  [254, 186, 53, "Orange"],
  [255, 255, 0, "Yellow"],
  [112, 188, 31, "Lime Green"],
  [186, 152, 0, "Brass"],
  [168, 168, 168, "Silver"],
  [125, 111, 0, "Russet Brown"],
  [255, 255, 179, "Cream Brown"],
  [79, 85, 86, "Pewter"],
  [0, 0, 0, "Black"],
  [11, 61, 145, "Ultramarine"],
  [119, 1, 118, "Royal Purple"],
  [41, 49, 51, "Dark Gray"],
  [42, 19, 1, "Dark Brown"],
  [246, 74, 138, "Deep Rose"],
  [178, 118, 36, "Light Brown"],
  [252, 187, 197, "Salmon Pink"],
  [254, 55, 15, "Vermilion"],
  [240, 240, 240, "White"],
  [106, 28, 138, "Violet"],
  [168, 221, 196, "Seacrest"],
  [37, 132, 187, "Sky Blue"],
  [254, 179, 67, "Pumpkin"],
  [255, 243, 107, "Cream Yellow"],
  [208, 166, 96, "Khaki"],
  [209, 84, 0, "Clay Brown"],
  [102, 186, 73, "Leaf Green"],
  [19, 74, 70, "Peacock Blue"],
  [135, 135, 135, "Gray"],
  [216, 204, 198, "Warm Gray"],
  [67, 86, 7, "Dark Olive"],
  [253, 217, 222, "Flesh Pink"],
  [249, 147, 188, "Pink"],
  [0, 56, 34, "Deep Green"],
  [178, 175, 212, "Lavender"],
  [104, 106, 176, "Wisteria Violet"],
  [239, 227, 185, "Beige"],
  [247, 56, 102, "Carmine"],
  [181, 75, 100, "Amber Red"],
  [19, 43, 26, "Olive Green"],
  [199, 1, 86, "Dark Fuchsia"],
  [254, 158, 50, "Tangerine"],
  [168, 222, 235, "Light Blue"],
  [0, 103, 62, "Emerald Green"],
  [78, 41, 144, "Purple"],
  [47, 126, 32, "Moss Green"],
  [255, 204, 204, "Flesh Pink"],
  [255, 217, 17, "Harvest Gold"],
  [9, 91, 166, "Electric Blue"],
  [240, 249, 112, "Lemon Yellow"],
  [227, 243, 91, "Fresh Green"],
  [255, 153, 0, "Orange"],
  [255, 240, 141, "Cream Yellow"],
  [255, 200, 200, "Applique"],
];

export const PEC_PALETTE: readonly PecColor[] = RAW.map(([r, g, b, name], i) => ({
  index: i + 1,
  name,
  rgb: [r, g, b] as const,
}));

const PEC_LAB: readonly Lab[] = PEC_PALETTE.map((c) => rgbToLab(...c.rgb));

/** The PEC slot (1..64) closest to a "#rrggbb" colour by CIEDE2000. Ties go to the lower index. */
export function nearestPecIndex(hex: string): number {
  const lab = rgbToLab(...hexToRgb(hex));
  let best = 0;
  let bd = Infinity;
  PEC_LAB.forEach((l, i) => {
    const d = deltaE2000(lab, l);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return PEC_PALETTE[best].index;
}

/** Look up a 1-based PEC index (wraps like pyembroidery does for out-of-range bytes). */
export function pecColor(index: number): PecColor {
  return PEC_PALETTE[((index - 1) % PEC_PALETTE.length + PEC_PALETTE.length) % PEC_PALETTE.length];
}
