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

/** What is on disk for My Threads. `corrupt` means the file is there but unreadable; `backup` is the previous save, if that one is good. */
export interface MyThreadsFile {
  text: string | null;
  backup: string | null;
  corrupt: boolean;
}

/** What is on disk for the custom hoops list (`hoops.json`). Same shape as `MyThreadsFile`. */
export interface HoopsFile {
  text: string | null;
  backup: string | null;
  corrupt: boolean;
}

/** The display the window is on. `pxPerMm` is CSS pixels per physical millimetre, null when the OS can't say. */
export interface ScreenInfo {
  pxPerMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  widthPt: number | null;
  source: "display" | "unknown";
}

/** What is behind the page: see `app/src-tauri/src/glass.rs`. `solid` = nothing see-through. */
export type WindowMaterial = "liquid-glass" | "vibrancy" | "mica" | "solid";

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

  // ---- M5 screens ----------------------------------------------------------------------------
  /** Let the user pick several files (the converter). Resolves to [] if cancelled. */
  openFiles(options?: OpenFileOptions): Promise<OpenedFile[]>;
  /** Save several files into a folder the user picks (one prompt, not one per file). Resolves to the folder, or null if cancelled. The browser downloads each. */
  saveFilesToFolder(files: { name: string; bytes: Uint8Array }[]): Promise<string | null>;
  /** The My Threads shelf as JSON text (`~/Documents/Lilo/my-threads.json`; localStorage in the browser), or null if there is none yet. */
  readMyThreads(): Promise<MyThreadsFile>;
  writeMyThreads(json: string): Promise<void>;
  /** Open a web page in the user's browser. */
  openUrl(url: string): Promise<void>;
  /**
   * Native "Open project" dialog, starting in the default folder. The chosen file can then be saved
   * to. In the browser (no path) the project opens but Save downloads a copy.
   */
  openProjectDialog(): Promise<OpenedPath | null>;
  /** Native "Save project as" dialog, starting in the default folder. Resolves to the saved path (a file name in the browser, where it downloads), or null if cancelled. */
  saveProjectAs(suggestedName: string, bytes: Uint8Array): Promise<string | null>;
  /**
   * Called whenever the user tries to quit: closing the window, Cmd-Q, the app menu, the Dock, the tray's
   * Quit. Lilo stays open until `handler` resolves to true (it can show an "unsaved changes" prompt
   * first). Returns the unsubscribe function.
   */
  onCloseRequested(handler: () => Promise<boolean>): Unsubscribe;
  /** Tell the shell whether there are unsaved changes, so it can hold back a quit it can't ask about itself. */
  setDirty(dirty: boolean): void;
  /** The previous save of a project (its `.bak`), for when the file is damaged. Null if there is none. */
  readProjectBackup(path: string): Promise<Uint8Array | null>;

  // ---- M6a: glass + hoops --------------------------------------------------------------------
  /** The user's own hoops as JSON text (`~/Documents/Lilo/hoops.json`; localStorage in the browser). */
  readHoops(): Promise<HoopsFile>;
  writeHoops(json: string): Promise<void>;
  /** The physical size of the screen the window is on (for Actual size). Unknown in the browser. */
  screenInfo(): Promise<ScreenInfo>;
  /** What the window is made of, once known; `callback` runs for the first answer and any change. Returns the unsubscribe function. The browser is always `solid`. */
  onWindowMaterial(callback: (material: WindowMaterial) => void): Unsubscribe;
  /** Has the user asked the OS for "Reduce transparency"? (macOS accessibility setting; false elsewhere and in the browser.) */
  reduceTransparency(): Promise<boolean>;
  /** Make the native window (and its glass) light or dark, or follow the system again (null). No-op in the browser. */
  setWindowTheme(theme: "light" | "dark" | null): Promise<void>;
}
