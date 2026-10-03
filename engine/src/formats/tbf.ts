/**
 * Tajima TBF. Ported from pyembroidery's TbfWriter.py / TbfReader.py (MIT). A 0x600-byte text header
 * of `\r`-separated `KEY:value` fields (name at 0x83, a 256-byte needle order at 0x10A, the thread
 * list at 0x20E as `0x45 R G B 0x20` records), then 3-byte records `[dx, -dy, command]` in 0.1 mm:
 * 0x80 stitch, 0x90 jump, 0x86 trim, 0x81 needle change, 0x40 stop, 0x8F end, and a final 0x1A.
 *
 * Colours are matched to colour blocks in order (block k gets thread k), as pyembroidery does. A
 * machine picks the needle from the order table, so Lilo numbers needles 1..5 round and round.
 */
import { ByteReader, ByteWriter, FormatError, pyRound, signed8 } from "./io";
import { bounds, intToHex, hexToInt, PatternBuilder } from "./pattern";
import { transcode } from "./transcode";
import type { EmbPattern, EmbThread } from "./types";

const HEADER = 0x600;
const NAME_AT = 0x83;
const ORDER_AT = 0x10a;
const THREADS_AT = 0x20e;
/** Colour blocks the header has room for: the thread list must end before the stitch data. */
export const TBF_MAX_COLORS = Math.floor((HEADER - THREADS_AT) / 5);

export interface TbfWriteOptions {
  label?: string;
}

const num = (n: number, width: number) => String(n).padStart(width, " ");
const intOf = (v: number) => Math.trunc(v);

export function writeTbf(pattern: EmbPattern, options: TbfWriteOptions = {}): Uint8Array {
  const p = transcode(pattern, { maxStitch: 127, maxJump: 127, fullJump: false, threadChange: "needleSet", explicitTrim: true });
  const needleSets = p.stitches.filter((s) => s.cmd === "needleSet");
  if (needleSets.length > TBF_MAX_COLORS) throw new FormatError(`TBF files hold at most ${TBF_MAX_COLORS} colours.`);
  const name = [...(options.label ?? pattern.name ?? "Untitled")]
    .filter((c) => c >= " " && c <= "~")
    .join("")
    .slice(0, 16);
  const b = bounds(p);
  const last = p.stitches[p.stitches.length - 1];
  const ax = last ? intOf(last.x) : 0;
  const ay = last ? -intOf(last.y) : 0;
  const signed = (v: number) => `${v >= 0 ? "+" : "-"}${num(Math.abs(v), 5)}`;

  const w = new ByteWriter();
  w.ascii("3.00").padTo(0x80, 0x20);
  w.ascii(`LA:${(name || "Untitled").padEnd(16, " ")}\r`);
  w.ascii(`ST:${num(p.stitches.length, 7)}\r`);
  w.ascii(`CO:${num(needleSets.length, 3)}\r`);
  w.ascii(`+X:${num(Math.abs(intOf(b.maxX)), 5)}\r`);
  w.ascii(`-X:${num(Math.abs(intOf(b.minX)), 5)}\r`);
  w.ascii(`+Y:${num(Math.abs(intOf(b.maxY)), 5)}\r`);
  w.ascii(`-Y:${num(Math.abs(intOf(b.minY)), 5)}\r`);
  w.ascii(`AX:${signed(ax)}\r`);
  w.ascii(`AY:${signed(ay)}\r`);
  w.ascii(`TP:${"EG/".padEnd(32, " ")}\r`);
  w.ascii("JC:3\r");
  w.ascii("DO:");
  const order = new Array<number>(0x100).fill(0);
  needleSets.forEach((s, i) => {
    order[i] = s.needle ?? 1;
  });
  w.bytes(order).u8(0x0d);
  w.ascii("DA:");
  for (const t of p.threads) {
    const rgb = hexToInt(t.hex);
    w.u8(0x45, rgb >> 16, rgb >> 8, rgb, 0x20);
  }
  w.padTo(0x376, 0x20);
  w.u8(0x0d, 0x1a);
  w.padTo(HEADER, 0x20);

  let xx = 0;
  let yy = 0;
  for (const s of p.stitches) {
    const dx = pyRound(s.x - xx);
    const dy = pyRound(s.y - yy);
    xx += dx;
    yy += dy;
    const rec = (cmd: number) => w.u8(dx & 0xff, -dy & 0xff, cmd);
    if (s.cmd === "stitch") rec(0x80);
    else if (s.cmd === "jump") rec(0x90);
    else if (s.cmd === "stop") rec(0x40);
    else if (s.cmd === "trim") rec(0x86);
    else if (s.cmd === "needleSet") rec(0x81);
    else if (s.cmd === "end") {
      rec(0x8f);
      break;
    }
  }
  w.u8(0x1a);
  return w.done();
}

export function readTbf(bytes: Uint8Array): EmbPattern {
  if (bytes.length < HEADER) throw new FormatError("This is too small to be a TBF file.");
  const r = new ByteReader(bytes, "TBF file");
  if (String.fromCharCode(bytes[0x80], bytes[0x81], bytes[0x82]) !== "LA:") throw new FormatError("This is not a TBF file (no design header).");
  const out = new PatternBuilder();
  const name = String.fromCharCode(...bytes.subarray(NAME_AT, NAME_AT + 16).filter((c) => c >= 0x20 && c < 0x7f)).trim();
  if (name) out.name = name;
  const order = bytes.subarray(ORDER_AT, ORDER_AT + 0x100);
  const threads: EmbThread[] = [];
  for (let at = THREADS_AT; at + 5 <= HEADER && bytes[at] === 0x45; at += 5) {
    threads.push({ hex: intToHex((bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) });
  }

  r.seek(HEADER);
  let needle = 0;
  while (r.remaining >= 3) {
    const x = r.u8();
    const y = r.u8();
    const ctrl = r.u8();
    if (ctrl === 0x80) out.stitch(signed8(x), -signed8(y));
    else if (ctrl === 0x81) {
      if (needle >= order.length) throw new FormatError("This TBF file is corrupt (too many colour changes).");
      const value = order[needle++];
      if (value === 0) out.stop();
      else out.needleChange(value);
    } else if (ctrl === 0x90) {
      if (x === 0 && y === 0) out.trim();
      else out.move(signed8(x), -signed8(y));
    } else if (ctrl === 0x40) out.stop();
    else if (ctrl === 0x86) out.trim();
    else break; // 0x8F = end, anything else is unknown
  }
  out.end();
  for (const t of threads) out.addThread(t);
  return out.build();
}
