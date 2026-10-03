/**
 * Husqvarna Viking HUS and Pfaff/Viking VIP. Container layout from Jason Weiler's "HUS and VIP File
 * Formats" notes (jasonweiler.com), the reader from pyembroidery's HusReader.py (MIT) and
 * libembroidery's format-hus / format-vip (zlib licence). Both files are a header, a colour table and
 * three separately compressed streams of one byte per record: the command, then x and y deltas
 * (signed, 0.1 mm). The compression is in `hus-compress.ts`.
 *
 *   0x00 magic (HUS 5B AF C8 00, VIP 5D FC 90 01)   0x04 record count   0x08 colour count
 *   0x0C +X, +Y, -X, -Y extents (i16, 0.1 mm)       0x14 offsets of the command, x and y streams
 *   0x20 8-byte label   0x28 u16 unknown
 *   HUS  0x2A  one u16 per colour, an index into Husqvarna's 29-colour table
 *   VIP  0x2A  u32 (4 x colours), 0x2E  4 bytes per colour, RGB0 behind a fixed XOR table, then a
 *        record of (colours + 1) u32 = 1, a u32 0 and a u16 0 before the command stream
 *
 * Commands: 0x80 stitch, 0x81 jump, 0x84 colour change, 0x88 trim, 0x90 end.
 */
import { deltaE2000, hexToRgb, rgbToLab, type Lab } from "../color";
import { compressLiterals, expand } from "./hus-compress";
import { ByteReader, ByteWriter, FormatError, pyRound, signed8 } from "./io";
import { bounds, intToHex, PatternBuilder, threadOrFiller } from "./pattern";
import { transcode } from "./transcode";
import type { EmbPattern, EmbThread } from "./types";

export const HUS_MAGIC = 0x00c8af5b;
export const VIP_MAGIC = 0x0190fc5d;
/** Declared stitch counts above this are refused (they would allocate three buffers of that size). */
const MAX_RECORDS = 4_000_000;
const HUS_HEADER = 0x2a;
const VIP_HEADER = 0x2e;

const CMD_STITCH = 0x80;
const CMD_JUMP = 0x81;
const CMD_COLOR = 0x84;
const CMD_TRIM = 0x88;
const CMD_END = 0x90;

/** Husqvarna's 29 thread colours, indexed as the HUS colour table stores them. [rgb, name, number] */
const HUS_COLORS: readonly (readonly [number, string, string])[] = [
  [0x000000, "Black", "026"], [0x0000e7, "Blue", "005"], [0x00c600, "Green", "002"], [0xff0000, "Red", "014"],
  [0x840084, "Purple", "008"], [0xffff00, "Yellow", "020"], [0x848484, "Grey", "024"], [0x8484e7, "Light Blue", "006"],
  [0x00ff84, "Light Green", "003"], [0xff7b31, "Orange", "017"], [0xff8ca5, "Pink", "011"], [0x845200, "Brown", "028"],
  [0xffffff, "White", "022"], [0x000084, "Dark Blue", "004"], [0x008400, "Dark Green", "001"], [0x7b0000, "Dark Red", "013"],
  [0xff6384, "Light Red", "015"], [0x522952, "Dark Purple", "007"], [0xff00ff, "Light Purple", "009"],
  [0xffde00, "Dark Yellow", "019"], [0xffff9c, "Light Yellow", "021"], [0x525252, "Dark Grey", "025"],
  [0xd6d6d6, "Light Grey", "023"], [0xff5208, "Dark Orange", "016"], [0xff9c5a, "Light Orange", "018"],
  [0xff52b5, "Dark Pink", "010"], [0xffc6de, "Light Pink", "012"], [0x523100, "Dark Brown", "027"],
  [0xb5a584, "Light Brown", "029"],
];
const HUS_LABS: Lab[] = HUS_COLORS.map((c) => rgbToLab(...hexToRgb(intToHex(c[0]))));

function nearestHus(hex: string): number {
  const lab = rgbToLab(...hexToRgb(hex));
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < HUS_LABS.length; i++) {
    const d = deltaE2000(lab, HUS_LABS[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** The fixed XOR table VIP colours are scrambled with (100 colours at most). */
const VIP_TABLE = new Uint8Array([
  0x2e, 0x82, 0xe4, 0x6f, 0x38, 0xa9, 0xdc, 0xc6, 0x7b, 0xb6, 0x28, 0xac, 0xfd, 0xaa, 0x8a, 0x4e,
  0x76, 0x2e, 0xf0, 0xe4, 0x25, 0x1b, 0x8a, 0x68, 0x4e, 0x92, 0xb9, 0xb4, 0x95, 0xf0, 0x3e, 0xef,
  0xf7, 0x40, 0x24, 0x18, 0x39, 0x31, 0xbb, 0xe1, 0x53, 0xa8, 0x1f, 0xb1, 0x3a, 0x07, 0xfb, 0xcb,
  0xe6, 0x00, 0x81, 0x50, 0x0e, 0x40, 0xe1, 0x2c, 0x73, 0x50, 0x0d, 0x91, 0xd6, 0x0a, 0x5d, 0xd6,
  0x8b, 0xb8, 0x62, 0xae, 0x47, 0x00, 0x53, 0x5a, 0xb7, 0x80, 0xaa, 0x28, 0xf7, 0x5d, 0x70, 0x5e,
  0x2c, 0x0b, 0x98, 0xe3, 0xa0, 0x98, 0x60, 0x47, 0x89, 0x9b, 0x82, 0xfb, 0x40, 0xc9, 0xb4, 0x00,
  0x0e, 0x68, 0x6a, 0x1e, 0x09, 0x85, 0xc0, 0x53, 0x81, 0xd1, 0x98, 0x89, 0xaf, 0xe8, 0x85, 0x4f,
  0xe3, 0x69, 0x89, 0x03, 0xa1, 0x2e, 0x8f, 0xcf, 0xed, 0x91, 0x9f, 0x58, 0x1e, 0xd6, 0x84, 0x3c,
  0x09, 0x27, 0xbd, 0xf4, 0xc3, 0x90, 0xc0, 0x51, 0x1b, 0x2b, 0x63, 0xbc, 0xb9, 0x3d, 0x40, 0x4d,
  0x62, 0x6f, 0xe0, 0x8c, 0xf5, 0x5d, 0x08, 0xfd, 0x3d, 0x50, 0x36, 0xd7, 0xc9, 0xc9, 0x43, 0xe4,
  0x2d, 0xcb, 0x95, 0xb6, 0xf4, 0x0d, 0xea, 0xc2, 0xfd, 0x66, 0x3f, 0x5e, 0xbd, 0x69, 0x06, 0x2a,
  0x03, 0x19, 0x47, 0x2b, 0xdf, 0x38, 0xea, 0x4f, 0x80, 0x49, 0x95, 0xb2, 0xd6, 0xf9, 0x9a, 0x75,
  0xf4, 0xd8, 0x9b, 0x1d, 0xb0, 0xa4, 0x69, 0xdb, 0xa9, 0x21, 0x79, 0x6f, 0xd8, 0xde, 0x33, 0xfe,
  0x9f, 0x04, 0xe5, 0x9a, 0x6b, 0x9b, 0x73, 0x83, 0x62, 0x7c, 0xb9, 0x66, 0x76, 0xf2, 0x5b, 0xc9,
  0x5e, 0xfc, 0x74, 0xaa, 0x6c, 0xf1, 0xcd, 0x93, 0xce, 0xe9, 0x80, 0x53, 0x03, 0x3b, 0x97, 0x4b,
  0x39, 0x76, 0xc2, 0xc1, 0x56, 0xcb, 0x70, 0xfd, 0x3b, 0x3e, 0x52, 0x57, 0x81, 0x5d, 0x56, 0x8d,
  0x51, 0x90, 0xd4, 0x76, 0xd7, 0xd5, 0x16, 0x02, 0x6d, 0xf2, 0x4d, 0xe1, 0x0e, 0x96, 0x4f, 0xa1,
  0x3a, 0xa0, 0x60, 0x59, 0x64, 0x04, 0x1a, 0xe4, 0x67, 0xb6, 0xed, 0x3f, 0x74, 0x20, 0x55, 0x1f,
  0xfb, 0x23, 0x92, 0x91, 0x53, 0xc8, 0x65, 0xab, 0x9d, 0x51, 0xd6, 0x73, 0xde, 0x01, 0xb1, 0x80,
  0xb7, 0xc0, 0xd6, 0x80, 0x1c, 0x2e, 0x3c, 0x83, 0x63, 0xee, 0xbc, 0x33, 0x25, 0xe2, 0x0e, 0x7a,
  0x67, 0xde, 0x3f, 0x71, 0x14, 0x49, 0x9c, 0x92, 0x93, 0x0d, 0x26, 0x9a, 0x0e, 0xda, 0xed, 0x6f,
  0xa4, 0x89, 0x0c, 0x1b, 0xf0, 0xa1, 0xdf, 0xe1, 0x9e, 0x3c, 0x04, 0x78, 0xe4, 0xab, 0x6d, 0xff,
  0x9c, 0xaf, 0xca, 0xc7, 0x88, 0x17, 0x9c, 0xe5, 0xb7, 0x33, 0x6d, 0xdc, 0xed, 0x8f, 0x6c, 0x18,
  0x1d, 0x71, 0x06, 0xb1, 0xc5, 0xe2, 0xcf, 0x13, 0x77, 0x81, 0xc5, 0xb7, 0x0a, 0x14, 0x0a, 0x6b,
  0x40, 0x26, 0xa0, 0x88, 0xd1, 0x62, 0x6a, 0xb3, 0x50, 0x12, 0xb9, 0x9b, 0xb5, 0x83, 0x9b, 0x37,
]);
export const VIP_MAX_COLORS = VIP_TABLE.length / 4;

const clampI16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));

export interface HusWriteOptions {
  label?: string;
}

/** Printable-ASCII label cut to `n` characters (the file has a fixed slot). */
const labelBytes = (label: string | undefined, n: number): number[] =>
  [...(label ?? "")]
    .map((c) => c.charCodeAt(0))
    .filter((c) => c >= 0x20 && c < 0x7f)
    .slice(0, n);

function writeLike(pattern: EmbPattern, vip: boolean, options: HusWriteOptions): Uint8Array {
  const p = transcode(pattern, { maxStitch: 127, maxJump: 127, fullJump: true, threadChange: "colorChange" });
  const cmds: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  const palette: EmbThread[] = [];
  let xx = 0;
  let yy = 0;
  for (const s of p.stitches) {
    const dx = pyRound(s.x - xx);
    const dy = pyRound(s.y - yy);
    xx += dx;
    yy += dy;
    let cmd: number;
    if (s.cmd === "stitch") cmd = CMD_STITCH;
    else if (s.cmd === "jump") cmd = CMD_JUMP;
    else if (s.cmd === "colorChange" || s.cmd === "stop") cmd = CMD_COLOR;
    else if (s.cmd === "trim") cmd = CMD_TRIM;
    else if (s.cmd === "end") cmd = CMD_END;
    else continue;
    if (palette.length === 0) palette.push(threadOrFiller(p, 0));
    if (cmd === CMD_COLOR) palette.push(threadOrFiller(p, palette.length));
    cmds.push(cmd);
    xs.push(dx & 0xff);
    ys.push(-dy & 0xff);
    if (cmd === CMD_END) break;
  }
  if (palette.length === 0) palette.push(threadOrFiller(p, 0));
  if (vip && palette.length > VIP_MAX_COLORS) throw new FormatError(`VIP files hold at most ${VIP_MAX_COLORS} colours.`);
  if (palette.length > 0xffff) throw new FormatError("Too many colour changes for this format.");

  const cs = compressLiterals(Uint8Array.from(cmds));
  const xz = compressLiterals(Uint8Array.from(xs));
  const yz = compressLiterals(Uint8Array.from(ys));
  const n = palette.length;
  const first = vip ? VIP_HEADER + 4 * n + 4 * (n + 1) + 6 : HUS_HEADER + 2 * n;
  const w = new ByteWriter();
  w.u32le(vip ? VIP_MAGIC : HUS_MAGIC).u32le(cmds.length).u32le(n);
  const b = bounds(p);
  w.u16le(clampI16(b.maxX)).u16le(clampI16(-b.minY)).u16le(clampI16(b.minX)).u16le(clampI16(-b.maxY));
  w.u32le(first).u32le(first + cs.length).u32le(first + cs.length + xz.length);
  w.bytes(vip ? [] : labelBytes(options.label ?? pattern.name, 8)).padTo(0x28, 0x00);
  w.u16le(0);
  if (vip) {
    w.u32le(4 * n);
    let prev = 0;
    for (let i = 0; i < 4 * n; i++) {
      const rgb = hexToRgb(palette[i >> 2].hex);
      const plain = (i & 3) < 3 ? rgb[i & 3] : 0;
      prev = plain ^ VIP_TABLE[i] ^ prev;
      w.u8(prev);
    }
    for (let i = 0; i <= n; i++) w.u32le(1);
    w.u32le(0).u16le(0);
  } else {
    for (const t of palette) w.u16le(nearestHus(t.hex));
  }
  w.bytes(cs).bytes(xz).bytes(yz);
  return w.done();
}

/** Husqvarna Viking HUS. Colours become the nearest of Husqvarna's 29. */
export const writeHus = (pattern: EmbPattern, options: HusWriteOptions = {}): Uint8Array => writeLike(pattern, false, options);
/** Pfaff/Viking VIP. Stores exact RGB colours. */
export const writeVip = (pattern: EmbPattern, options: HusWriteOptions = {}): Uint8Array => writeLike(pattern, true, options);

function readLike(bytes: Uint8Array, vip: boolean): EmbPattern {
  const kind = vip ? "VIP" : "HUS";
  const headerSize = vip ? VIP_HEADER : HUS_HEADER;
  if (bytes.length < headerSize) throw new FormatError(`This is too small to be a ${kind} file.`);
  const r = new ByteReader(bytes, `${kind} file`);
  if (r.u32le() !== (vip ? VIP_MAGIC : HUS_MAGIC)) throw new FormatError(`This is not a ${kind} file (wrong signature).`);
  const count = r.u32le();
  const colors = r.u32le();
  r.skip(8);
  const cmdAt = r.u32le();
  const xAt = r.u32le();
  const yAt = r.u32le();
  if (count === 0 || count > MAX_RECORDS) throw new FormatError(`This ${kind} file is corrupt (bad stitch count).`);
  if (vip ? colors > VIP_MAX_COLORS : colors > 4096) throw new FormatError(`This ${kind} file is corrupt (bad colour count).`);
  if (!(headerSize <= cmdAt && cmdAt <= xAt && xAt <= yAt && yAt <= bytes.length)) {
    throw new FormatError(`This ${kind} file is corrupt (bad stream offsets).`);
  }
  const label = vip ? "" : String.fromCharCode(...bytes.subarray(0x20, 0x28).filter((c) => c >= 0x20 && c < 0x7f)).trim();

  const threads: EmbThread[] = [];
  if (vip) {
    r.seek(0x2e);
    const enc = r.bytes(4 * colors);
    let prev = 0;
    const plain = new Uint8Array(enc.length);
    for (let i = 0; i < enc.length; i++) {
      plain[i] = enc[i] ^ VIP_TABLE[i] ^ prev;
      prev = enc[i];
    }
    for (let i = 0; i < colors; i++) threads.push({ hex: intToHex((plain[4 * i] << 16) | (plain[4 * i + 1] << 8) | plain[4 * i + 2]) });
  } else {
    r.seek(HUS_HEADER);
    for (let i = 0; i < colors; i++) {
      const c = HUS_COLORS[r.u16le()];
      if (!c) throw new FormatError("This HUS file is corrupt (unknown thread colour).");
      threads.push({ hex: intToHex(c[0]), name: c[1], code: c[2], brand: "Husqvarna" });
    }
  }

  const cmd = expand(bytes.subarray(cmdAt, xAt), count);
  const xs = expand(bytes.subarray(xAt, yAt), count);
  const ys = expand(bytes.subarray(yAt), count);
  if (cmd.length < count || xs.length < count || ys.length < count) throw new FormatError(`The ${kind} file ends unexpectedly.`);

  const out = new PatternBuilder();
  for (let i = 0; i < count; i++) {
    const dx = signed8(xs[i]);
    const dy = -signed8(ys[i]);
    const c = cmd[i];
    if (c === CMD_STITCH) out.stitch(dx, dy);
    else if (c === CMD_JUMP) out.move(dx, dy);
    else if (c === CMD_COLOR) out.colorChange(dx, dy);
    else if (c === CMD_TRIM) {
      if (dx !== 0 || dy !== 0) out.move(dx, dy);
      out.trim();
    } else break; // 0x90 = end, anything else is unknown
  }
  out.end();
  for (const t of threads) out.addThread(t);
  if (label) out.name = label;
  return out.build();
}

export const readHus = (bytes: Uint8Array): EmbPattern => readLike(bytes, false);
export const readVip = (bytes: Uint8Array): EmbPattern => readLike(bytes, true);
