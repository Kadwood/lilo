import { Coordinate } from "jsts/org/locationtech/jts/geom";
import { bufferGeom, factory, polygonsOf, unionAll, type Geom, type Poly } from "../geom";
import { parseColor, parsePathData, type Ring, type SvgDocument } from "./svg";

/** A same-colour area in some source unit (pixels for traced images, user units for SVG). */
export interface Region {
  /** "#rrggbb" as found in the source (snapped to a thread later). */
  hex: string;
  geom: Poly;
}

/**
 * Even-odd nesting of rings: a ring inside an odd number of others is a hole of its tightest
 * container. Returns the combined (Multi)Polygon, or null if no ring has an area.
 */
export function ringsToGeometry(rings: Ring[]): Geom | null {
  const items = rings
    .filter((r) => r.pts.length >= 3)
    .map((r) => {
      const coords = r.pts.map(([x, y]) => new Coordinate(x, y));
      const f = coords[0];
      const l = coords[coords.length - 1];
      if (f.x !== l.x || f.y !== l.y) coords.push(new Coordinate(f.x, f.y));
      if (coords.length < 4) return null;
      let poly: Poly = factory.createPolygon(factory.createLinearRing(coords));
      if (!poly.isValid()) poly = poly.buffer(0);
      const area = poly.getArea();
      return area > 1e-9 ? { poly, area, coords } : null;
    })
    .filter((x): x is { poly: Poly; area: number; coords: Coordinate[] } => x !== null)
    .sort((a, b) => b.area - a.area);
  if (items.length === 0) return null;

  const depth: number[] = new Array(items.length).fill(0);
  const parent: number[] = new Array(items.length).fill(-1);
  for (let i = 1; i < items.length; i++) {
    const pt = items[i].poly.getInteriorPoint();
    const env = items[i].poly.getEnvelopeInternal();
    for (let j = i - 1; j >= 0; j--) {
      if (!items[j].poly.getEnvelopeInternal().covers(env)) continue;
      if (items[j].poly.contains(pt)) {
        parent[i] = j;
        depth[i] = depth[j] + 1;
        break; // sorted by area desc: the first hit scanning upwards is the tightest container
      }
    }
  }
  const polys: Poly[] = [];
  items.forEach((it, i) => {
    if (depth[i] % 2 !== 0) return;
    const holes = items
      .map((h, k) => ({ h, k }))
      .filter(({ k }) => parent[k] === i && depth[k] % 2 === 1)
      .map(({ h }) => factory.createLinearRing(h.coords));
    const shell = factory.createLinearRing(it.coords);
    let p: Poly = factory.createPolygon(shell, holes);
    if (!p.isValid()) p = p.buffer(0);
    polys.push(...polygonsOf(p));
  });
  if (polys.length === 0) return null;
  return polys.length === 1 ? polys[0] : factory.createMultiPolygon(polys);
}

const normHex = (h: string) => h.toLowerCase();

/** Group regions of the same colour into one geometry each. */
function mergeSameColour(list: Region[]): Region[] {
  const byHex = new Map<string, Geom[]>();
  for (const r of list) {
    const k = normHex(r.hex);
    if (!byHex.has(k)) byHex.set(k, []);
    byHex.get(k)!.push(r.geom);
  }
  const out: Region[] = [];
  for (const [hex, geoms] of byHex) {
    const merged = geoms.length === 1 ? geoms[0] : unionAll(geoms);
    if (!merged.isEmpty()) out.push({ hex, geom: merged });
  }
  return out;
}

/** Parse the paths of a vtracer SVG (`<path d fill transform="translate(x,y)">`) into regions (pixels). */
export function tracedSvgToRegions(svg: string, tolPx = 0.3): Region[] {
  const out: Region[] = [];
  const re = /<path\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const tag = m[0];
    const d = /\sd="([^"]*)"/.exec(tag)?.[1];
    const fill = /\sfill="([^"]*)"/.exec(tag)?.[1];
    const tr = /translate\(\s*([-\d.e]+)[\s,]+([-\d.e]+)\s*\)/.exec(tag);
    if (!d || !fill) continue;
    const tx = tr ? Number(tr[1]) : 0;
    const ty = tr ? Number(tr[2]) : 0;
    const rings = parsePathData(d, tolPx).map((r) => ({ closed: true, pts: r.pts.map(([x, y]) => [x + tx, y + ty] as [number, number]) }));
    const geom = ringsToGeometry(rings);
    const hex = parseColor(fill);
    if (geom && hex) out.push({ hex, geom });
  }
  return mergeSameColour(out);
}

/** Cap on shapes for the "cut out what's on top" pass; beyond it overlaps are left in. */
const MAX_CUTOUT_SHAPES = 400;

/**
 * Regions from a parsed SVG: fills become polygons, strokes become buffered outlines; later shapes
 * paint over earlier ones, so each earlier shape is cut by everything above it (no overlaps).
 */
export function svgToRegions(doc: SvgDocument): Region[] {
  const layers: Region[] = [];
  for (const s of doc.shapes) {
    if (s.fill) {
      const g = ringsToGeometry(s.rings.map((r) => ({ ...r, closed: true })));
      if (g) layers.push({ hex: s.fill, geom: g });
    }
    if (s.stroke && s.strokeWidth > 0) {
      for (const r of s.rings) {
        const pts = r.closed ? [...r.pts, r.pts[0]] : r.pts;
        if (pts.length < 2) continue;
        const line = factory.createLineString(pts.map(([x, y]) => new Coordinate(x, y)));
        const buf = bufferGeom(line, s.strokeWidth / 2);
        if (!buf.isEmpty()) layers.push({ hex: s.stroke, geom: buf });
      }
    }
  }
  if (layers.length > MAX_CUTOUT_SHAPES) return mergeSameColour(layers);
  const visible: Region[] = [];
  let covered: Geom | null = null;
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    const vis: Geom = covered ? l.geom.difference(covered) : l.geom;
    if (!vis.isEmpty()) visible.push({ hex: l.hex, geom: vis });
    covered = covered ? covered.union(l.geom) : l.geom;
  }
  return mergeSameColour(visible.reverse());
}
