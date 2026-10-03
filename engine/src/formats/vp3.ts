/**
 * Pfaff / Viking VP3. Ported from pyembroidery's Vp3Writer.py / Vp3Reader.py (MIT). Big-endian,
 * nested length-prefixed blocks (file > design > colour block > stitches). VP3 has no jump command:
 * a jump is folded into the next stitch's delta, and each colour block stores its own start.
 */
import { ByteReader, ByteWriter, FormatError, signed16, signed32, signed8 } from "./io";
import { bounds, hexToInt, intToHex, PatternBuilder, threadOrFiller } from "./pattern";
import { transcode } from "./transcode";
import type { EmbPattern, EmbStitch, EmbThread } from "./types";

const PRODUCER = "Produced by     Software Ltd";

const str16 = (w: ByteWriter, s: string) => {
  w.u16be(s.length * 2);
  w.utf16be(s);
};
const str8 = (w: ByteWriter, s: string) => {
  const b = new TextEncoder().encode(s);
  w.u16be(b.length);
  w.bytes(b);
};
/** Patch the 4 bytes at `at` with the distance from there to the current end (as the format wants). */
const patch = (w: ByteWriter, at: number) => w.patch32be(at, w.length - at - 4);

interface Block {
  stitches: EmbStitch[];
  thread: EmbThread;
}

function colorBlocks(p: EmbPattern): Block[] {
  const blocks: Block[] = [];
  let lastPos = 0;
  let threadIndex = 0;
  p.stitches.forEach((s, pos) => {
    if (s.cmd !== "colorChange") return;
    blocks.push({ stitches: p.stitches.slice(lastPos, pos), thread: threadOrFiller(p, threadIndex++) });
    lastPos = pos;
  });
  blocks.push({ stitches: p.stitches.slice(lastPos), thread: threadOrFiller(p, threadIndex) });
  return blocks;
}

export function writeVp3(pattern: EmbPattern): Uint8Array {
  const p = transcode(pattern, { maxStitch: 255, maxJump: 3200, fullJump: false, threadChange: "colorChange" });
  const w = new ByteWriter();
  w.ascii("%vsm%").u8(0);
  str16(w, PRODUCER);
  w.u8(0x00, 0x02, 0x00);
  const fileEnd = w.length;
  w.u32be(0);
  str16(w, "");
  const blocks = colorBlocks(p);
  const b = bounds(p);
  w.u32be(Math.trunc(b.maxX * 100));
  w.u32be(Math.trunc(b.minY * -100));
  w.u32be(Math.trunc(b.minX * 100));
  w.u32be(Math.trunc(b.maxY * -100));
  const ends = p.stitches.filter((s) => s.cmd === "end").length;
  w.u32be(p.stitches.length - ends);
  w.u8(0, blocks.length, 12, 0);
  w.u8(1); // one design

  // ---- design block ----
  w.u8(0x00, 0x03, 0x00);
  const designEnd = w.length;
  w.u32be(0);
  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;
  const hw = width / 2;
  const hh = height / 2;
  const cx = b.maxX - hw;
  const cy = b.maxY - hh;
  w.u32be(Math.trunc(cx) * 100);
  w.u32be(Math.trunc(cy) * -100);
  w.u8(0, 0, 0);
  w.u32be(Math.trunc(hw) * -100);
  w.u32be(Math.trunc(hw) * 100);
  w.u32be(Math.trunc(hh) * -100);
  w.u32be(Math.trunc(hh) * 100);
  w.u32be(Math.trunc(width) * 100);
  w.u32be(Math.trunc(height) * 100);
  str16(w, "");
  w.u8(0x64, 0x64);
  w.u32be(4096).u32be(0).u32be(0).u32be(4096);
  w.ascii("xxPP").u8(0x01, 0x00);
  str16(w, PRODUCER);
  w.u16be(blocks.length);

  blocks.forEach((blk, i) => {
    const first = i === 0;
    w.u8(0x00, 0x05, 0x00);
    const blockEnd = w.length;
    w.u32be(0);
    let fx = 0;
    let fy = 0;
    let lx = 0;
    let ly = 0;
    if (blk.stitches.length > 0) {
      fx = first ? 0 : blk.stitches[0].x;
      fy = first ? 0 : blk.stitches[0].y;
      lx = blk.stitches[blk.stitches.length - 1].x;
      ly = blk.stitches[blk.stitches.length - 1].y;
    }
    w.u32be(Math.trunc(fx - cx) * 100);
    w.u32be(Math.trunc(-(fy - cy)) * 100);
    // thread
    w.u8(0x01, 0x00).u24be(hexToInt(blk.thread.hex));
    w.u8(0x00, 0x00, 0x00, 0x05, 0x28); // no parts, no length, rayon 40 weight
    str8(w, blk.thread.code ?? "");
    str8(w, blk.thread.name ?? blk.thread.hex);
    str8(w, blk.thread.brand ?? "");
    w.u32be(Math.trunc(lx - fx) * 100);
    w.u32be(Math.trunc(-(ly - fy)) * 100);
    // stitches
    w.u8(0x00, 0x01, 0x00);
    const stitchEnd = w.length;
    w.u32be(0);
    w.u8(0x0a, 0xf6, 0x00);
    let px = fx;
    let py = fy;
    for (const s of blk.stitches) {
      if (s.cmd === "end") {
        w.u8(0x80, 0x03); // machines don't auto-trim, so writers add an explicit one
        break;
      }
      if (s.cmd === "trim") {
        w.u8(0x80, 0x03);
        continue;
      }
      if (s.cmd !== "stitch") continue; // colour changes split the blocks; VP3 has no jumps
      const dx = Math.trunc(s.x - px);
      const dy = Math.trunc(s.y - py);
      px += dx;
      py += dy;
      if (dx >= -127 && dx <= 127 && dy >= -127 && dy <= 127) w.u8(dx, dy);
      else w.u8(0x80, 0x01).u16be(dx).u16be(dy).u8(0x80, 0x02);
    }
    patch(w, stitchEnd);
    w.u8(0);
    patch(w, blockEnd);
  });
  patch(w, designEnd);
  patch(w, fileEnd);
  return w.done();
}

export function readVp3(bytes: Uint8Array): EmbPattern {
  const r = new ByteReader(bytes, "VP3 file");
  if (bytes.length < 40 || r.ascii(5) !== "%vsm%") throw new FormatError("This does not look like a VP3 file.");
  r.skip(1);
  const skipStr = () => r.skip(r.u16be());
  skipStr();
  r.skip(7);
  skipStr();
  r.skip(32);
  const cx = signed32(r.u32be()) / 100;
  const cy = -(signed32(r.u32be()) / 100);
  r.skip(27);
  skipStr();
  r.skip(24);
  skipStr();
  const count = r.u16be();
  if (count > 1000) throw new FormatError("This VP3 file is corrupt (too many colours).");
  const out = new PatternBuilder();
  for (let i = 0; i < count; i++) {
    r.skip(3);
    const dist = r.u32be();
    const blockEnd = dist + r.pos;
    if (blockEnd > bytes.length) throw new FormatError("This VP3 file is corrupt (block runs past the end).");
    const sx = signed32(r.u32be()) / 100;
    const sy = -(signed32(r.u32be()) / 100);
    const ax = sx + cx;
    const ay = sy + cy;
    if (ax !== out.x || ay !== out.y) out.moveAbs(ax, ay);
    // thread
    const colors = r.u8();
    r.u8(); // transition
    let rgb = 0;
    for (let m = 0; m < colors; m++) {
      rgb = r.u24be();
      r.skip(3); // parts, length
    }
    r.skip(2); // type, weight
    const text = () => new TextDecoder().decode(r.bytes(r.u16be()));
    const code = text();
    const name = text();
    const brand = text();
    out.addThread({ hex: intToHex(rgb), ...(name ? { name } : {}), ...(code ? { code } : {}), ...(brand ? { brand } : {}) });
    r.skip(15);
    r.skip(3);
    const raw = r.bytes(Math.max(0, blockEnd - r.pos));
    const sb = Array.from(raw, signed8);
    let k = 0;
    while (k < sb.length - 1) {
      const x = sb[k];
      const y = sb[k + 1];
      k += 2;
      if ((x & 0xff) !== 0x80) {
        out.stitch(x, y);
        continue;
      }
      if (y === 0x01) {
        if (k + 6 > sb.length) break;
        const lx = signed16(((sb[k] & 0xff) << 8) | (sb[k + 1] & 0xff));
        const ly = signed16(((sb[k + 2] & 0xff) << 8) | (sb[k + 3] & 0xff));
        k += 4;
        out.stitch(lx, ly);
        k += 2; // the closing 80 02
      } else if (y === 0x03) out.trim();
    }
    if (i + 1 < count) out.colorChange();
  }
  out.end();
  return out.build();
}
