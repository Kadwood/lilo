import { hexToRgb } from "../color";
import { polygonsOf, ringsOf, simplifyGeom, polygonFromRings, type Poly } from "../geom";
import { boundsOfPoints, type Pt } from "../model";
import { nearestThread, toDesignThread, type ThreadEntry } from "../threads";
import type { TraceRegion } from "../clickstitch";
import type { Region } from "./regions";
import type { UnitsToMm } from "./cleanup";

/** Regions smaller than this (mm²) are not offered for clicking: they are specks. */
const MIN_AREA_MM2 = 0.25;
const SIMPLIFY_MM = 0.05;

/**
 * The clickable regions of a trace: every connected area of every colour, in design millimetres
 * (`mm = (unit - centre) * scale`, the same transform the automatic result uses). Colours are
 * snapped to `threads` exactly as `regionsToDesign` does, so a region's thread matches the palette.
 */
export function buildTraceRegions(regions: readonly Region[], threads: readonly ThreadEntry[], t: UnitsToMm): TraceRegion[] {
  const out: TraceRegion[] = [];
  const toMm = ([x, y]: Pt): Pt => [(x - t.cx) * t.scale, (y - t.cy) * t.scale];
  for (const r of regions) {
    const thread = toDesignThread(nearestThread(hexToRgb(r.hex), threads).thread);
    for (const part of polygonsOf(r.geom)) {
      const { shell, holes } = ringsOf(part);
      let poly: Poly = polygonFromRings(shell.map(toMm), holes.map((h) => h.map(toMm)));
      if (poly.getArea() < MIN_AREA_MM2) continue;
      poly = simplifyGeom(poly, SIMPLIFY_MM);
      for (const p of polygonsOf(poly)) {
        const rings = ringsOf(p);
        const box = boundsOfPoints(rings.shell);
        const area = p.getArea();
        if (!box || rings.shell.length < 3 || area < MIN_AREA_MM2) continue;
        out.push({ id: `r${out.length + 1}`, hex: r.hex, thread, shell: rings.shell, holes: rings.holes, areaMm2: area, box });
      }
    }
  }
  return out;
}
