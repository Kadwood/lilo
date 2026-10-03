/**
 * Barudan U01. Ported from pyembroidery's U01Writer.py / U01Reader.py (MIT). A 256-byte header, then
 * 3-byte records `[control, |dy|, |dx|]` in 0.1 mm; the control byte holds sign bits (0x40 dy>=0,
 * 0x20 dx<=0) and the command in its low 5 bits (0 stitch, 1 jump, 7 trim, 8 stop, 9..23 needle
 * 1..15, 0x18 end). Colour changes are needle selections, so the colours themselves are not stored.
 */
import { ByteReader, ByteWriter, FormatError, pyRound } from "./io";
import { bounds, PatternBuilder } from "./pattern";
import { transcode } from "./transcode";
import type { EmbPattern } from "./types";

export function writeU01(pattern: EmbPattern): Uint8Array {
  const p = transcode(pattern, { maxStitch: 127, maxJump: 127, fullJump: false, threadChange: "needleSet" });
  const w = new ByteWriter();
  w.fill(0x30, 0x80); // ASCII "0"s
  if (p.stitches.length === 0) return w.done();
  const b = bounds(p);
  const last = p.stitches[p.stitches.length - 1];
  w.u16le(Math.trunc(b.minX));
  w.u16le(-Math.trunc(b.maxY));
  w.u16le(Math.trunc(b.maxX));
  w.u16le(-Math.trunc(b.minY));
  w.u32le(0);
  w.u32le(p.stitches.length + 1);
  w.u16le(Math.trunc(last.x));
  w.u16le(-Math.trunc(last.y));
  w.padTo(0x100, 0x00);

  let xx = 0;
  let yy = 0;
  for (const s of p.stitches) {
    const dx = pyRound(s.x - xx);
    const dy = pyRound(s.y - yy);
    xx += dx;
    yy += dy;
    let cmd = 0x80;
    if (dy >= 0) cmd |= 0x40;
    if (dx <= 0) cmd |= 0x20;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (s.cmd === "stitch") w.u8(cmd, ay, ax);
    else if (s.cmd === "jump") w.u8(cmd | 0x01, ay, ax);
    else if (s.cmd === "stop") w.u8(cmd | 0x08, ay, ax);
    else if (s.cmd === "trim") w.u8(cmd | 0x07, ay, ax);
    else if (s.cmd === "needleSet") {
      let needle = s.needle ?? 1;
      if (needle >= 15) needle = (needle % 15) + 1;
      w.u8((cmd | 0x08) + needle, ay, ax);
    } else if (s.cmd === "end") break;
  }
  w.u8(0xf8, 0x00, 0x00);
  return w.done();
}

export function readU01(bytes: Uint8Array): EmbPattern {
  if (bytes.length < 0x100) throw new FormatError("This is too small to be a U01 file.");
  const r = new ByteReader(bytes, "U01 file");
  r.seek(0x100);
  const out = new PatternBuilder();
  while (r.remaining >= 3) {
    const ctrl = r.u8();
    let dy = -r.u8();
    let dx = r.u8();
    if (ctrl & 0x20) dx = -dx;
    if (ctrl & 0x40) dy = -dy;
    const command = ctrl & 0b11111;
    const moved = dx !== 0 || dy !== 0;
    if (command === 0x00) out.stitch(dx, dy);
    else if (command === 0x01) out.move(dx, dy);
    else if (command === 0x02 || command === 0x04) {
      if (moved) out.stitch(dx, dy); // fast / slow speed hints
    } else if (command === 0x03 || command === 0x05) {
      if (moved) out.move(dx, dy);
    } else if (command === 0x06 || command === 0x07) {
      out.trim();
      if (moved) out.move(dx, dy);
    } else if (command === 0x08) {
      out.stop();
      if (moved) out.move(dx, dy);
    } else if (command >= 0x09 && command <= 0x17) {
      out.needleChange(command - 0x08);
      if (moved) out.move(dx, dy);
    } else break; // 0x18 = end, anything else is unknown
  }
  out.end();
  return out.build();
}
