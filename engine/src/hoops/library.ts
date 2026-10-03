/**
 * The hoop library: real hoops and machine sewing fields, with where each number came from. The data
 * lives in `library.json` (so it can be read, diffed and fixed without touching code); this file gives
 * it types and the lookups the picker needs.
 *
 * Every entry says whether a manufacturer page stated the size (`verified`) and names its `sources`
 * (keys into `HOOP_SOURCES`). Anything not verified is UNVERIFIED and the picker says so.
 */
import raw from "./library.json";
import type { Hoop, HoopClamp, HoopShape } from "../model/types";

export interface HoopSource {
  title: string;
  url: string;
  /** ISO date the page was read. */
  checked: string;
  note?: string;
}

export interface HoopSpec {
  /** Stable id, e.g. `brother-130x180`. Saved in designs. */
  id: string;
  brand: string;
  name: string;
  /** Sewing area, mm, as the hoop sits in the machine. */
  widthMm: number;
  heightMm: number;
  shape: HoopShape;
  cornerRadiusMm?: number;
  clamp?: HoopClamp;
  outerWidthMm?: number;
  outerHeightMm?: number;
  /** Machines this hoop fits (model names). */
  machines: string[];
  /** Keys of `HOOP_SOURCES`. */
  sources: string[];
  /** A manufacturer page stated this size when the library was compiled. False = UNVERIFIED. */
  verified: boolean;
  note?: string;
}

interface LibraryFile {
  version: number;
  compiled: string;
  note: string;
  sources: Record<string, HoopSource>;
  brands: string[];
  hoops: HoopSpec[];
}

const data = raw as unknown as LibraryFile;

export const HOOP_LIBRARY_NOTE: string = data.note;
export const HOOP_LIBRARY_COMPILED: string = data.compiled;
export const HOOP_SOURCES: Readonly<Record<string, HoopSource>> = data.sources;
export const HOOP_BRANDS: readonly string[] = data.brands;
export const HOOP_LIBRARY: readonly HoopSpec[] = data.hoops;

export const findHoopSpec = (id: string | undefined): HoopSpec | undefined => (id ? HOOP_LIBRARY.find((h) => h.id === id) : undefined);

export const hoopsForBrand = (brand: string): HoopSpec[] => HOOP_LIBRARY.filter((h) => h.brand === brand);

/** Machine models of a brand, in first-seen order. */
export function machinesForBrand(brand: string): string[] {
  const out: string[] = [];
  for (const h of hoopsForBrand(brand)) for (const m of h.machines) if (!out.includes(m)) out.push(m);
  return out;
}

export const hoopsForMachine = (brand: string, machine: string): HoopSpec[] => hoopsForBrand(brand).filter((h) => h.machines.includes(machine));

/** Plain `Hoop` (what a design stores) for a library entry. */
export function hoopFromSpec(s: HoopSpec): Hoop {
  const h: Hoop = { name: s.name, widthMm: s.widthMm, heightMm: s.heightMm, id: s.id, brand: s.brand, shape: s.shape };
  if (s.cornerRadiusMm !== undefined) h.cornerRadiusMm = s.cornerRadiusMm;
  if (s.clamp) h.clamp = s.clamp;
  if (s.outerWidthMm !== undefined) h.outerWidthMm = s.outerWidthMm;
  if (s.outerHeightMm !== undefined) h.outerHeightMm = s.outerHeightMm;
  return h;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();

/** Words typed in the search box match the brand, the name, the machines and the size ("130x180"). */
export function searchHoops(query: string, pool: readonly HoopSpec[] = HOOP_LIBRARY): HoopSpec[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (words.length === 0) return [...pool];
  return pool.filter((h) => {
    const hay = norm([h.brand, h.name, ...h.machines, `${h.widthMm}x${h.heightMm}`, `${h.heightMm}x${h.widthMm}`, `${h.widthMm} x ${h.heightMm}`].join(" "));
    const compact = hay.replace(/ /g, "");
    return words.every((w) => hay.includes(w) || compact.includes(w));
  });
}
