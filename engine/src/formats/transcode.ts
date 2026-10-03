import type { EmbPattern, EmbStitch, EmbThread } from "./types";
import { pyRound } from "./io";
import { threadOrFiller } from "./pattern";

/**
 * Fit a pattern to what a format can encode. Ported from pyembroidery's `Transcoder` (MIT), reduced
 * to the commands Lilo produces (stitch, jump, trim, colour change, stop, end): over-long moves are
 * split, positions are rounded, and the first stitch of each colour or after a trim is reached by
 * a jump.
 */
export interface TranscodeSettings {
  /** Longest single move, per axis, in 0.1 mm. */
  maxStitch: number;
  maxJump: number;
  /**
   * After splitting a long jump, finish with a jump to the exact spot (EXP, JEF, PEC) rather than
   * letting the next stitch cover the last leg (DST, VP3, XXX).
   */
  fullJump: boolean;
  /** How the format marks a thread change. */
  threadChange: "colorChange" | "needleSet" | "stop";
  /** Needles on the machine, for `needleSet` formats. Default 5. */
  needleCount?: number;
  /** Also write a trim before every colour change. Default false. */
  explicitTrim?: boolean;
}

export function transcode(src: EmbPattern, s: TranscodeSettings): EmbPattern {
  const out: EmbStitch[] = [];
  const threads: EmbThread[] = [];
  const needleCount = s.needleCount && s.needleCount > 1 ? s.needleCount : 5;
  const change = s.threadChange === "needleSet" && needleCount <= 1 ? "stop" : s.threadChange;
  let nx = 0;
  let ny = 0;
  let trimmed = true;
  let order = -1;

  const add = (cmd: EmbStitch["cmd"], x = nx, y = ny, needle?: number) =>
    out.push(needle === undefined ? { x, y, cmd } : { x, y, cmd, needle });

  const nextChange = () => {
    order++;
    const needle = (order % needleCount) + 1;
    if (change === "colorChange") {
      threads.push(threadOrFiller(src, order));
      if (order !== 0) add("colorChange");
    } else if (change === "needleSet") {
      add("needleSet", nx, ny, needle);
    } else {
      threads.push(threadOrFiller(src, order));
      add("stop");
    }
    trimmed = true;
  };
  const declareNotTrimmed = () => {
    if (order === -1) nextChange();
    trimmed = false;
  };
  /** Insert jumps so the remaining distance to (x, y) is within `max`. */
  const gap = (x1: number, y1: number, max: number, cmd: "jump" | "stitch") => {
    const dx = x1 - nx;
    const dy = y1 - ny;
    if (Math.abs(dx) > max || Math.abs(dy) > max) {
      const steps = Math.max(Math.ceil(Math.abs(dx / max)), Math.ceil(Math.abs(dy / max)));
      const sx = dx / steps;
      const sy = dy / steps;
      let qx = nx;
      let qy = ny;
      for (let q = 1; q < steps; q++) {
        qx += sx;
        qy += sy;
        add(cmd, qx, qy);
        nx = qx;
        ny = qy;
      }
    }
  };
  const jumpAt = (x: number, y: number) => {
    add("jump", x, y);
    nx = x;
    ny = y;
  };
  const stitchAt = (x: number, y: number) => {
    add("stitch", x, y);
    nx = x;
    ny = y;
  };
  const jumpWithinStitchRange = (x: number, y: number) => {
    gap(x, y, s.maxJump, "jump");
    if (s.fullJump && (nx !== x || ny !== y)) jumpAt(x, y);
  };

  let last: EmbStitch["cmd"] | null = null;
  for (const st of src.stitches) {
    const x = pyRound(st.x);
    const y = pyRound(st.y);
    last = st.cmd;
    if (st.cmd === "stitch") {
      if (trimmed) {
        declareNotTrimmed();
        jumpWithinStitchRange(x, y);
        stitchAt(x, y);
      } else {
        // long stitches become jumps plus one landing stitch (pyembroidery's default contingency)
        gap(x, y, s.maxStitch, "jump");
        stitchAt(x, y);
      }
    } else if (st.cmd === "trim") {
      if (!trimmed) {
        add("trim");
        trimmed = true;
      }
    } else if (st.cmd === "jump") {
      gap(x, y, s.maxJump, "jump");
      jumpAt(x, y);
    } else if (st.cmd === "colorChange" || st.cmd === "needleSet") {
      if (!trimmed && s.explicitTrim) add("trim");
      nextChange();
    } else if (st.cmd === "stop") {
      add("stop");
      trimmed = true;
    } else if (st.cmd === "end") {
      add("end");
      trimmed = true;
      break;
    }
  }
  if (last !== "end") add("end");
  return { stitches: out, threads: change === "needleSet" ? [...src.threads] : threads, ...(src.name ? { name: src.name } : {}) };
}
