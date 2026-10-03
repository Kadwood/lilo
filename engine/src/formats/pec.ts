/**
 * Brother PEC (the bare machine block of a PES). The layout is the PEC section of `writePes`
 * (ported from pyembroidery's PecWriter.py, MIT) behind a `#PEC0001` signature.
 */
import { rgbToHex } from "../color";
import { readPes } from "../pes/read";
import { writePes, type WritePesOptions } from "../pes/write";
import type { StitchPlan } from "../stitch/plan";
import { FormatError } from "./io";
import type { EmbPattern, EmbThread } from "./types";

/** Offset of the PEC block inside the PES files `writePes` produces. */
const PES_PEC_OFFSET = 22;

export function writePec(plan: StitchPlan, options: WritePesOptions = {}): Uint8Array {
  const pes = writePes(plan, options);
  const out = new Uint8Array(8 + pes.length - PES_PEC_OFFSET);
  out.set(new TextEncoder().encode("#PEC0001"), 0);
  out.set(pes.subarray(PES_PEC_OFFSET), 8);
  return out;
}

/** Read PES or PEC bytes as a pattern (0.1 mm, one thread per colour block). */
export function readPecOrPes(bytes: Uint8Array): EmbPattern {
  let data;
  try {
    data = readPes(bytes);
  } catch (e) {
    throw new FormatError(e instanceof Error ? e.message : "Not a PES/PEC file.");
  }
  const threads: EmbThread[] = data.colors.map((c) => ({
    hex: rgbToHex(...c.rgb),
    name: c.name,
    code: String(c.index),
    brand: "Brother PEC",
  }));
  const stitches: EmbPattern["stitches"] = [];
  let x = 0;
  let y = 0;
  for (const s of data.stitches) {
    const px = Math.round(s.x * 10);
    const py = Math.round(s.y * 10);
    if (s.type === "trim") {
      stitches.push({ x, y, cmd: "trim" }, { x: px, y: py, cmd: "jump" });
    } else {
      stitches.push({ x: px, y: py, cmd: s.type === "colorChange" ? "colorChange" : s.type });
    }
    x = px;
    y = py;
  }
  stitches.push({ x, y, cmd: "end" });
  return { stitches, threads, ...(data.label ? { name: data.label } : {}) };
}
