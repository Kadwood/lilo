/**
 * Singer XXX. Ported from pyembroidery's XxxWriter.py / XxxReader.py (MIT). A 256-byte header,
 * byte-pair stitches (dx, -dy) in 0.1 mm with `7F xx` escapes (01 jump, 03 trim, 08 colour change,
 * 7F 7F 02 14 end, 7D = 16-bit long move), then the colour table as 0x00RRGGBB.
 */
import { ByteReader, ByteWriter, FormatError, pyRound, signed16, signed8 } from "./io";
import { bounds, hexToInt, intToHex, PatternBuilder } from "./pattern";
import { transcode } from "./transcode";
import type { EmbPattern } from "./types";

export function writeXxx(pattern: EmbPattern): Uint8Array {
  // 123, not 124: the short form below is strict (|d| < 124), so a leg of exactly 124 would be written
  // long-form (0x7D) and read back as a JUMP.
  const p = transcode(pattern, { maxStitch: 123, maxJump: 124, fullJump: false, threadChange: "colorChange" });
  if (p.stitches.length < 2) throw new FormatError("Nothing to export: the design has no stitches.");
  const w = new ByteWriter();
  const last = p.stitches[p.stitches.length - 1];
  const b = bounds(p);
  w.fill(0, 0x17);
  w.u32le(p.stitches.length - 1);
  w.fill(0, 0x0c);
  w.u32le(p.threads.length);
  w.u16le(0);
  w.u16le(Math.trunc(b.maxX - b.minX));
  w.u16le(Math.trunc(b.maxY - b.minY));
  w.u16le(Math.trunc(last.x));
  w.u16le(Math.trunc(-last.y));
  w.u16le(Math.trunc(-b.minX));
  w.u16le(Math.trunc(b.maxY));
  w.fill(0, 0x42);
  w.u16le(0).u16le(0);
  w.fill(0, 0x73);
  w.u16le(0x20);
  w.fill(0, 0x08);
  const endAt = w.length;
  w.u32le(0);

  let xx = 0;
  let yy = 0;
  for (const s of p.stitches) {
    const dx = pyRound(s.x - xx);
    const dy = pyRound(s.y - yy);
    xx += dx;
    yy += dy;
    if (s.cmd === "colorChange" || s.cmd === "stop") w.u8(0x7f, 0x08, dx, -dy);
    else if (s.cmd === "end") break;
    else if (s.cmd === "stitch") {
      if (dx > -124 && dx < 124 && dy > -124 && dy < 124) w.u8(dx, -dy);
      else w.u8(0x7d).u16le(dx).u16le(-dy);
    } else if (s.cmd === "trim") w.u8(0x7f, 0x03, dx, -dy);
    else if (s.cmd === "jump") w.u8(0x7f, 0x01, dx, -dy);
  }
  w.patch32le(endAt, w.length);
  w.u8(0x7f, 0x7f, 0x02, 0x14);
  w.u8(0, 0);
  p.threads.forEach((t) => w.u8(0).u24be(hexToInt(t.hex)));
  for (let i = 0; i < 21 - p.threads.length; i++) w.u32le(0);
  w.u32le(0xffffff00);
  w.u8(0x00, 0x01);
  return w.done();
}

export function readXxx(bytes: Uint8Array): EmbPattern {
  if (bytes.length < 0x104) throw new FormatError("This is too small to be an XXX file.");
  const r = new ByteReader(bytes, "XXX file");
  r.skip(0x27);
  const colors = r.u16le();
  r.seek(0x100);
  const out = new PatternBuilder();
  for (;;) {
    if (r.remaining < 2) break;
    const b1 = r.u8();
    if (b1 === 0x7d || b1 === 0x7e) {
      if (r.remaining < 4) break;
      const x = r.u16le();
      const y = r.u16le();
      out.move(signed16(x), -signed16(y));
      continue;
    }
    const b2 = r.u8();
    if (b1 !== 0x7f) {
      out.stitch(signed8(b1), -signed8(b2));
      continue;
    }
    if (r.remaining < 2) break;
    const b3 = r.u8();
    const b4 = r.u8();
    if (b2 === 0x01) out.move(signed8(b3), -signed8(b4));
    else if (b2 === 0x03) {
      out.trim();
      const x = signed8(b3);
      const y = -signed8(b4);
      if (x !== 0 || y !== 0) out.move(x, y);
    } else if (b2 === 0x08 || (b2 >= 0x0a && b2 <= 0x17)) out.colorChange();
    else if (b2 === 0x7f || b2 === 0x18) break;
  }
  out.end();
  if (r.remaining >= 2) {
    r.skip(2);
    for (let i = 0; i < colors && r.remaining >= 4; i++) {
      out.addThread({ hex: intToHex(r.u32be()) });
    }
  }
  return out.build();
}
