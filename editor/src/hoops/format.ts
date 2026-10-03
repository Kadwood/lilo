import type { Hoop } from "@lilo/engine/light";

const n = (v: number) => String(Math.round(v * 10) / 10);

/** "130 × 180 mm". */
export const fmtSize = (h: Pick<Hoop, "widthMm" | "heightMm">): string => `${n(h.widthMm)} × ${n(h.heightMm)} mm`;

/** "12 mm" for an overflow figure, one decimal when small. */
export const fmtMm = (v: number): string => `${v < 10 ? Math.round(v * 10) / 10 : Math.round(v)} mm`;
