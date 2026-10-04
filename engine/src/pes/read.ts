import { pecColor, type PecColor } from "./pec-palette";
import type { StitchType } from "../stitch/plan";

export interface PesStitch {
  /** mm relative to the file's origin. */
  x: number;
  y: number;
  type: StitchType;
  /** 0-based colour block this entry belongs to. */
  block: number;
}

export interface PesData {
  /** Label from the PEC header, trimmed. */
  label: string;
  /** PEC palette index (1..64) per colour block. */
  pecIndices: number[];
  colors: PecColor[];
  stitches: PesStitch[];
  /** Bounding box of needle positions, mm. */
  widthMm: number;
  heightMm: number;
}

const signed12 = (v: number) => ((v & 0xfff) > 0x7ff ? (v & 0xfff) - 0x1000 : v & 0xfff);
const signed7 = (v: number) => (v > 63 ? v - 128 : v);

/**
 * Minimal PES/PEC reader: header palette + stitch stream. Handles `#PES0001`..`#PES0060` (reads
 * the PEC offset from the header) and bare `#PEC0001`. Coordinates are returned in mm.
 *
 * Not a full PES parser: the PES object section (CEmbOne/CSewSeg) is skipped; the PEC block is the
 * source of truth, which is what the machines use.
 */
export function readPes(bytes: Uint8Array): PesData {
  const sig = String.fromCharCode(...bytes.subarray(0, 8));
  let pec: number;
  if (sig.startsWith("#PES")) {
    pec = bytes[8] | (bytes[9] << 8) | (bytes[10] << 16) | (bytes[11] << 24);
  } else if (sig === "#PEC0001") {
    pec = 8;
  } else {
    throw new Error("Not a PES/PEC file");
  }
  if (String.fromCharCode(...bytes.subarray(pec, pec + 3)) !== "LA:") throw new Error("PEC block not found");
  const label = String.fromCharCode(...bytes.subarray(pec + 3, pec + 19)).trim();
  const colourCount = bytes[pec + 48] + 1;
  const pecIndices = Array.from(bytes.subarray(pec + 49, pec + 49 + colourCount));

  const blockStart = pec + 512;
  const blockLength = bytes[blockStart + 2] | (bytes[blockStart + 3] << 8) | (bytes[blockStart + 4] << 16);
  const blockEnd = blockStart + blockLength;

  const decode = (from: number) => {
    const stitches: PesStitch[] = [];
    let i = from;
    let x = 0;
    let y = 0;
    let block = 0;
    while (i < bytes.length) {
      const b1 = bytes[i];
      if (b1 === 0xff) {
        i++;
        break;
      }
      if (b1 === 0xfe && bytes[i + 1] === 0xb0) {
        block++;
        stitches.push({ x: x / 10, y: y / 10, type: "colorChange", block });
        i += 3;
        continue;
      }
      let flags = 0;
      let dx: number;
      let dy: number;
      if (b1 & 0x80) {
        flags |= b1 & 0x30;
        dx = signed12(((b1 << 8) | bytes[i + 1]) & 0xfff);
        i += 2;
      } else {
        dx = signed7(b1);
        i += 1;
      }
      const b2 = bytes[i];
      if (b2 & 0x80) {
        flags |= b2 & 0x30;
        dy = signed12(((b2 << 8) | bytes[i + 1]) & 0xfff);
        i += 2;
      } else {
        dy = signed7(b2);
        i += 1;
      }
      x += dx;
      y += dy;
      const type: StitchType = flags & 0x20 ? "trim" : flags & 0x10 ? "jump" : "stitch";
      stitches.push({ x: x / 10, y: y / 10, type, block });
    }
    return { stitches, end: i };
  };

  // Standard layout: a 20-byte header before the stitch stream, ending in two big-endian words
  // `0x9000 | -minX` and `0x9000 | -minY` (0.1 mm). Lilo v1.0/v1.1 wrote only 16 bytes, so those
  // 4 bytes are really the first stitch. Both layouts end at the same place, so tell them apart by
  // checking the two words against the bounds of the +20 decode.
  const isStd = (r: { stitches: PesStitch[]; end: number }) => {
    if (r.end !== blockEnd) return false;
    let lx = Infinity;
    let ly = Infinity;
    for (const s of r.stitches) {
      if (s.type !== "stitch") continue;
      lx = Math.min(lx, s.x);
      ly = Math.min(ly, s.y);
    }
    if (!Number.isFinite(lx)) return true;
    const wx = ((bytes[blockStart + 16] << 8) | bytes[blockStart + 17]) & 0xfff;
    const wy = ((bytes[blockStart + 18] << 8) | bytes[blockStart + 19]) & 0xfff;
    const ex = -Math.round(lx * 10) & 0xfff;
    const ey = -Math.round(ly * 10) & 0xfff;
    const near = (a: number, b: number) => Math.min((a - b) & 0xfff, (b - a) & 0xfff) <= 2;
    return near(wx, ex) && near(wy, ey);
  };
  let result = decode(blockStart + 20);
  if (!isStd(result)) {
    const old = decode(blockStart + 16);
    if (old.end === blockEnd) result = old;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of result.stitches) {
    if (s.type !== "stitch") continue;
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minY = Math.min(minY, s.y);
    maxY = Math.max(maxY, s.y);
  }
  return {
    label,
    pecIndices,
    colors: pecIndices.map(pecColor),
    stitches: result.stitches,
    widthMm: Number.isFinite(minX) ? maxX - minX : 0,
    heightMm: Number.isFinite(minY) ? maxY - minY : 0,
  };
}
