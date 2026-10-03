import type { OcrLine, OpenedFile, OpenedPath, Platform, RecentProject } from "./types";

/**
 * An in-memory platform for tests and for `pnpm dev?mock` (screenshots, working on the UI without the
 * desktop app). Everything the real platform persists lands in `state`, where a test can look at it.
 */
export interface MockState {
  /** What `platform.kind` says. "tauri" makes Save keep a path, as on the desktop. Default "browser". */
  kind: "tauri" | "browser";
  /** Files by path: projects the Home screen lists and Open can read. */
  files: Map<string, Uint8Array>;
  recents: RecentProject[];
  shelfJson: string | null;
  /** The previous save of My Threads, offered when `shelfJson` is damaged. */
  shelfBackup: string | null;
  /** Previous saves of projects by path (`<path>.bak` on the desktop). */
  backups: Map<string, Uint8Array>;
  /** Every value passed to `setDirty`, in order. */
  dirtyReports: boolean[];
  openedUrls: string[];
  /** What `ocrImage` returns next. */
  ocr: OcrLine[] | Error;
  /** What the next `openFile`/`openFiles`/`openProjectDialog` picks. */
  pickFiles: OpenedFile[];
  pickProject: OpenedPath | null;
  /** Files written by `saveFile`, `saveFilesToFolder` and `saveProjectAs`, in order. */
  saved: { name: string; bytes: Uint8Array }[];
  /** Handler registered by `onCloseRequested`. */
  closeHandler: (() => Promise<boolean>) | null;
  /** Callback registered by `onOpenFile`. */
  openFileCb: ((f: OpenedPath) => void) | null;
}

export function createMockPlatform(init: Partial<MockState> = {}): { platform: Platform; state: MockState } {
  const state: MockState = {
    kind: "browser",
    files: new Map(),
    recents: [],
    shelfJson: null,
    shelfBackup: null,
    backups: new Map(),
    dirtyReports: [],
    openedUrls: [],
    ocr: [],
    pickFiles: [],
    pickProject: null,
    saved: [],
    closeHandler: null,
    openFileCb: null,
    ...init,
  };
  const nameOf = (p: string) => p.split(/[\\/]/).pop() ?? p;
  const platform: Platform = {
    get kind() {
      return state.kind;
    },
    discoverMachines: async () => [],
    savedMachines: async () => [],
    sendToMachine: async () => ({ jobId: "mock", state: "done", storedAs: null, error: null }),
    async saveFile(name, bytes) {
      state.saved.push({ name, bytes });
      return `/mock/${name}`;
    },
    async openFile() {
      return state.pickFiles[0] ?? null;
    },
    async openFiles() {
      return state.pickFiles;
    },
    async saveFilesToFolder(files) {
      state.saved.push(...files);
      return files.length ? "/mock" : null;
    },
    async ocrImage() {
      if (state.ocr instanceof Error) throw state.ocr;
      return state.ocr;
    },
    async listRecentProjects(limit) {
      return state.recents.slice(0, limit ?? 24);
    },
    onOpenFile(cb) {
      state.openFileCb = cb;
      return () => {
        if (state.openFileCb === cb) state.openFileCb = null;
      };
    },
    async readProjectFile(path) {
      const b = state.files.get(path);
      if (!b) throw new Error(`No such file: ${path}`);
      return b;
    },
    async writeProjectFile(path, bytes) {
      const prev = state.files.get(path);
      if (prev) state.backups.set(path, prev); // the desktop keeps the previous save as <name>.bak
      state.files.set(path, bytes);
      const name = nameOf(path).replace(/\.lilo$/i, "");
      state.recents = [{ path, name, modifiedMs: Date.now(), sizeBytes: bytes.length }, ...state.recents.filter((r) => r.path !== path)];
    },
    projectsFolder: async () => "/mock/Documents/Lilo",
    async readMyThreads() {
      const ok = (t: string) => {
        try {
          JSON.parse(t);
          return true;
        } catch {
          return false;
        }
      };
      const main = state.shelfJson;
      if (main === null || ok(main)) return { text: main, backup: null, corrupt: false };
      return { text: null, backup: state.shelfBackup && ok(state.shelfBackup) ? state.shelfBackup : null, corrupt: true };
    },
    setDirty(dirty) {
      state.dirtyReports.push(dirty);
    },
    async readProjectBackup(path) {
      return state.backups.get(path) ?? null;
    },
    async writeMyThreads(json) {
      if (state.shelfJson !== null) {
        try {
          JSON.parse(state.shelfJson);
          state.shelfBackup = state.shelfJson;
        } catch {
          // a damaged file never replaces a good backup
        }
      }
      state.shelfJson = json;
    },
    async openUrl(url) {
      state.openedUrls.push(url);
    },
    async openProjectDialog() {
      return state.pickProject;
    },
    async saveProjectAs(name, bytes) {
      const path = `/mock/Documents/Lilo/${name}`;
      await platform.writeProjectFile(path, bytes);
      return path;
    },
    onCloseRequested(handler) {
      state.closeHandler = handler;
      return () => {
        if (state.closeHandler === handler) state.closeHandler = null;
      };
    },
  };
  return { platform, state };
}
