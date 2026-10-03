import { Core, IO, Math as StitchMath } from "@stitchables/stitchjs";

const { Vector, Polyline } = StitchMath;

/** Design is authored in "px" on a 400 x 200 canvas that maps to 40 x 20 mm (10 px per mm). */
const WIDTH_PX = 400;
const HEIGHT_PX = 200;
export const DEMO_WIDTH_MM = 40;
export const DEMO_HEIGHT_MM = 20;

/**
 * Encode a stitchjs pattern as PES bytes, synchronously.
 *
 * Mirrors `Stitch.IO.getData` (centre the design on the origin and convert px to mm) but calls
 * `PESWriter` directly, because `getData` returns an async `Blob` and `IO.write` triggers a
 * browser download.
 */
export function patternToPes(
  pattern: InstanceType<typeof Core.Pattern>,
  widthMm: number,
  heightMm: number,
  filename: string,
): Uint8Array {
  const plan = pattern.getStitchPlan(widthMm, heightMm, 1);
  const scale = plan.pixelsPerUnit;
  const translate = new Vector(0.5 * plan.width * scale, 0.5 * plan.height * scale);
  for (const thread of plan.threads) {
    for (const run of thread.runs) {
      for (const stitch of run) {
        stitch.position = stitch.position.subtract(translate).divide(scale);
      }
    }
  }
  plan.width /= scale;
  plan.height /= scale;

  const parts = new IO.Writers.PESWriter().write(plan, filename);
  const chunks: Uint8Array[] = parts.map((p) => {
    if (typeof p === "string") return Uint8Array.from(p, (c) => c.charCodeAt(0) & 0xff); // ASCII
    if (typeof p === "number") return Uint8Array.of(p & 0xff);
    return p;
  });
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** A small satin column (curved) plus a tatami-filled rectangle, in two thread colours. */
export function buildDemoPattern(): InstanceType<typeof Core.Pattern> {
  const pattern = new Core.Pattern(WIDTH_PX, HEIGHT_PX);

  // Thread 1: satin column, one sine period, 30 px (3 mm) wide.
  const satinThread = pattern.addThread(180, 30, 40);
  const strip: InstanceType<typeof Vector>[] = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const x = 30 + (i / steps) * 150;
    const y = 100 + 40 * Math.sin((i / steps) * Math.PI * 2);
    strip.push(new Vector(x, y - 15), new Vector(x, y + 15)); // left/right pair per step
  }
  satinThread.addRun(new Core.Runs.ClassicSatin(strip, { densityMm: 0.4 }));

  // Thread 2: tatami fill, a 140 x 120 px rectangle.
  const fillThread = pattern.addThread(20, 60, 160);
  const shell = Polyline.fromArrays(
    [
      [220, 40],
      [360, 40],
      [360, 160],
      [220, 160],
      [220, 40],
    ],
    true,
  );
  fillThread.addRun(
    new Core.Runs.TatamiFill(
      shell,
      [],
      0.25 * Math.PI, // fill angle (rad)
      0.4, // row spacing mm
      3, // stitch length mm
      3, // travel stitch length mm
      shell.vertices[0],
      shell.vertices[0],
    ),
  );
  return pattern;
}

/** PES bytes for the built-in demo design (satin + tatami). Used by Export / Send in M1. */
export function demoSatinPes(): Uint8Array {
  return patternToPes(buildDemoPattern(), DEMO_WIDTH_MM, DEMO_HEIGHT_MM, "demo.pes");
}
