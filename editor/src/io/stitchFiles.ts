import { READABLE_EXTENSIONS, formatFromName } from "@lilo/engine/light";

/** Which files are stitch files Lilo can open (kept free of React and the engine worker so the platform layer can use it). */

/** Stitch files are small (a big PES is a few MB). Anything past this is not one. Same figure as the desktop side (`MAX_STITCH_BYTES`). */
export const MAX_STITCH_FILE_BYTES = 32 * 1024 * 1024;

/** What Lilo can open besides `.lilo`: every format the engine reads. */
export const STITCH_EXTENSIONS: readonly string[] = READABLE_EXTENSIONS;

/** The "Open" dialog's list: Lilo projects first, then the stitch formats. */
export const OPEN_EXTENSIONS: readonly string[] = ["lilo", ...STITCH_EXTENSIONS];

export const TOO_BIG_MESSAGE = `This file is too big to open (the limit is ${MAX_STITCH_FILE_BYTES / 1024 / 1024} MB).`;

export const UNREADABLE_MESSAGE = "Lilo couldn't read this file — it may be damaged or a format we don't support.";

export const extOf = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");
export const stemOf = (name: string) => name.replace(/\.[^.\\/]+$/, "") || name;

/** Is this file name a stitch file Lilo can read (not `.lilo`, not G-code, not a picture)? */
export function isStitchFile(name: string): boolean {
  const f = formatFromName(name);
  return !!f && extOf(name) !== "" && READABLE_EXTENSIONS.includes(f);
}

export const isProjectFile = (name: string): boolean => extOf(name) === "lilo";

