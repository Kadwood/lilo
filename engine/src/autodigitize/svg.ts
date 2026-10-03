/**
 * Small, dependency-free SVG reader: path data (all commands, curves flattened to polylines),
 * transforms, basic shapes and fill/stroke styling. Enough for logos, icons and vtracer output;
 * not a renderer (no <use>, text, filters, masks, clip paths; gradients use their first stop).
 */

export type P = [number, number];
export interface Ring {
  pts: P[];
  closed: boolean;
}

/** [a, b, c, d, e, f] as in SVG `matrix(a b c d e f)`. */
export type Matrix = [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export const applyMatrix = (m: Matrix, [x, y]: P): P => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Parse an SVG `transform` attribute. Unknown/garbled input yields identity. */
export function parseTransform(s: string | undefined): Matrix {
  if (!s) return IDENTITY;
  let m: Matrix = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(s))) {
    const a = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Matrix = IDENTITY;
    switch (match[1]) {
      case "matrix":
        if (a.length === 6) t = a as Matrix;
        break;
      case "translate":
        t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case "scale":
        t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const r = ((a[0] ?? 0) * Math.PI) / 180;
        const c = Math.cos(r);
        const sn = Math.sin(r);
        t = [c, sn, -sn, c, 0, 0];
        if (a.length >= 3) t = multiply(multiply([1, 0, 0, 1, a[1], a[2]], t), [1, 0, 0, 1, -a[1], -a[2]]);
        break;
      }
      case "skewX":
        t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = multiply(m, t);
  }
  return m;
}

/** Flatten a cubic bezier into `out` (excluding p0), recursively, to `tol` flatness. */
function flattenCubic(p0: P, p1: P, p2: P, p3: P, tol: number, out: P[], depth = 0): void {
  // Flatness: max distance of the control points from the chord p0-p3.
  const dx = p3[0] - p0[0];
  const dy = p3[1] - p0[1];
  const len = Math.hypot(dx, dy);
  const d1 = len > 1e-12 ? Math.abs((p1[0] - p0[0]) * dy - (p1[1] - p0[1]) * dx) / len : Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const d2 = len > 1e-12 ? Math.abs((p2[0] - p0[0]) * dy - (p2[1] - p0[1]) * dx) / len : Math.hypot(p2[0] - p0[0], p2[1] - p0[1]);
  if (depth >= 12 || Math.max(d1, d2) <= tol) {
    out.push(p3);
    return;
  }
  const m = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const p01 = m(p0, p1);
  const p12 = m(p1, p2);
  const p23 = m(p2, p3);
  const p012 = m(p01, p12);
  const p123 = m(p12, p23);
  const mid = m(p012, p123);
  flattenCubic(p0, p01, p012, mid, tol, out, depth + 1);
  flattenCubic(mid, p123, p23, p3, tol, out, depth + 1);
}

/** SVG elliptical arc -> cubic beziers (flattened into `out`). */
function flattenArc(p0: P, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean, p1: P, tol: number, out: P[]): void {
  if (p0[0] === p1[0] && p0[1] === p1[1]) return;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) {
    out.push(p1);
    return;
  }
  const phi = (rotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx2 = (p0[0] - p1[0]) / 2;
  const dy2 = (p0[1] - p1[1]) / 2;
  const x1p = cosP * dx2 + sinP * dy2;
  const y1p = -sinP * dx2 + cosP * dy2;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (p0[0] + p1[0]) / 2;
  const cy = sinP * cxp + cosP * cyp + (p0[1] + p1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  else if (sweep && dth < 0) dth += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2)));
  const delta = dth / segs;
  const t = (4 / 3) * Math.tan(delta / 4);
  let a1 = th1;
  let cur = p0;
  for (let i = 0; i < segs; i++) {
    const a2 = a1 + delta;
    const pt = (a: number, ox: number, oy: number): P => {
      const x = rx * (Math.cos(a) + ox);
      const y = ry * (Math.sin(a) + oy);
      return [cosP * x - sinP * y + cx, sinP * x + cosP * y + cy];
    };
    const c1: P = pt(a1, -t * Math.sin(a1), t * Math.cos(a1));
    const c2: P = pt(a2, t * Math.sin(a2), -t * Math.cos(a2));
    const end: P = i === segs - 1 ? p1 : pt(a2, 0, 0);
    flattenCubic(cur, c1, c2, end, tol, out);
    cur = end;
    a1 = a2;
  }
}

/**
 * Parse SVG path data into polylines. Curves are flattened to `tol` (in path units).
 * Every `M` starts a new ring; `Z` closes it.
 */
export function parsePathData(d: string, tol: number): Ring[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const rings: Ring[] = [];
  let cur: Ring | null = null;
  let i = 0;
  let cmd = "";
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastCtrl: P | null = null; // for S/T
  let lastCmd = "";
  const num = () => Number(tokens[i++]);
  const flag = () => {
    // Arc flags may be glued together ("a1 1 0 00.5.5"); tokens already split numbers greedily,
    // so a flag is any token's first char when it is 0/1 and the token is longer.
    const t = tokens[i];
    if (t.length > 1 && (t[0] === "0" || t[0] === "1") && !t.startsWith("0.") && !t.startsWith("1.")) {
      tokens[i] = t.slice(1);
      return t[0] === "1";
    }
    i++;
    return Number(t) !== 0;
  };
  const start = (px: number, py: number) => {
    cur = { pts: [[px, py]], closed: false };
    rings.push(cur);
  };
  const ensure = () => {
    if (!cur) start(x, y);
    return cur!;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    else if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (C) {
      case "M": {
        x = ox + num();
        y = oy + num();
        sx = x;
        sy = y;
        start(x, y);
        lastCtrl = null;
        break;
      }
      case "L": {
        x = ox + num();
        y = oy + num();
        ensure().pts.push([x, y]);
        lastCtrl = null;
        break;
      }
      case "H": {
        x = ox + num();
        ensure().pts.push([x, y]);
        lastCtrl = null;
        break;
      }
      case "V": {
        y = oy + num();
        ensure().pts.push([x, y]);
        lastCtrl = null;
        break;
      }
      case "C": {
        const c1: P = [ox + num(), oy + num()];
        const c2: P = [ox + num(), oy + num()];
        const e: P = [ox + num(), oy + num()];
        flattenCubic([x, y], c1, c2, e, tol, ensure().pts);
        x = e[0];
        y = e[1];
        lastCtrl = c2;
        break;
      }
      case "S": {
        const c1: P = lastCtrl && /[CS]/i.test(lastCmd) ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        const c2: P = [ox + num(), oy + num()];
        const e: P = [ox + num(), oy + num()];
        flattenCubic([x, y], c1, c2, e, tol, ensure().pts);
        x = e[0];
        y = e[1];
        lastCtrl = c2;
        break;
      }
      case "Q": {
        const q: P = [ox + num(), oy + num()];
        const e: P = [ox + num(), oy + num()];
        const c1: P = [x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)];
        const c2: P = [e[0] + (2 / 3) * (q[0] - e[0]), e[1] + (2 / 3) * (q[1] - e[1])];
        flattenCubic([x, y], c1, c2, e, tol, ensure().pts);
        x = e[0];
        y = e[1];
        lastCtrl = q;
        break;
      }
      case "T": {
        const q: P = lastCtrl && /[QT]/i.test(lastCmd) ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        const e: P = [ox + num(), oy + num()];
        const c1: P = [x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)];
        const c2: P = [e[0] + (2 / 3) * (q[0] - e[0]), e[1] + (2 / 3) * (q[1] - e[1])];
        flattenCubic([x, y], c1, c2, e, tol, ensure().pts);
        x = e[0];
        y = e[1];
        lastCtrl = q;
        break;
      }
      case "A": {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = flag();
        const sweep = flag();
        const e: P = [ox + num(), oy + num()];
        flattenArc([x, y], rx, ry, rot, large, sweep, e, tol, ensure().pts);
        x = e[0];
        y = e[1];
        lastCtrl = null;
        break;
      }
      case "Z": {
        if (cur) {
          (cur as Ring).closed = true;
          x = sx;
          y = sy;
          cur = null;
        }
        lastCtrl = null;
        break;
      }
      default:
        i++; // unknown command: skip a token to guarantee progress
    }
    lastCmd = cmd;
    if (C === "Z") cmd = "";
  }
  return rings.filter((r) => r.pts.length >= 2);
}

// ---------------------------------------------------------------------------------------------
// Document reader
// ---------------------------------------------------------------------------------------------

export interface SvgShape {
  /** Rings already in document user units with all transforms applied. */
  rings: Ring[];
  fill: string | null; // "#rrggbb" or null for none
  stroke: string | null;
  /** Stroke width in user units (after transform scale). */
  strokeWidth: number;
}

export interface SvgDocument {
  shapes: SvgShape[];
  /** viewBox (or width/height) origin and size, in user units. */
  minX: number;
  minY: number;
  width: number;
  height: number;
  /** Things we skipped (e.g. "<use>", "<text>"). */
  unsupported: string[];
}

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00",
  orange: "#ffa500", purple: "#800080", pink: "#ffc0cb", gray: "#808080", grey: "#808080", silver: "#c0c0c0",
  maroon: "#800000", navy: "#000080", teal: "#008080", olive: "#808000", lime: "#00ff00", aqua: "#00ffff",
  cyan: "#00ffff", fuchsia: "#ff00ff", magenta: "#ff00ff", brown: "#a52a2a", gold: "#ffd700", beige: "#f5f5dc",
  ivory: "#fffff0", khaki: "#f0e68c", coral: "#ff7f50", crimson: "#dc143c", indigo: "#4b0082", violet: "#ee82ee",
  turquoise: "#40e0d0", salmon: "#fa8072", tan: "#d2b48c", darkgreen: "#006400", darkblue: "#00008b",
  darkred: "#8b0000", lightgray: "#d3d3d3", lightgrey: "#d3d3d3", darkgray: "#a9a9a9", darkgrey: "#a9a9a9",
  skyblue: "#87ceeb", royalblue: "#4169e1", firebrick: "#b22222", orchid: "#da70d6", plum: "#dda0dd",
};

/** Normalise a CSS colour to "#rrggbb"; null for none/transparent/unsupported (url refs handled by caller). */
export function parseColor(v: string | undefined | null, current = "#000000"): string | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (s === "none" || s === "transparent" || s === "") return null;
  if (s === "currentcolor") return current;
  if (NAMED[s]) return NAMED[s];
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return "#" + [...m[1]].map((c) => c + c).join("");
  m = /^#([0-9a-f]{6})/.exec(s);
  if (m) return "#" + m[1];
  m = /^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)/.exec(s);
  if (m) {
    const ch = (n: string, pct: string) => Math.max(0, Math.min(255, Math.round(pct ? (Number(n) * 255) / 100 : Number(n))));
    return "#" + [ch(m[1], m[2]), ch(m[3], m[4]), ch(m[5], m[6])].map((c) => c.toString(16).padStart(2, "0")).join("");
  }
  return null;
}

interface Node {
  name: string;
  attrs: Record<string, string>;
  children: Node[];
  text: string;
}

function parseXml(text: string): Node {
  const root: Node = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: Node[] = [root];
  const cleaned = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, "")
    .replace(/<\?[\s\S]*?\?>/g, "");
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(cleaned))) {
    const between = cleaned.slice(last, m.index);
    if (between.trim()) stack[stack.length - 1].text += between;
    last = tag.lastIndex;
    const [, close, name, rest, selfClose] = m;
    const lname = name.replace(/^.*:/, "").toLowerCase();
    if (close) {
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === lname) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    const ar = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let a: RegExpExecArray | null;
    while ((a = ar.exec(rest))) attrs[a[1].replace(/^.*:/, "").toLowerCase() === "href" ? "href" : a[1]] = a[2] ?? a[3] ?? "";
    const node: Node = { name: lname, attrs, children: [], text: "" };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

const num = (v: string | undefined, d = 0): number => {
  if (v === undefined) return d;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

interface Style {
  fill: string | null | undefined; // undefined = inherit/default
  stroke: string | null;
  strokeWidth: number;
  display: boolean;
  color: string;
  fillOpacity: number;
}

function styleOf(attrs: Record<string, string>, parent: Style, gradients: Map<string, string>): Style {
  const s: Record<string, string> = {};
  for (const k of ["fill", "stroke", "stroke-width", "display", "color", "fill-opacity", "opacity", "visibility"]) {
    if (attrs[k] !== undefined) s[k] = attrs[k];
  }
  if (attrs.style) {
    for (const decl of attrs.style.split(";")) {
      const [k, ...v] = decl.split(":");
      if (k && v.length) s[k.trim().toLowerCase()] = v.join(":").trim();
    }
  }
  const color = s.color ? (parseColor(s.color) ?? parent.color) : parent.color;
  const resolve = (v: string | undefined, inherit: string | null): string | null => {
    if (v === undefined || v === "inherit") return inherit;
    const url = /^url\(\s*#([^)\s]+)\s*\)/.exec(v);
    if (url) return gradients.get(url[1]) ?? inherit;
    return parseColor(v, color);
  };
  return {
    fill: resolve(s.fill, parent.fill ?? "#000000"),
    stroke: resolve(s.stroke, parent.stroke),
    strokeWidth: s["stroke-width"] !== undefined ? num(s["stroke-width"], 1) : parent.strokeWidth,
    display: parent.display && s.display !== "none" && s.visibility !== "hidden" && s.visibility !== "collapse",
    color,
    fillOpacity: (s["fill-opacity"] !== undefined ? num(s["fill-opacity"], 1) : parent.fillOpacity) * (s.opacity !== undefined ? num(s.opacity, 1) : 1),
  };
}

const ellipseRing = (cx: number, cy: number, rx: number, ry: number): Ring => {
  const pts: P[] = [];
  const n = 72;
  for (let k = 0; k < n; k++) pts.push([cx + rx * Math.cos((2 * Math.PI * k) / n), cy + ry * Math.sin((2 * Math.PI * k) / n)]);
  return { pts, closed: true };
};

/**
 * Read an SVG document into flat shapes. `tolUnits` is the curve flattening tolerance in user
 * units (the caller knows the final scale).
 */
export function parseSvgDocument(text: string, tolUnits: (viewWidth: number) => number = (w) => w / 4000): SvgDocument {
  const root = parseXml(text);
  const svg = root.children.find((c) => c.name === "svg");
  if (!svg) throw new Error("Not an SVG document");
  let minX = 0;
  let minY = 0;
  let width = num(svg.attrs.width, 0);
  let height = num(svg.attrs.height, 0);
  const vb = svg.attrs.viewBox ?? svg.attrs.viewbox;
  if (vb) {
    const v = vb.split(/[\s,]+/).map(Number);
    if (v.length === 4 && v.every(Number.isFinite)) [minX, minY, width, height] = v;
  }
  const unsupported = new Set<string>();

  // Gradients: fill="url(#id)" resolves to the first stop colour.
  const gradients = new Map<string, string>();
  const walkGrad = (n: Node) => {
    if ((n.name === "lineargradient" || n.name === "radialgradient") && n.attrs.id) {
      const stop = n.children.find((c) => c.name === "stop");
      if (stop) {
        const stopStyle: Record<string, string> = {};
        for (const decl of (stop.attrs.style ?? "").split(";")) {
          const [k, ...v] = decl.split(":");
          if (k && v.length) stopStyle[k.trim()] = v.join(":").trim();
        }
        const c = parseColor(stopStyle["stop-color"] ?? stop.attrs["stop-color"]);
        if (c) gradients.set(n.attrs.id, c);
      }
    }
    n.children.forEach(walkGrad);
  };
  walkGrad(svg);

  const tol = tolUnits(width || 1000);
  const shapes: SvgShape[] = [];
  const SKIP = new Set(["defs", "clippath", "mask", "symbol", "pattern", "lineargradient", "radialgradient", "metadata", "title", "desc", "style", "filter", "marker"]);

  const visit = (n: Node, m: Matrix, parent: Style) => {
    if (SKIP.has(n.name)) return;
    const st = styleOf(n.attrs, parent, gradients);
    if (!st.display) return;
    const mm = n.attrs.transform ? multiply(m, parseTransform(n.attrs.transform)) : m;
    let rings: Ring[] | null = null;
    switch (n.name) {
      case "path":
        rings = parsePathData(n.attrs.d ?? "", tol);
        break;
      case "rect": {
        const x = num(n.attrs.x);
        const y = num(n.attrs.y);
        const w = num(n.attrs.width);
        const h = num(n.attrs.height);
        let rx = num(n.attrs.rx, NaN);
        let ry = num(n.attrs.ry, NaN);
        if (Number.isNaN(rx) && Number.isNaN(ry)) rx = ry = 0;
        else if (Number.isNaN(rx)) rx = ry;
        else if (Number.isNaN(ry)) ry = rx;
        rx = Math.min(rx, w / 2);
        ry = Math.min(ry, h / 2);
        if (w > 0 && h > 0) {
          const d =
            rx > 0 || ry > 0
              ? `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
              : `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
          rings = parsePathData(d, tol);
        }
        break;
      }
      case "circle": {
        const r = num(n.attrs.r);
        if (r > 0) rings = [ellipseRing(num(n.attrs.cx), num(n.attrs.cy), r, r)];
        break;
      }
      case "ellipse": {
        const rx = num(n.attrs.rx);
        const ry = num(n.attrs.ry);
        if (rx > 0 && ry > 0) rings = [ellipseRing(num(n.attrs.cx), num(n.attrs.cy), rx, ry)];
        break;
      }
      case "line":
        rings = [{ pts: [[num(n.attrs.x1), num(n.attrs.y1)], [num(n.attrs.x2), num(n.attrs.y2)]], closed: false }];
        break;
      case "polyline":
      case "polygon": {
        const v = (n.attrs.points ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
        const pts: P[] = [];
        for (let k = 0; k + 1 < v.length; k += 2) pts.push([v[k], v[k + 1]]);
        if (pts.length >= 2) rings = [{ pts, closed: n.name === "polygon" }];
        break;
      }
      case "use":
      case "text":
      case "image":
        unsupported.add(`<${n.name}>`);
        break;
    }
    if (rings && rings.length) {
      const scale = Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2]));
      const tr = rings.map((r) => ({ closed: r.closed, pts: r.pts.map((p) => applyMatrix(mm, p)) }));
      const fillable = n.name === "line" ? null : (st.fill ?? null);
      shapes.push({
        rings: tr,
        fill: st.fillOpacity > 0.05 ? fillable : null,
        stroke: st.stroke,
        strokeWidth: st.strokeWidth * scale,
      });
    }
    for (const c of n.children) visit(c, mm, st);
  };

  const rootStyle: Style = { fill: "#000000", stroke: null, strokeWidth: 1, display: true, color: "#000000", fillOpacity: 1 };
  // A viewBox with a non-zero origin is handled by the caller via minX/minY.
  for (const c of svg.children) visit(c, IDENTITY, styleOf(svg.attrs, rootStyle, gradients));
  if (!width || !height) {
    // No size info: use the shapes' bounds.
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const s of shapes) for (const r of s.rings) for (const [px, py] of r.pts) {
      x0 = Math.min(x0, px);
      y0 = Math.min(y0, py);
      x1 = Math.max(x1, px);
      y1 = Math.max(y1, py);
    }
    if (Number.isFinite(x0)) {
      minX = x0;
      minY = y0;
      width = x1 - x0;
      height = y1 - y0;
    }
  }
  return { shapes, minX, minY, width, height, unsupported: [...unsupported] };
}
