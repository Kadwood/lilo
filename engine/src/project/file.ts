import { Unzip, UnzipInflate, UnzipPassThrough, unzipSync, zipSync, strFromU8, strToU8, type Unzipped, type Zippable } from "fflate";
import { emptyDesign, type Design } from "../model";
import { emptyShelf, type Shelf } from "../threads/shelf";
import { migrateProjectDoc, SAFE_PATH } from "./migrate";
import {
  HISTORY_LIMIT,
  PROJECT_FORMAT,
  PROJECT_VERSION,
  ProjectError,
  type FontRef,
  type HistoryEntry,
  type ImageRef,
  type LiloProject,
  type LoadResult,
  type ProjectDoc,
} from "./types";

/** Refuse zips that unpack to more than this (zip bombs), per file and in total. */
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 5000;

const PROJECT_JSON = "project.json";
const THUMBNAIL = "thumbnail.png";

export interface NewProjectOptions {
  title?: string;
  design?: Design;
  shelf?: Shelf;
  app?: string;
  now?: Date;
}

/** A fresh, empty project. */
export function createProject(options: NewProjectOptions = {}): LiloProject {
  const now = (options.now ?? new Date()).toISOString();
  return {
    doc: {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      app: options.app ?? "Lilo",
      title: options.title ?? "Untitled",
      createdAt: now,
      savedAt: now,
      design: options.design ?? emptyDesign(),
      view: { zoom: 1, panX: 0, panY: 0 },
      images: [],
      shelf: options.shelf ?? emptyShelf(),
      fonts: [],
      pixelArt: null,
    },
    images: {},
    fonts: {},
    history: [],
  };
}

// ---- content hash + history -----------------------------------------------------------------

/** 53-bit string hash (cyrb53). Not cryptographic: it only has to tell two saved states apart. */
export function hashString(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** What counts as a change worth a history entry: not the view, not the save time. */
export function contentHash(doc: ProjectDoc): string {
  return hashString(
    JSON.stringify({ t: doc.title, d: doc.design, i: doc.images, s: doc.shelf, f: doc.fonts, p: doc.pixelArt ?? null }),
  );
}

const seqOf = (e: HistoryEntry) => Number.parseInt(e.id.split("-")[0], 10) || 0;

/**
 * Record the current document in the version history, unless it matches the newest entry. Keeps the
 * latest `HISTORY_LIMIT` (50) entries. Returns the same object when nothing changed.
 */
export function addHistorySnapshot(project: LiloProject, now: Date = new Date(), limit: number = HISTORY_LIMIT): LiloProject {
  const hash = contentHash(project.doc);
  const last = project.history[project.history.length - 1];
  if (last && last.hash === hash) return project;
  const seq = last ? seqOf(last) + 1 : 1;
  const entry: HistoryEntry = {
    id: `${String(seq).padStart(6, "0")}-${hash}`,
    savedAt: now.toISOString(),
    hash,
    json: JSON.stringify(project.doc),
  };
  const history = [...project.history, entry];
  return { ...project, history: history.length > limit ? history.slice(history.length - limit) : history };
}

/** The document stored in a history entry (validated like a freshly loaded one). */
export function historyDoc(entry: HistoryEntry): ProjectDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(entry.json);
  } catch {
    throw new ProjectError("invalid-json", "That history entry is unreadable.");
  }
  return migrateProjectDoc(raw).doc;
}

/** Go back to a history entry. The current state is snapshotted first so nothing is lost. */
export function restoreHistory(project: LiloProject, entryId: string, now: Date = new Date()): LiloProject {
  const entry = project.history.find((e) => e.id === entryId);
  if (!entry) throw new ProjectError("invalid-project", "That history entry no longer exists.");
  const saved = addHistorySnapshot(project, now);
  const old = historyDoc(entry);
  return { ...saved, doc: { ...old, view: project.doc.view, savedAt: project.doc.savedAt } };
}

// ---- images and fonts -----------------------------------------------------------------------

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/svg+xml": "svg",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "font/collection": "ttc",
};

/** Add a reference image (bytes and its `ImageRef`). Re-adding an id replaces it. */
export function addImage(
  project: LiloProject,
  img: { id: string; name: string; mime: string; bytes: Uint8Array; placement?: Record<string, unknown> },
): LiloProject {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,60}$/.test(img.id)) throw new ProjectError("invalid-project", "Image ids must be letters, digits, - or _.");
  const ext = EXT_BY_MIME[img.mime] ?? (/\.([A-Za-z0-9]{1,5})$/.exec(img.name)?.[1].toLowerCase() ?? "bin");
  const ref: ImageRef = { id: img.id, name: img.name, mime: img.mime, file: `images/${img.id}.${ext}`, ...(img.placement ? { placement: img.placement } : {}) };
  return {
    ...project,
    doc: { ...project.doc, images: [...project.doc.images.filter((i) => i.id !== img.id), ref] },
    images: { ...project.images, [img.id]: img.bytes },
  };
}

/** The biggest font file embedded in a project. Fonts are the user's own; this only guards the file's size. */
export const MAX_FONT_BYTES = 20 * 1024 * 1024;

/**
 * Embed a custom (uploaded) font: its bytes go in `fonts/` and a `FontRef` records which text blocks'
 * `custom:<id>` it is. Throws `ProjectError` for a font over `MAX_FONT_BYTES`. Re-adding an id replaces it.
 */
export function addFont(
  project: LiloProject,
  font: { id: string; name: string; bytes: Uint8Array; ext?: string; licence?: string },
): LiloProject {
  if (font.bytes.length > MAX_FONT_BYTES) throw new ProjectError("invalid-project", `The font "${font.name}" is over ${MAX_FONT_BYTES / 1024 / 1024} MB, too big to keep in the project.`);
  const ext = /^(ttf|otf|ttc)$/i.test(font.ext ?? "") ? font.ext!.toLowerCase() : "ttf";
  const others = project.doc.fonts.filter((f) => f.id !== font.id);
  const used = new Set(others.map((f) => f.file));
  let n = others.length + 1;
  while (used.has(`fonts/font-${n}.${ext}`)) n++;
  const ref: FontRef = { id: font.id, name: font.name, source: "custom", file: `fonts/font-${n}.${ext}`, ...(font.licence ? { licence: font.licence } : {}) };
  return { ...project, doc: { ...project.doc, fonts: [...others, ref] }, fonts: { ...project.fonts, [font.id]: font.bytes } };
}

export function removeImage(project: LiloProject, id: string): LiloProject {
  const { [id]: _gone, ...rest } = project.images;
  void _gone;
  return { ...project, doc: { ...project.doc, images: project.doc.images.filter((i) => i.id !== id) }, images: rest };
}

// ---- save / load ----------------------------------------------------------------------------

/** Pack a project into `.lilo` bytes. Sets `savedAt`. Images and the thumbnail are stored, not recompressed. */
export function saveProject(project: LiloProject, now: Date = new Date()): Uint8Array {
  const doc: ProjectDoc = { ...project.doc, version: PROJECT_VERSION, savedAt: now.toISOString() };
  const mtime = now.getFullYear() >= 1980 ? now : new Date(1980, 0, 1);
  const stored = { level: 0 as const, mtime };
  const packed = { level: 6 as const, mtime };
  const files: Zippable = { [PROJECT_JSON]: [strToU8(JSON.stringify(doc, null, 1)), packed] };
  if (project.thumbnail) files[THUMBNAIL] = [project.thumbnail, stored];
  for (const ref of doc.images) {
    const bytes = project.images[ref.id];
    if (bytes) files[ref.file] = [bytes, ref.mime === "image/svg+xml" ? packed : stored];
  }
  for (const ref of doc.fonts) {
    const bytes = project.fonts[ref.id];
    if (bytes && ref.file) files[ref.file] = [bytes, packed];
  }
  for (const h of project.history) files[`history/${h.id}.json`] = [strToU8(JSON.stringify({ savedAt: h.savedAt, doc: JSON.parse(h.json) })), packed];
  return zipSync(files);
}

export interface UnpackLimits {
  maxFileBytes: number;
  maxTotalBytes: number;
  maxEntries: number;
}
const DEFAULT_LIMITS: UnpackLimits = { maxFileBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_TOTAL_BYTES, maxEntries: MAX_ENTRIES };

class TooBig extends Error {}

/**
 * Unzip with caps on what actually comes out. The sizes in zip headers are attacker-controlled, so
 * they are not trusted: entries are inflated as a stream and counted, and the run aborts the moment a
 * cap is passed. `unzipSync` first (names only) validates the zip's structure and entry count.
 */
function unpack(bytes: Uint8Array, only?: (name: string) => boolean, limits: UnpackLimits = DEFAULT_LIMITS): Unzipped {
  if (bytes.length < 22) throw new ProjectError("not-a-project", "This isn't a Lilo project (the file is too small).");
  const damaged = () => new ProjectError("not-a-project", "This isn't a Lilo project, or the file is damaged (it can't be unzipped).");
  const big = () => new ProjectError("not-a-project", "This project file is unreasonably large and was not opened.");
  let entries = 0;
  try {
    unzipSync(bytes, { filter: () => (++entries, false) });
  } catch {
    throw damaged();
  }
  if (entries > limits.maxEntries) throw big();

  const out: Unzipped = {};
  let total = 0;
  try {
    const u = new Unzip();
    u.register(UnzipInflate);
    u.register(UnzipPassThrough);
    u.onfile = (f) => {
      if (only && !only(f.name)) return;
      const chunks: Uint8Array[] = [];
      let size = 0;
      f.ondata = (err, chunk, final) => {
        if (err) throw err;
        size += chunk.length;
        total += chunk.length;
        if (size > limits.maxFileBytes || total > limits.maxTotalBytes) throw new TooBig();
        chunks.push(chunk);
        if (final) {
          const data = new Uint8Array(size);
          let at = 0;
          for (const c of chunks) {
            data.set(c, at);
            at += c.length;
          }
          out[f.name] = data;
        }
      };
      f.start();
    };
    u.push(bytes, true);
  } catch (e) {
    if (e instanceof TooBig) throw big();
    throw damaged();
  }
  return out;
}

function parseHistory(files: Unzipped, warnings: string[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const [name, data] of Object.entries(files)) {
    const m = /^history\/(\d{1,9})-([0-9a-f]{1,32})\.json$/.exec(name);
    if (!m) continue;
    try {
      const j = JSON.parse(strFromU8(data)) as { savedAt?: unknown; doc?: unknown };
      const { doc } = migrateProjectDoc(j.doc);
      entries.push({
        id: `${m[1]}-${m[2]}`,
        savedAt: typeof j.savedAt === "string" ? j.savedAt : doc.savedAt,
        hash: contentHash(doc),
        json: JSON.stringify(doc),
      });
    } catch {
      warnings.push(`Skipped an unreadable history entry (${name}).`);
    }
  }
  return entries.sort((a, b) => seqOf(a) - seqOf(b)).slice(-HISTORY_LIMIT);
}

/** Open `.lilo` bytes. Throws `ProjectError` (with a message for the user) if it can't be opened. */
export function loadProject(bytes: Uint8Array, limits?: Partial<UnpackLimits>): LoadResult {
  const files = unpack(bytes, undefined, { ...DEFAULT_LIMITS, ...limits });
  const main = files[PROJECT_JSON];
  if (!main) throw new ProjectError("missing-project-json", "This isn't a Lilo project (project.json is missing).");
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(main));
  } catch {
    throw new ProjectError("invalid-json", "The project file is damaged (project.json is not valid JSON). Its history may still be recoverable.");
  }
  const { doc, migrated } = migrateProjectDoc(raw);
  const warnings: string[] = [];
  const images: Record<string, Uint8Array> = {};
  for (const ref of doc.images) {
    const data = files[ref.file];
    if (data) images[ref.id] = data;
    else warnings.push(`The reference image "${ref.name}" is missing from the file.`);
  }
  const fonts: Record<string, Uint8Array> = {};
  for (const ref of doc.fonts) {
    if (ref.source !== "custom" || !ref.file) continue;
    const data = files[ref.file];
    if (data) fonts[ref.id] = data;
    else warnings.push(`The custom font "${ref.name}" is missing from the file.`);
  }
  const project: LiloProject = {
    doc,
    images,
    fonts,
    ...(files[THUMBNAIL] ? { thumbnail: files[THUMBNAIL] } : {}),
    history: parseHistory(files, warnings),
  };
  return { project, warnings, migrated };
}

export interface ProjectInfo {
  title: string;
  savedAt: string;
  version: number;
  thumbnail?: Uint8Array;
}

/** Title, save time and thumbnail only, without unpacking images: for the recent-projects gallery. */
export function readProjectInfo(bytes: Uint8Array): ProjectInfo {
  const files = unpack(bytes, (n) => n === PROJECT_JSON || n === THUMBNAIL);
  const main = files[PROJECT_JSON];
  if (!main) throw new ProjectError("missing-project-json", "This isn't a Lilo project (project.json is missing).");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(strFromU8(main)) as Record<string, unknown>;
  } catch {
    throw new ProjectError("invalid-json", "The project file is damaged (project.json is not valid JSON).");
  }
  if (raw.format !== PROJECT_FORMAT) throw new ProjectError("not-a-project", "This is not a Lilo project file.");
  return {
    title: typeof raw.title === "string" ? raw.title : "Untitled",
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : "",
    version: typeof raw.version === "number" ? raw.version : 0,
    ...(files[THUMBNAIL] ? { thumbnail: files[THUMBNAIL] } : {}),
  };
}

/**
 * Salvage the version history from a project whose `project.json` is damaged: returns every history
 * entry that still parses (newest last). Never throws on a damaged document, only on a damaged zip.
 */
export function recoverHistory(bytes: Uint8Array): { entries: HistoryEntry[]; warnings: string[] } {
  const files = unpack(bytes, (n) => n.startsWith("history/"));
  const warnings: string[] = [];
  return { entries: parseHistory(files, warnings), warnings };
}

export { SAFE_PATH };
