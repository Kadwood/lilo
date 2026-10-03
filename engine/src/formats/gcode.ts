/**
 * G-code, write only. Ported from pyembroidery's GcodeWriter.py (MIT), so files match what it
 * writes. This is a stitch path for CNC, plotter and DIY machines, not a sewing-machine format:
 * comment lines with the design's size, command counts and thread list, then one
 * `G00 X.. Y..` plus `G00 Z..` pair per stitch (Z climbs 10 per stitch, so each needle drop is its
 * own height), `M00` (pause) at every colour change and `M30` (end) last. Jumps and trims write
 * nothing: the next stitch's move covers them. Units are mm with both axes flipped from the stitch
 * data (+y down there), as pyembroidery writes it.
 */
import { bounds } from "./pattern";
import { transcode } from "./transcode";
import type { EmbCmd, EmbPattern } from "./types";

const NAMES: Record<EmbCmd, string> = {
  stitch: "STITCH",
  jump: "JUMP",
  trim: "TRIM",
  stop: "STOP",
  end: "END",
  colorChange: "COLOR_CHANGE",
  needleSet: "NEEDLE_SET",
};

/** Text safe inside a `( ... )` comment: printable ASCII, no closing bracket. */
const clean = (s: string): string => [...s].filter((c) => c >= " " && c <= "~" && c !== ")").join("");

/**
 * Python's `"%.3f" % v`: correctly rounded from the exact binary value, exact ties to even (JS
 * `toFixed` rounds those up), and no negative zero.
 */
export function fixed3(v: number): string {
  const exact = v.toFixed(60);
  const dot = exact.indexOf(".");
  const tail = exact.slice(dot + 4);
  const text = /^50*$/.test(tail) && Number(exact[dot + 3]) % 2 === 0 ? exact.slice(0, dot + 4) : (v + 0).toFixed(3);
  return text.replace(/^-(0\.000)$/, "$1");
}

/** A 0.1 mm position as mm text. */
const mm = (tenths: number): string => fixed3(tenths / 10);

export interface GcodeWriteOptions {
  label?: string;
}

export function writeGcode(pattern: EmbPattern, options: GcodeWriteOptions = {}): Uint8Array {
  const t = transcode(pattern, { maxStitch: Infinity, maxJump: Infinity, fullJump: false, threadChange: "colorChange", round: false });
  // pyembroidery writes G-code with both axes flipped (its reader flips them back)
  const p = { ...t, stitches: t.stitches.map((s) => ({ ...s, x: -s.x, y: -s.y })) };
  const b = bounds(p);
  const lines: string[] = [];
  const count = (cmd: EmbCmd) => p.stitches.filter((s) => s.cmd === cmd).length;

  lines.push(`(STITCH_COUNT: ${p.stitches.length})`);
  lines.push(`(THREAD_COUNT: ${count("colorChange")})`);
  lines.push(`(EXTENTS_LEFT: ${mm(b.minX)})`);
  lines.push(`(EXTENTS_TOP: ${mm(b.minY)})`);
  lines.push(`(EXTENTS_RIGHT: ${mm(b.maxX)})`);
  lines.push(`(EXTENTS_BOTTOM: ${mm(b.maxY)})`);
  lines.push(`(EXTENTS_WIDTH: ${fixed3(b.maxX / 10 - b.minX / 10)})`);
  lines.push(`(EXTENTS_HEIGHT: ${fixed3(b.maxY / 10 - b.minY / 10)})`);
  const seen: EmbCmd[] = [];
  for (const s of p.stitches) if (!seen.includes(s.cmd)) seen.push(s.cmd);
  for (const cmd of seen) lines.push(`(COMMAND_${NAMES[cmd]}: ${count(cmd)})`);
  const name = clean(options.label ?? pattern.name ?? "");
  if (name) lines.push(`(name: ${name})`);
  p.threads.forEach((t, i) => lines.push(`(Thread${i}: ${t.hex} ${clean(t.name ?? "None")} ${clean(t.brand ?? "None")} ${clean(t.code ?? "None")})`));

  let z = 0;
  for (const s of p.stitches) {
    if (s.cmd === "stitch") {
      lines.push(`G00 X${mm(s.x)} Y${mm(s.y)}`, `G00 Z${z.toFixed(1)}`);
      z += 10;
    } else if (s.cmd === "colorChange" || s.cmd === "stop") lines.push("M00");
    else if (s.cmd === "end") lines.push("M30");
  }
  return new TextEncoder().encode(lines.join("\n") + "\n");
}
