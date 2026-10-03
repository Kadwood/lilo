export type Units = "mm" | "in";

const MM_PER_IN = 25.4;

/** A length in mm as a number in the chosen unit. */
export const fromMm = (mm: number, u: Units): number => (u === "in" ? mm / MM_PER_IN : mm);
/** A number in the chosen unit as mm. */
export const toMm = (v: number, u: Units): number => (u === "in" ? v * MM_PER_IN : v);

/** Round for display: 0.1 mm or 0.01 in. */
export const roundFor = (v: number, u: Units): number => (u === "in" ? Math.round(v * 1000) / 1000 : Math.round(v * 100) / 100);

/** "12.5 mm" / "0.49 in". */
export function formatLength(mm: number, u: Units): string {
  return u === "in" ? `${(mm / MM_PER_IN).toFixed(3)} in` : `${mm.toFixed(2)} mm`;
}
