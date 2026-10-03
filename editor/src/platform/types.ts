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
}
