/**
 * Janome JEF. Ported from pyembroidery's JefWriter.py / JefReader.py / EmbThreadJef.py (MIT).
 * Header with a palette of Janome colour slots, then byte pairs (dx, -dy) in 0.1 mm with `80 xx`
 * escapes: 01 colour change, 02 jump, 10 end.
 */
import { deltaE2000, hexToRgb, rgbToLab, type Lab } from "../color";
import { ByteReader, ByteWriter, FormatError, pyRound, signed8 } from "./io";
import { bounds, intToHex, interpolateTrims, PatternBuilder, threadOrFiller } from "./pattern";
import { transcode } from "./transcode";
import type { EmbPattern, EmbThread } from "./types";

/** Janome's 78 fixed thread colours; slot 0 is a placeholder ("stop"). [rgb, name, catalogue number] */
const JEF_COLORS: readonly (readonly [number, string, string] | null)[] = [
  null,
  [0x000000, "Black", "002"], [0xffffff, "White", "001"], [0xffff17, "Yellow", "204"], [0xff6600, "Orange", "203"],
  [0x2f5933, "Olive Green", "219"], [0x237336, "Green", "226"], [0x65c2c8, "Sky", "217"], [0xab5a96, "Purple", "208"],
  [0xf669a0, "Pink", "201"], [0xff0000, "Red", "225"], [0xb1704e, "Brown", "214"], [0x0b2f84, "Blue", "207"],
  [0xe4c35d, "Gold", "003"], [0x481a05, "Dark Brown", "205"], [0xac9cc7, "Pale Violet", "209"],
  [0xfcf294, "Pale Yellow", "210"], [0xf999b7, "Pale Pink", "211"], [0xfab381, "Peach", "212"],
  [0xc9a480, "Beige", "213"], [0x970533, "Wine Red", "215"], [0xa0b8cc, "Pale Sky", "216"],
  [0x7fc21c, "Yellow Green", "218"], [0xe5e5e5, "Silver Gray", "220"], [0x889b9b, "Gray", "221"],
  [0x98d6bd, "Pale Aqua", "227"], [0xb2e1e3, "Baby Blue", "228"], [0x368ba0, "Powder Blue", "229"],
  [0x4f83ab, "Bright Blue", "230"], [0x386a91, "Slate Blue", "231"], [0x071650, "Navy Blue", "232"],
  [0xf999a2, "Salmon Pink", "233"], [0xf9676b, "Coral", "234"], [0xe3311f, "Burnt Orange", "235"],
  [0xe2a188, "Cinnamon", "236"], [0xb59474, "Umber", "237"], [0xe4cf99, "Blond", "238"],
  [0xffcb00, "Sunflower", "239"], [0xe1add4, "Orchid Pink", "240"], [0xc3007e, "Peony Purple", "241"],
  [0x80004b, "Burgundy", "242"], [0x540571, "Royal Purple", "243"], [0xb10525, "Cardinal Red", "244"],
  [0xcae0c0, "Opal Green", "245"], [0x899856, "Moss Green", "246"], [0x5c941a, "Meadow Green", "247"],
  [0x003114, "Dark Green", "248"], [0x5dae94, "Aquamarine", "249"], [0x4cbf8f, "Emerald Green", "250"],
  [0x007772, "Peacock Green", "251"], [0x595b61, "Dark Gray", "252"], [0xfffff2, "Ivory White", "253"],
  [0xb15818, "Hazel", "254"], [0xcb8a07, "Toast", "255"], [0x986c80, "Salmon", "256"],
  [0x98692d, "Cocoa Brown", "257"], [0x4d3419, "Sienna", "258"], [0x4c330b, "Sepia", "259"],
  [0x33200a, "Dark Sepia", "260"], [0x523a97, "Violet Blue", "261"], [0x0d217e, "Blue Ink", "262"],
  [0x1e77ac, "Sola Blue", "263"], [0xb2dd53, "Green Dust", "264"], [0xf33689, "Crimson", "265"],
  [0xde649e, "Floral Pink", "266"], [0x984161, "Wine", "267"], [0x4c5612, "Olive Drab", "268"],
  [0x4c881f, "Meadow", "269"], [0xe4de79, "Mustard", "270"], [0xcb8a1a, "Yellow Ocher", "271"],
  [0xcba21c, "Old Gold", "272"], [0xff9805, "Honey Dew", "273"], [0xfcb257, "Tangerine", "274"],
  [0xffe505, "Canary Yellow", "275"], [0xf0331f, "Vermilion", "202"], [0x1a842d, "Bright Green", "206"],
  [0x386cae, "Ocean Blue", "222"], [0xe3c4b4, "Beige Gray", "223"], [0xe3ac81, "Bamboo", "224"],
];

const JEF_LABS: (Lab | null)[] = JEF_COLORS.map((c) => (c ? rgbToLab(...hexToRgb(intToHex(c[0]))) : null));

/** Janome slot (1..78) closest to `hex`; `exclude` is skipped (used to avoid two identical neighbours). */
function nearestJef(hex: string, exclude = -1): number {
  const lab = rgbToLab(...hexToRgb(hex));
  let best = 1;
  let bestD = Infinity;
  for (let i = 1; i < JEF_LABS.length; i++) {
    if (i === exclude) continue;
    const d = deltaE2000(lab, JEF_LABS[i] as Lab);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

const HOOP_110X110 = 0;
const HOOP_50X50 = 1;
const HOOP_140X200 = 2;
const HOOP_126X110 = 3;
const HOOP_200X200 = 4;

function hoopSize(w: number, h: number): number {
  if (w < 500 && h < 500) return HOOP_50X50;
  if (w < 1260 && h < 1100) return HOOP_126X110;
  if (w < 1400 && h < 2000) return HOOP_140X200;
  if (w < 2000 && h < 2000) return HOOP_200X200;
  return HOOP_110X110;
}

export interface JefWriteOptions {
  /** 14 digits, `YYYYMMDDhhmmss`. Default: now. Pass a fixed value for reproducible bytes. */
  date?: string;
}

function nowStamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getFullYear(), 4)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function writeJef(pattern: EmbPattern, options: JefWriteOptions = {}): Uint8Array {
  const p = transcode(pattern, { maxStitch: 127, maxJump: 127, fullJump: true, threadChange: "colorChange" });
  const out = new ByteWriter();

  // Palette: one Janome slot per colour block; two neighbours must not share a slot.
  const palette: number[] = [];
  let lastIndex = -1;
  let lastHex = "";
  let colorCount = 0;
  let blocks = 0;
  for (const s of p.stitches) {
    if (s.cmd === "colorChange" || blocks === 0) {
      const t = threadOrFiller(p, blocks);
      blocks++;
      colorCount++;
      let idx = nearestJef(t.hex);
      if (idx === lastIndex && t.hex !== lastHex) idx = nearestJef(t.hex, idx);
      palette.push(idx);
      lastIndex = idx;
      lastHex = t.hex;
    }
  }
  if (colorCount === 0) {
    colorCount = 1;
    palette.push(nearestJef(threadOrFiller(p, 0).hex));
  }

  out.u32le(0x74 + colorCount * 8);
  out.u32le(0x14);
  out.ascii(options.date ?? nowStamp());
  out.u8(0, 0);
  out.u32le(colorCount);
  let points = 1;
  for (const s of p.stitches) {
    if (s.cmd === "stitch") points += 1;
    else if (s.cmd === "jump") points += 2;
    else if (s.cmd === "colorChange" || s.cmd === "stop") points += 2;
    else if (s.cmd === "end") break;
  }
  out.u32le(points);
  const b = bounds(p);
  const w = pyRound(b.maxX - b.minX);
  const h = pyRound(b.maxY - b.minY);
  out.u32le(hoopSize(w, h));
  const hw = pyRound(w / 2);
  const hh = pyRound(h / 2);
  out.u32le(hw).u32le(hh).u32le(hw).u32le(hh);
  const edge = (cx: number, cy: number) => {
    const x = cx - hw;
    const y = cy - hh;
    if (Math.min(x, y) >= 0) out.u32le(x).u32le(y).u32le(x).u32le(y);
    else out.u32le(-1).u32le(-1).u32le(-1).u32le(-1);
  };
  edge(550, 550);
  edge(250, 250);
  edge(700, 1000);
  edge(700, 1000);
  for (const t of palette) out.u32le(t);
  for (let i = 0; i < colorCount; i++) out.u32le(0x0d);

  let xx = 0;
  let yy = 0;
  for (const s of p.stitches) {
    const dx = pyRound(s.x - xx);
    const dy = pyRound(s.y - yy);
    xx += dx;
    yy += dy;
    if (s.cmd === "stitch") out.u8(dx, -dy);
    else if (s.cmd === "colorChange" || s.cmd === "stop") out.u8(0x80, 0x01, dx, -dy);
    else if (s.cmd === "jump") out.u8(0x80, 0x02, dx, -dy);
    else if (s.cmd === "end") break;
    // trims: JEF machines trim on long jumps; no explicit record (pyembroidery default)
  }
  out.u8(0x80, 0x10);
  return out.done();
}

export function readJef(bytes: Uint8Array): EmbPattern {
  const r = new ByteReader(bytes, "JEF file");
  if (bytes.length < 0x74) throw new FormatError("This is too small to be a JEF file.");
  const stitchOffset = r.u32le();
  r.skip(20);
  const colorCount = r.u32le();
  if (colorCount > 4096 || stitchOffset > bytes.length) throw new FormatError("This JEF file is corrupt.");
  r.skip(88);
  const out = new PatternBuilder();
  /** null = a "stop" placeholder (Janome slot 0). */
  const threads: (EmbThread | null)[] = [];
  for (let i = 0; i < colorCount; i++) {
    const index = Math.abs(r.u32le() | 0);
    const c = index === 0 ? null : JEF_COLORS[index % JEF_COLORS.length];
    threads.push(
      index === 0 || !c ? null : { hex: intToHex(c[0]), name: c[1], code: c[2], brand: "Janome" },
    );
  }
  r.seek(stitchOffset);
  let colorIndex = 1;
  while (r.remaining >= 2) {
    const a = r.u8();
    const b = r.u8();
    if (a !== 0x80) {
      out.stitch(signed8(a), -signed8(b));
      continue;
    }
    if (r.remaining < 2) break;
    const x = signed8(r.u8());
    const y = -signed8(r.u8());
    if (b === 0x02) out.move(x, y);
    else if (b === 0x01) {
      if (threads[colorIndex] === null) {
        out.stop(0, 0);
        threads.splice(colorIndex, 1);
      } else {
        out.colorChange(0, 0);
        colorIndex++;
      }
    } else break; // 0x10 = end; anything else is unknown
  }
  out.end(0, 0);
  // stops don't consume a thread, so the surviving list lines up with the colour blocks
  for (const t of threads) if (t) out.addThread(t);
  const pattern = out.build();
  return { ...pattern, stitches: interpolateTrims(pattern.stitches, null, 30, true) };
}
