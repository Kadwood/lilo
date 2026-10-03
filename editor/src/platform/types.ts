/**
 * The only door from the editor to the outside world. The Tauri build wraps Lilo Link (the Rust
 * side); the browser build (phase 2 web) gets a stub. Nothing else in the editor may import
 * `@tauri-apps/*` outside `src/platform/` and `src/link/`.
 */

export interface PlatformMachine {
  ip: string;
  /** Nickname if saved, else the machine's own name/model. */
  name: string;
  manufacturer: string | null;
  serial: string | null;
  model: string | null;
  /** True if the user has saved this machine in Lilo Link. */
  saved: boolean;
}

export type SendState = "queued" | "uploading" | "done" | "failed" | "waiting" | "cancelled" | "needs_reconciliation";

export interface SendProgress {
  state: SendState;
  sentBytes: number;
  totalBytes: number;
}

export interface SendResult {
  jobId: string;
  state: SendState;
  /** Name the machine stored the file under, when known. */
  storedAs: string | null;
  error: string | null;
}

export interface SendOptions {
  onProgress?: (progress: SendProgress) => void;
}

export interface OpenFileOptions {
  /** File extensions without the dot, e.g. ["pes", "dst"]. */
  extensions?: string[];
}

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
}

/** One line of recognised text from a photo (Apple Vision on macOS). */
export interface OcrLine {
  text: string;
  /** 0..1. */
  confidence: number;
  /** Fractions of the image, origin top-left. */
  bbox: { x: number; y: number; width: number; height: number };
}

/** A `.lilo` file in the default projects folder. The thumbnail is inside the file (`readProjectInfo`). */
export interface RecentProject {
  path: string;
  /** File name without `.lilo`. */
  name: string;
  modifiedMs: number;
  sizeBytes: number;
}

/** A project file the OS asked Lilo to open (Finder double-click, "Open With", command line). */
export interface OpenedPath {
  path: string;
  name: string;
  bytes: Uint8Array;
}

export type Unsubscribe = () => void;

export interface Platform {
  readonly kind: "tauri" | "browser";
  /** Saved machines plus a fresh network sweep (takes seconds). */
  discoverMachines(): Promise<PlatformMachine[]>;
  /** Saved machines only (instant). Extra to the M1 brief: lets the Send menu open without a sweep. */
  savedMachines(): Promise<PlatformMachine[]>;
  /** Queue the file for the machine and resolve when the job finishes (or fails). */
  sendToMachine(ip: string, filename: string, bytes: Uint8Array, options?: SendOptions): Promise<SendResult>;
  /** Save bytes where the user chooses. Resolves to the path/name saved, or null if cancelled. */
  saveFile(suggestedName: string, bytes: Uint8Array): Promise<string | null>;
  /** Let the user pick a file. Resolves to null if cancelled. */
  openFile(options?: OpenFileOptions): Promise<OpenedFile | null>;

  /**
   * Read the text on an image (a photo of a thread-spool label). Rejects with a message starting
   * "unsupported" where the OS has no recogniser (everything but macOS, and the browser).
   */
  ocrImage(bytes: Uint8Array): Promise<OcrLine[]>;
  /** `.lilo` projects in the default folder (`~/Documents/Lilo`), newest first. */
  listRecentProjects(limit?: number): Promise<RecentProject[]>;
  /**
   * Called for every project the OS opens in Lilo: first any that arrived before this call (a
   * double-click that launched the app), then each later one. Returns the unsubscribe function.
   */
  onOpenFile(callback: (file: OpenedPath) => void): Unsubscribe;
  /** Bytes of a project in the default folder or one the OS opened. Not for arbitrary paths. */
  readProjectFile(path: string): Promise<Uint8Array>;
  /** Save project bytes atomically to such a path. */
  writeProjectFile(path: string, bytes: Uint8Array): Promise<void>;
  /** The default projects folder (created on first use); null in the browser. */
  projectsFolder(): Promise<string | null>;
}
