/**
 * The `.lilo` project file: a zip holding
 *
 * ```
 * project.json        versioned document (below)
 * thumbnail.png       preview for the recent-projects gallery
 * images/<id>.<ext>   reference images, as imported
 * fonts/<id>.<ext>    custom fonts the design's lettering uses
 * history/<n>-<hash>.json   the last 50 distinct saved states
 * ```
 *
 * Everything in `project.json` is plain JSON so it survives structured clone and Immer.
 */
import type { Design } from "../model";
import type { PixelArt } from "../pixelart/grid";
import type { Shelf } from "../threads/shelf";

/** Bump when `ProjectDoc` changes incompatibly and add a step to `MIGRATIONS` in `migrate.ts`. */
/** 2 = Lilo 1.3: layers. Older Lilo versions refuse it with the "newer version of Lilo" message. */
export const PROJECT_VERSION = 2;
export const PROJECT_FORMAT = "lilo-project";
export const PROJECT_EXTENSION = "lilo";
export const HISTORY_LIMIT = 50;

/** Canvas state worth restoring: where you were looking, what was selected. The editor owns extra keys. */
export interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
  [key: string]: unknown;
}

/** A reference image placed on the canvas (the bytes live in the zip under `file`). */
export interface ImageRef {
  /** Unique within the project. */
  id: string;
  /** Original file name, for display. */
  name: string;
  /** Path inside the zip, `images/<something>`. */
  file: string;
  mime: string;
  /** Position, scale, opacity, lock...: whatever the editor wants back. */
  placement?: Record<string, unknown>;
}

/** A font a design's lettering uses. Built-in fonts are referenced by id; custom ones are embedded. */
export interface FontRef {
  id: string;
  name: string;
  source: "builtin" | "custom";
  /** Path inside the zip, `fonts/<something>`; custom fonts only. */
  file?: string;
  licence?: string;
}

export interface ProjectDoc {
  format: typeof PROJECT_FORMAT;
  version: number;
  /** Which Lilo wrote it, e.g. "Lilo 0.1.0". Informational. */
  app: string;
  title: string;
  createdAt: string;
  savedAt: string;
  design: Design;
  view: ViewState;
  images: ImageRef[];
  /** Snapshot of My Threads at save time. */
  shelf: Shelf;
  fonts: FontRef[];
  /** The pixel-art editor's grid, if the project has one. */
  pixelArt?: PixelArt | null;
}

/** One saved state in the version history (the document as JSON, so many can sit in memory cheaply). */
export interface HistoryEntry {
  /** `<sequence>-<hash>`, also the file name stem. */
  id: string;
  savedAt: string;
  /** Hash of the content that matters (not view or save time); equal hash = nothing changed. */
  hash: string;
  /** The `ProjectDoc` as JSON text. */
  json: string;
}

/** A project in memory: the document plus the binary assets and history that travel with it. */
export interface LiloProject {
  doc: ProjectDoc;
  /** Image bytes by `ImageRef.id`. */
  images: Record<string, Uint8Array>;
  /** Font bytes by `FontRef.id` (custom fonts). */
  fonts: Record<string, Uint8Array>;
  thumbnail?: Uint8Array;
  /** Oldest first. */
  history: HistoryEntry[];
}

export type ProjectErrorCode =
  | "not-a-project"
  | "missing-project-json"
  | "invalid-json"
  | "unsupported-version"
  | "invalid-project";

/** Thrown for any file Lilo can't open; `message` is fit to show the user. */
export class ProjectError extends Error {
  constructor(
    readonly code: ProjectErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectError";
  }
}

export interface LoadResult {
  project: LiloProject;
  /** Things that were wrong but not fatal: a missing image, an unreadable history entry. */
  warnings: string[];
  /** True when an older file was upgraded in memory. */
  migrated: boolean;
}
