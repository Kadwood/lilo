import type { OcrLine, OpenedFile, OpenedPath, Platform, PlatformMachine, RecentProject, ScreenInfo, SendResult, WindowMaterial } from "./types";

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
  /** Saved machines (what the Send dialog lists). */
  machines: PlatformMachine[];
  /** Machines a network sweep finds besides the saved ones. */
  found: PlatformMachine[];
  /** What `sendToMachine` answers (an Error is thrown), and every send it was given. */
  sendResult: SendResult | Error;
  sends: { ip: string; filename: string; bytes: Uint8Array }[];
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
  /** `hoops.json` text and its previous save. */
  hoopsJson: string | null;
  hoopsBackup: string | null;
  /** What `screenInfo` returns. */
  screen: ScreenInfo;
  /** What `onWindowMaterial` reports. */
  material: WindowMaterial;
  /** What `reduceTransparency` answers. */
  systemReduceTransparency: boolean;
  /** Every theme passed to `setWindowTheme`, in order. */
  themeCalls: ("light" | "dark" | null)[];
}

export function createMockPlatform(init: Partial<MockState> = {}): { platform: Platform; state: MockState } {
  const state: MockState = {
    kind: "browser",
    files: new Map(),
    recents: [],
    shelfJson: null,
    shelfBackup: null,
    backups: new Map(),
    machines: [],
    found: [],
    sendResult: { jobId: "mock", state: "done", storedAs: null, error: null },
    sends: [],
    dirtyReports: [],
    openedUrls: [],
    ocr: [],
    pickFiles: [],
    pickProject: null,
    saved: [],
    closeHandler: null,
    openFileCb: null,
    hoopsJson: null,
    hoopsBackup: null,
    screen: { pxPerMm: null, widthMm: null, heightMm: null, widthPt: null, source: "unknown" },
    material: "solid",
    systemReduceTransparency: false,
    themeCalls: [],
    ...init,
  };
  const nameOf = (p: string) => p.split(/[\\/]/).pop() ?? p;
  const platform: Platform = {
    get kind() {
      return state.kind;
    },
    discoverMachines: async () => [...state.machines, ...state.found.filter((f) => !state.machines.some((m) => m.ip === f.ip))],
    savedMachines: async () => state.machines,
    async sendToMachine(ip, filename, bytes, options) {
      state.sends.push({ ip, filename, bytes });
      options?.onProgress?.({ state: "uploading", sentBytes: 0, totalBytes: bytes.length });
      options?.onProgress?.({ state: "uploading", sentBytes: bytes.length, totalBytes: bytes.length });
      if (state.sendResult instanceof Error) throw state.sendResult;
      return state.sendResult;
    },
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
    async recordRecent(path) {
      // like the desktop: only files that exist, newest first, one row per path
      const bytes = state.files.get(path);
      if (!bytes) return;
      const name = nameOf(path).replace(/\.lilo$/i, "");
      state.recents = [{ path, name, modifiedMs: Date.now(), sizeBytes: bytes.length }, ...state.recents.filter((r) => r.path !== path)];
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
    async readHoops() {
      const main = state.hoopsJson;
      if (main === null) return { text: null, backup: null, corrupt: false };
      try {
        JSON.parse(main);
        return { text: main, backup: null, corrupt: false };
      } catch {
        let backup: string | null = null;
        try {
          if (state.hoopsBackup) {
            JSON.parse(state.hoopsBackup);
            backup = state.hoopsBackup;
          }
        } catch {
          // a damaged backup is no backup
        }
        return { text: null, backup, corrupt: true };
      }
    },
    async writeHoops(json) {
      if (state.hoopsJson !== null) {
        try {
          JSON.parse(state.hoopsJson);
          state.hoopsBackup = state.hoopsJson;
        } catch {
          // a damaged file never replaces a good backup
        }
      }
      state.hoopsJson = json;
    },
    screenInfo: async () => state.screen,
    onWindowMaterial(callback) {
      callback(state.material);
      return () => {};
    },
    reduceTransparency: async () => state.systemReduceTransparency,
    async setWindowTheme(theme) {
      state.themeCalls.push(theme);
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
