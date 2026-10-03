import { validateDesign } from "../model";
import { importShelf, ShelfError } from "../threads/shelf";
import { validatePixelArt } from "../pixelart/grid";
import { PROJECT_FORMAT, PROJECT_VERSION, ProjectError, type ProjectDoc } from "./types";

/** `MIGRATIONS[n]` upgrades a version-n document to version n+1. Empty until the format first changes. */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;
export const MIGRATIONS: Record<number, Migration> = {};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Bring a parsed `project.json` up to `PROJECT_VERSION`, then check its shape. Throws `ProjectError`
 * for anything that can't be used. `migrations`/`current` are injectable for tests.
 */
export function migrateProjectDoc(
  raw: unknown,
  migrations: Record<number, Migration> = MIGRATIONS,
  current: number = PROJECT_VERSION,
): { doc: ProjectDoc; migrated: boolean } {
  if (!isObj(raw)) throw new ProjectError("invalid-project", "The project file's contents are not a Lilo project.");
  if (raw.format !== PROJECT_FORMAT) throw new ProjectError("not-a-project", "This is not a Lilo project file.");
  let version = raw.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new ProjectError("invalid-project", "The project file has no valid version number.");
  }
  if (version > current) {
    throw new ProjectError(
      "unsupported-version",
      `This project was saved by a newer version of Lilo (format ${version}; this Lilo reads up to ${current}). Update Lilo to open it.`,
    );
  }
  let doc: Record<string, unknown> = { ...raw };
  let migrated = false;
  while (version < current) {
    const step = migrations[version];
    if (!step) throw new ProjectError("unsupported-version", `This project (format ${version}) is too old to open.`);
    doc = { ...step(doc), version: version + 1 };
    version++;
    migrated = true;
  }
  return { doc: checkDoc(doc), migrated };
}

function checkDoc(d: Record<string, unknown>): ProjectDoc {
  const bad = (what: string): never => {
    throw new ProjectError("invalid-project", `The project is damaged: ${what}.`);
  };
  if (typeof d.title !== "string") d.title = "Untitled";
  if (typeof d.app !== "string") d.app = "Lilo";
  const now = new Date(0).toISOString();
  if (typeof d.createdAt !== "string") d.createdAt = now;
  if (typeof d.savedAt !== "string") d.savedAt = d.createdAt;
  if (!isObj(d.design) || !Array.isArray(d.design.threads) || !Array.isArray(d.design.objects)) bad("the design is missing");
  const problems = validateDesign(d.design as never);
  if (problems.length) bad(`the design has problems (${problems.slice(0, 3).join("; ")})`);
  if (!isObj(d.view)) d.view = { zoom: 1, panX: 0, panY: 0 };
  const view = d.view as Record<string, unknown>;
  for (const k of ["zoom", "panX", "panY"]) if (typeof view[k] !== "number" || !Number.isFinite(view[k])) view[k] = k === "zoom" ? 1 : 0;
  d.images = Array.isArray(d.images) ? d.images : [];
  d.fonts = Array.isArray(d.fonts) ? d.fonts : [];
  const ids = new Set<string>();
  for (const im of d.images as unknown[]) {
    if (!isObj(im) || typeof im.id !== "string" || typeof im.file !== "string" || typeof im.name !== "string") bad("an image entry is malformed");
    const r = im as Record<string, unknown>;
    if (ids.has(r.id as string)) bad(`image ${String(r.id)} appears twice`);
    ids.add(r.id as string);
    if (typeof r.mime !== "string") r.mime = "application/octet-stream";
    if (!SAFE_PATH.test(r.file as string) || !(r.file as string).startsWith("images/")) bad(`image path ${String(r.file)} is not allowed`);
  }
  const fontIds = new Set<string>();
  for (const f of d.fonts as unknown[]) {
    if (!isObj(f) || typeof f.id !== "string" || typeof f.name !== "string") bad("a font entry is malformed");
    const r = f as Record<string, unknown>;
    if (fontIds.has(r.id as string)) bad(`font ${String(r.id)} appears twice`);
    fontIds.add(r.id as string);
    if (r.source !== "builtin" && r.source !== "custom") r.source = "builtin";
    if (r.file !== undefined && (typeof r.file !== "string" || !SAFE_PATH.test(r.file) || !r.file.startsWith("fonts/"))) bad(`font path ${String(r.file)} is not allowed`);
  }
  try {
    d.shelf = d.shelf === undefined ? { version: 1, entries: [] } : importShelf(d.shelf);
  } catch (e) {
    bad(e instanceof ShelfError ? `the saved threads (${e.message})` : "the saved threads");
  }
  if (d.pixelArt !== undefined && d.pixelArt !== null) {
    try {
      validatePixelArt(d.pixelArt as never);
    } catch (e) {
      bad(e instanceof Error ? e.message.replace(/\.$/, "") : "the pixel art");
    }
  }
  return d as unknown as ProjectDoc;
}

/** Paths inside the zip: one folder level, plain file names, no traversal. */
export const SAFE_PATH = /^(images|fonts)\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
