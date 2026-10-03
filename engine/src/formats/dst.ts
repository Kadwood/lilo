/**
 * Tajima DST. Ported from pyembroidery's DstWriter.py / DstReader.py (MIT). 512-byte text header,
 * then 3-byte records in 0.1 mm units: two balanced-ternary-ish deltas plus a command in byte 3.
 * DST stores no colours and has no trim command (a trim is written as three net-zero jumps).
 */
import { ByteReader, ByteWriter, FormatError, pyRound } from "./io";
import { bounds, countCmd, interpolateTrims, PatternBuilder } from "./pattern";
import { transcode } from "./transcode";
import type { EmbPattern } from "./types";

const HEADER = 512;
const MAX = 121;

type Rec = "stitch" | "jump" | "colorChange" | "end";

function record(xIn: number, yIn: number, kind: Rec): [number, number, number] {
  let x = xIn;
  let y = -yIn;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  const bit = (n: number) => 1 << n;
  if (kind === "jump") b2 += bit(7);
  if (kind === "stitch" || kind === "jump") {
    b2 += bit(0) + bit(1);
    if (x > 40) { b2 += bit(2); x -= 81; }
    if (x < -40) { b2 += bit(3); x += 81; }
    if (x > 13) { b1 += bit(2); x -= 27; }
    if (x < -13) { b1 += bit(3); x += 27; }
    if (x > 4) { b0 += bit(2); x -= 9; }
    if (x < -4) { b0 += bit(3); x += 9; }
    if (x > 1) { b1 += bit(0); x -= 3; }
    if (x < -1) { b1 += bit(1); x += 3; }
    if (x > 0) { b0 += bit(0); x -= 1; }
    if (x < 0) { b0 += bit(1); x += 1; }
    if (x !== 0) throw new FormatError("A DST move is longer than the format allows.");
    if (y > 40) { b2 += bit(5); y -= 81; }
    if (y < -40) { b2 += bit(4); y += 81; }
    if (y > 13) { b1 += bit(5); y -= 27; }
    if (y < -13) { b1 += bit(4); y += 27; }
    if (y > 4) { b0 += bit(5); y -= 9; }
    if (y < -4) { b0 += bit(4); y += 9; }
    if (y > 1) { b1 += bit(7); y -= 3; }
    if (y < -1) { b1 += bit(6); y += 3; }
    if (y > 0) { b0 += bit(7); y -= 1; }
    if (y < 0) { b0 += bit(6); y += 1; }
    if (y !== 0) throw new FormatError("A DST move is longer than the format allows.");
  } else if (kind === "colorChange") b2 = 0b11000011;
  else if (kind === "end") b2 = 0b11110011;
  return [b0, b1, b2];
}

const pad = (v: number | string, n: number) => String(v).padStart(n, " ");

export function writeDst(pattern: EmbPattern): Uint8Array {
  const p = transcode(pattern, { maxStitch: MAX, maxJump: MAX, fullJump: false, threadChange: "colorChange" });
  const b = bounds(p);
  const out = new ByteWriter();
  const last = p.stitches[p.stitches.length - 1];
  const ax = last ? Math.trunc(last.x) : 0;
  const ay = last ? -Math.trunc(last.y) : 0;
  const sign = (v: number) => (v >= 0 ? "+" : "-") + pad(Math.abs(v), 5);
  out.ascii(`LA:${(p.name ?? "Untitled").slice(0, 16).padEnd(16, " ")}\r`);
  out.ascii(`ST:${pad(p.stitches.length, 7)}\r`);
  out.ascii(`CO:${pad(countCmd(p, "colorChange"), 3)}\r`);
  out.ascii(`+X:${pad(Math.abs(b.maxX), 5)}\r`);
  out.ascii(`-X:${pad(Math.abs(b.minX), 5)}\r`);
  out.ascii(`+Y:${pad(Math.abs(b.maxY), 5)}\r`);
  out.ascii(`-Y:${pad(Math.abs(b.minY), 5)}\r`);
  out.ascii(`AX:${sign(ax)}\r`);
  out.ascii(`AY:${sign(ay)}\r`);
  out.ascii("MX:+    0\r");
  out.ascii("MY:+    0\r");
  out.ascii("PD:******\r");
  out.u8(0x1a);
  out.padTo(HEADER, 0x20);

  let xx = 0;
  let yy = 0;
  for (const s of p.stitches) {
    const dx = pyRound(s.x - xx);
    const dy = pyRound(s.y - yy);
    xx += dx;
    yy += dy;
    if (s.cmd === "trim") {
      // three jumps that net to zero: the machine reads a run of jumps as a trim
      out.bytes(record(2, 2, "jump"));
      out.bytes(record(-4, -4, "jump"));
      out.bytes(record(2, 2, "jump"));
    } else if (s.cmd === "stitch" || s.cmd === "jump") out.bytes(record(dx, dy, s.cmd));
    else if (s.cmd === "colorChange" || s.cmd === "stop") out.bytes(record(dx, dy, "colorChange"));
    else if (s.cmd === "end") out.bytes(record(dx, dy, "end"));
  }
  return out.done();
}

const getbit = (v: number, n: number) => (v >> n) & 1;

function decodeDx(b0: number, b1: number, b2: number): number {
  return (
    getbit(b2, 2) * 81 - getbit(b2, 3) * 81 + getbit(b1, 2) * 27 - getbit(b1, 3) * 27 +
    getbit(b0, 2) * 9 - getbit(b0, 3) * 9 + getbit(b1, 0) * 3 - getbit(b1, 1) * 3 + getbit(b0, 0) - getbit(b0, 1)
  );
}
function decodeDy(b0: number, b1: number, b2: number): number {
  return -(
    getbit(b2, 5) * 81 - getbit(b2, 4) * 81 + getbit(b1, 5) * 27 - getbit(b1, 4) * 27 +
    getbit(b0, 5) * 9 - getbit(b0, 4) * 9 + getbit(b1, 7) * 3 - getbit(b1, 6) * 3 + getbit(b0, 7) - getbit(b0, 6)
  );
}

export function readDst(bytes: Uint8Array): EmbPattern {
  if (bytes.length < HEADER + 3) throw new FormatError("This is too small to be a DST file.");
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, HEADER));
  if (!/^LA:/.test(header)) throw new FormatError("This does not look like a DST file (no LA: header).");
  const out = new PatternBuilder();
  const la = /^LA:([^\r\n]*)/.exec(header);
  if (la?.[1].trim()) out.name = la[1].trim();
  const r = new ByteReader(bytes, "DST file");
  r.seek(HEADER);
  while (r.remaining >= 3) {
    const b0 = r.u8();
    const b1 = r.u8();
    const b2 = r.u8();
    const dx = decodeDx(b0, b1, b2);
    const dy = decodeDy(b0, b1, b2);
    if ((b2 & 0b11110011) === 0b11110011) break;
    if ((b2 & 0b11000011) === 0b11000011) out.colorChange(dx, dy);
    else if ((b2 & 0b01000011) === 0b01000011) continue; // sequin mode toggle: not supported, ignored
    else if ((b2 & 0b10000011) === 0b10000011) out.move(dx, dy);
    else out.stitch(dx, dy);
  }
  out.end();
  const pattern = out.build();
  return { ...pattern, stitches: interpolateTrims(pattern.stitches, 3, null, true) };
}
