/**
 * Melco EXP. Ported from pyembroidery's ExpWriter.py / ExpReader.py (MIT). No header: byte pairs
 * (dx, -dy) in 0.1 mm, with `80 xx` escapes for jump (04), colour change (01) and trim (80).
 * EXP stores no colours.
 */
import { ByteReader, ByteWriter, pyRound, signed8 } from "./io";
import { PatternBuilder } from "./pattern";
import { transcode } from "./transcode";
import type { EmbPattern } from "./types";

export function writeExp(pattern: EmbPattern): Uint8Array {
  const p = transcode(pattern, { maxStitch: 127, maxJump: 127, fullJump: true, threadChange: "colorChange" });
  const out = new ByteWriter();
  let xx = 0;
  let yy = 0;
  for (const s of p.stitches) {
    const dx = pyRound(s.x - xx);
    const dy = pyRound(s.y - yy);
    xx += dx;
    yy += dy;
    if (s.cmd === "stitch") out.u8(dx & 0xff, -dy & 0xff);
    else if (s.cmd === "jump") out.u8(0x80, 0x04, dx & 0xff, -dy & 0xff);
    else if (s.cmd === "trim") out.u8(0x80, 0x80, 0x07, 0x00);
    else if (s.cmd === "colorChange" || s.cmd === "stop") out.u8(0x80, 0x01, 0x00, 0x00);
  }
  return out.done();
}

export function readExp(bytes: Uint8Array): EmbPattern {
  const r = new ByteReader(bytes, "EXP file");
  const out = new PatternBuilder();
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
    if (b === 0x80) out.trim();
    else if (b === 0x02) out.stitch(x, y);
    else if (b === 0x04) out.move(x, y);
    else if (b === 0x01) {
      out.colorChange();
      if (x !== 0 || y !== 0) out.move(x, y);
    } else break;
  }
  out.end();
  return out.build();
}
