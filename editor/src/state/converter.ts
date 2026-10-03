import { FORMATS, FORMAT_EXTENSIONS, formatFromName, type FormatExt } from "@lilo/engine/light";
import type { AutoDigitizeOptions } from "@lilo/engine";
import type { EngineClient } from "../engine/client";
import { classifyFile, decodeFile } from "../io/decode";

/**
 * The Converter's work, apart from the screen: what a dropped file is, and turning it into the
 * formats asked for. Embroidery files go straight between formats (`convert` in the engine). Pictures
 * go through Auto digitize first, with the options the editor currently has, and can also be saved as
 * the traced SVG.
 */

export type ConvTarget = FormatExt | "svg";

export interface ConvInput {
  name: string;
  bytes: Uint8Array;
}

export type ConvKind = "embroidery" | "image" | "unknown";

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "svg"];
export const CONVERTER_EXTENSIONS = [...FORMAT_EXTENSIONS, ...IMAGE_EXTENSIONS];

const extOf = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");
export const stemOf = (name: string) => name.replace(/\.[^.\\/]+$/, "") || name;

/** What a file is, from its name: an embroidery file, a picture Lilo can trace, or neither. */
export function classifyInput(name: string): ConvKind {
  if (formatFromName(name) && extOf(name) !== "") return "embroidery";
  if (classifyFile(name)) return "image";
  return "unknown";
}

/** Which targets make sense for a kind of input. PNG/JPG/SVG can also be saved as a traced SVG. */
export function targetsFor(kind: ConvKind, name = ""): ConvTarget[] {
  if (kind === "embroidery") return [...FORMAT_EXTENSIONS];
  if (kind === "image") return extOf(name) === "svg" ? [...FORMAT_EXTENSIONS] : [...FORMAT_EXTENSIONS, "svg"];
  return [];
}

export interface ConvOutput {
  /** File name to save as. */
  name: string;
  target: ConvTarget;
  bytes: Uint8Array;
  /** What the target couldn't keep, or the machine should know. */
  warnings: string[];
}

const hasColours = (ext: FormatExt) => FORMATS.find((f) => f.ext === ext)?.hasColors ?? true;

/**
 * Convert one input to each target. Throws a readable error if the file can't be read; a target that
 * fails on its own is reported as a warning on that output's file name instead of losing the others.
 */
export async function convertInput(engine: EngineClient, input: ConvInput, targets: readonly ConvTarget[], options: Partial<AutoDigitizeOptions>): Promise<ConvOutput[]> {
  const kind = classifyInput(input.name);
  const stem = stemOf(input.name);
  const label = stem.slice(0, 8);
  const out: ConvOutput[] = [];

  if (kind === "embroidery") {
    const from = extOf(input.name);
    for (const t of targets) {
      if (t === "svg") continue;
      const r = await engine.call("convertEmbroidery", input.bytes, from, t, label);
      out.push({ name: `${stem}.${t}`, target: t, bytes: r.bytes, warnings: r.warnings.map((w) => w.message) });
    }
    return out;
  }

  if (kind === "image") {
    const d = await decodeFile({ name: input.name, bytes: input.bytes });
    const source = d.kind === "raster" ? { kind: "raster" as const, image: { width: d.image.width, height: d.image.height, data: new Uint8ClampedArray(d.image.data) } } : { kind: "svg" as const, text: d.text };
    const traced = await engine.digitize(source, options);
    for (const t of targets) {
      if (t === "svg") {
        if (d.kind === "svg") continue; // it already is one
        out.push({ name: `${stem}.svg`, target: t, bytes: new TextEncoder().encode(traced.svg), warnings: ["This is the trace of your picture, in its pixel units, in thread colours. It is not a stitch file."] });
        continue;
      }
      const r = await engine.call("exportFormat", traced.design, t, { label });
      const warnings = [`Digitized with the Auto digitize settings in the editor (${options.colors ?? 6} colours).`, ...r.warnings.map((w) => w.message)];
      if (!hasColours(t)) warnings.push(`${t.toUpperCase()} files don't store thread colours; only the colour changes are kept.`);
      out.push({ name: `${stem}.${t}`, target: t, bytes: r.bytes, warnings });
    }
    return out;
  }

  throw new Error(`Lilo can't convert "${input.name}". It reads ${FORMAT_EXTENSIONS.map((e) => e.toUpperCase()).join(", ")}, PNG, JPG, WEBP and SVG.`);
}

/** Give outputs with the same name distinct ones ("a.pes", "a (2).pes"). */
export function uniqueNames<T extends { name: string }>(files: T[]): T[] {
  const seen = new Map<string, number>();
  return files.map((f) => {
    const n = seen.get(f.name) ?? 0;
    seen.set(f.name, n + 1);
    if (n === 0) return f;
    const dot = f.name.lastIndexOf(".");
    return { ...f, name: `${f.name.slice(0, dot)} (${n + 1})${f.name.slice(dot)}` };
  });
}
