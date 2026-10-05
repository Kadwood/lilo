import { DEFAULT_HOOP, HOOP_LIBRARY, emptyDesign, hoopFromSpec, smallestFittingHoop, type Design, type Hoop, type RunObject, type Thread } from "@lilo/engine/light";
import type { EngineClient } from "../engine/client";
import { candidateHoops, designSize } from "../hoops/autoPick";
import { MAX_STITCH_FILE_BYTES, TOO_BIG_MESSAGE, UNREADABLE_MESSAGE, extOf, isStitchFile, stemOf } from "./stitchFiles";

export { MAX_STITCH_FILE_BYTES, OPEN_EXTENSIONS, STITCH_EXTENSIONS, TOO_BIG_MESSAGE, UNREADABLE_MESSAGE, isProjectFile, isStitchFile } from "./stitchFiles";

/**
 * Opening a stitch file (PES, DST, JEF, ...) as an editable design. ONE function used by every way in:
 * File > Open, the Home screen, a file dropped on the window, Finder "Open with Lilo", the command
 * palette, the Converter's "Open in editor" and a drop onto a design that is already open. It reads the
 * file with the engine (every needle drop kept, as manual-stitch objects) and shapes the result; the
 * callers decide where it goes (a new project, or a new layer in the open one).
 */

/** A file that could not be opened. `message` is safe to show as it is. */
export class StitchImportError extends Error {}

export interface StitchImport {
  /** The file name without its extension: the project's name and the layer's name. */
  name: string;
  threads: Thread[];
  /** One manual-stitch object per colour run, in sew order. No layer set yet. */
  objects: RunObject[];
  warnings: string[];
}

/** Read a stitch file into objects and threads. Throws `StitchImportError` with a friendly message. */
export async function readStitchFile(engine: EngineClient, file: { name: string; bytes: Uint8Array }): Promise<StitchImport> {
  if (!isStitchFile(file.name)) throw new StitchImportError(UNREADABLE_MESSAGE);
  if (file.bytes.length > MAX_STITCH_FILE_BYTES) throw new StitchImportError(TOO_BIG_MESSAGE);
  let r;
  try {
    r = await engine.call("readEmbroidery", file.bytes, extOf(file.name));
  } catch {
    throw new StitchImportError(UNREADABLE_MESSAGE);
  }
  const objects = r.design.objects as RunObject[];
  if (objects.length === 0) throw new StitchImportError("There are no stitches in this file, so there's nothing to open.");
  return { name: stemOf(file.name).slice(0, 80), threads: r.design.threads, objects, warnings: r.warnings.map((w) => w.message) };
}

export interface HoopChoice {
  /** The hoop the user last used: its machine decides which hoops are offered. */
  reference?: Hoop;
  custom?: readonly Hoop[];
}

/**
 * A new design from a stitch file: one stitch layer named after the file, and the smallest hoop of the
 * user's machine that holds it (a bigger one with a note when nothing does). Stitch positions are not touched.
 */
export function designFromStitches(imp: StitchImport, hoops: HoopChoice = {}): { design: Design; warnings: string[] } {
  const layerId = "layer-stitches";
  const design: Design = {
    ...emptyDesign(hoops.reference ?? DEFAULT_HOOP),
    threads: imp.threads,
    objects: imp.objects.map((o) => ({ ...o, layerId })),
    layers: [{ id: layerId, name: imp.name, kind: "stitch", visible: true, locked: false }],
  };
  const warnings = [...imp.warnings];
  // Never a turned hoop: Lilo turns a design back when it exports into a turned hoop, and an imported file must go out exactly as it came in.
  const size = designSize(design);
  const custom = [...(hoops.custom ?? [])];
  const mine = size ? smallestFittingHoop(size, candidateHoops(design.hoop, custom), { allowRotate: false }) : null;
  const pick = mine?.kind === "fit" || !size ? mine : smallestFittingHoop(size, [...HOOP_LIBRARY.map(hoopFromSpec), ...custom], { allowRotate: false });
  if (pick?.kind === "fit") design.hoop = pick.hoop;
  else if (pick?.closest) {
    design.hoop = pick.closest;
    warnings.push("This design is bigger than any hoop on your list, so it needs re-hooping to sew.");
  }
  return { design, warnings };
}
