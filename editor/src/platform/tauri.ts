import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { readFile, stat, writeFile } from "@tauri-apps/plugin-fs";
import { MAX_STITCH_FILE_BYTES, OPEN_EXTENSIONS, STITCH_EXTENSIONS, TOO_BIG_MESSAGE, isProjectFile } from "../io/stitchFiles";
import { BridgeClient } from "../link/api/client";
import type { SavedMachine } from "../link/api/types";
import type { JobRecord } from "../link/api/types";
import type { HoopsFile, MyThreadsFile, OcrLine, OpenedPath, Platform, PlatformMachine, RecentProject, ScreenInfo, SendResult, WindowMaterial } from "./types";

const TERMINAL = new Set(["done", "failed", "cancelled", "needs_reconciliation"]);
const POLL_MS = 500;
/** Brother machines can take a while to accept a file; give up polling (not the job) after this. */
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

let clientPromise: Promise<BridgeClient> | null = null;
/** One connection to the local Lilo Link API (port + token come from the Rust side). */
function client(): Promise<BridgeClient> {
  clientPromise ??= BridgeClient.connect().catch((e) => {
    clientPromise = null;
    throw e;
  });
  return clientPromise;
}

const nameOf = (p: string) => p.split(/[\\/]/).pop() ?? p;
/** A stitch file the OS opened for Lilo (Finder double-click, "Open with"): handed over once, by the desktop side. */
async function readOpenedStitchFile(path: string): Promise<Uint8Array> {
  const data = await invoke<ArrayBuffer | number[]>("read_opened_stitch_file", { path });
  return data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data);
}
const joinPath = (dir: string, name: string) => `${dir}${dir.includes("\\") && !dir.includes("/") ? "\\" : "/"}${name}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fromSaved(m: SavedMachine): PlatformMachine {
  return {
    ip: m.ip,
    name: m.nickname || m.ip,
    manufacturer: m.manufacturer ?? null,
    serial: m.serial ?? null,
    model: null,
    saved: true,
  };
}

function toResult(job: JobRecord): SendResult {
  return { jobId: job.id, state: job.state, storedAs: job.storedAs, error: job.error };
}

export const tauriPlatform: Platform = {
  kind: "tauri",

  async savedMachines() {
    return (await (await client()).machines()).saved.map(fromSaved);
  },

  async discoverMachines() {
    const c = await client();
    const found = (await c.discover()).discovered;
    const { saved } = await c.machines();
    const out = new Map<string, PlatformMachine>(saved.map((m) => [m.ip, fromSaved(m)]));
    for (const { info } of found) {
      const { identity } = info;
      if (out.has(identity.ip)) continue;
      out.set(identity.ip, {
        ip: identity.ip,
        name: identity.name || identity.model,
        manufacturer: identity.manufacturer,
        serial: identity.serial,
        model: identity.model,
        saved: false,
      });
    }
    return [...out.values()];
  },

  async sendToMachine(ip, filename, bytes, options) {
    const c = await client();
    // Send with the saved machine's identity so the Rust side can check it is the same device.
    const saved = (await c.machines()).saved.find((m) => m.ip === ip);
    const identity =
      saved?.manufacturer && saved.serial
        ? { manufacturer: saved.manufacturer, serial: saved.serial }
        : undefined;
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    let job = await c.send(ip, filename, body, identity);
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    for (;;) {
      options?.onProgress?.({ state: job.state, sentBytes: job.sentBytes, totalBytes: job.totalBytes });
      if (TERMINAL.has(job.state) || Date.now() > deadline) return toResult(job);
      await sleep(POLL_MS);
      job = await c.job(job.id);
    }
  },

  async saveFile(suggestedName, bytes) {
    const path = await save({ defaultPath: suggestedName });
    if (!path) return null;
    await writeFile(path, bytes);
    return path;
  },

  async openFile(options) {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: options?.extensions?.length ? [{ name: "Embroidery", extensions: options.extensions }] : undefined,
    });
    if (!picked) return null;
    const bytes = await readFile(picked);
    return { name: picked.split(/[\\/]/).pop() ?? picked, bytes };
  },

  async openFiles(options) {
    const picked = await open({
      multiple: true,
      directory: false,
      filters: options?.extensions?.length ? [{ name: "Files", extensions: options.extensions }] : undefined,
    });
    if (!picked) return [];
    return Promise.all(picked.map(async (p) => ({ name: nameOf(p), bytes: await readFile(p) })));
  },

  async saveFilesToFolder(files) {
    const dir = await open({ multiple: false, directory: true, title: "Choose a folder to save into" });
    if (!dir) return null;
    for (const f of files) await writeFile(joinPath(dir, f.name), f.bytes);
    return dir;
  },

  readMyThreads() {
    return invoke<MyThreadsFile>("read_my_threads");
  },

  setDirty(dirty) {
    void Promise.resolve(invoke("set_dirty", { dirty })).catch(() => {});
  },

  async readProjectBackup(path) {
    try {
      const data = await invoke<ArrayBuffer | number[]>("read_project_backup", { path });
      return data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data);
    } catch {
      return null;
    }
  },

  async writeMyThreads(json) {
    await invoke("write_my_threads", { json });
  },

  async openUrl(url) {
    await openUrl(url);
  },

  async openProjectDialog() {
    const folder = await invoke<string>("projects_folder").catch(() => undefined);
    const picked = await open({
      multiple: false,
      directory: false,
      defaultPath: folder,
      filters: [
        { name: "Lilo projects and stitch files", extensions: [...OPEN_EXTENSIONS] },
        { name: "Lilo project", extensions: ["lilo"] },
        { name: "Stitch files", extensions: [...STITCH_EXTENSIONS] },
      ],
    });
    if (!picked) return null;
    if (!isProjectFile(picked)) {
      // a stitch file: read once with the permission the dialog just gave, never registered for saving
      const info = await stat(picked);
      if (info.size > MAX_STITCH_FILE_BYTES) throw new Error(TOO_BIG_MESSAGE);
      return { path: "", name: nameOf(picked), bytes: await readFile(picked) };
    }
    await invoke("allow_project_path", { path: picked });
    return { path: picked, name: nameOf(picked), bytes: await tauriPlatform.readProjectFile(picked) };
  },

  async saveProjectAs(suggestedName, bytes) {
    const folder = await invoke<string>("projects_folder").catch(() => undefined);
    const path = await save({ defaultPath: folder ? joinPath(folder, suggestedName) : suggestedName, filters: [{ name: "Lilo project", extensions: ["lilo"] }] });
    if (!path) return null;
    const withExt = /\.lilo$/i.test(path) ? path : `${path}.lilo`;
    await invoke("allow_project_path", { path: withExt });
    await tauriPlatform.writeProjectFile(withExt, bytes);
    return withExt;
  },

  onCloseRequested(handler) {
    let active = true;
    const unlisten: (() => void)[] = [];
    // one at a time: a second request while the question is open must not open a second question
    let asking = false;
    const ask = async () => {
      if (asking) return;
      asking = true;
      try {
        // the shell exits for real only on `quit_now`; it knows how to do that without asking again
        if (await handler()) await invoke("quit_now");
      } finally {
        asking = false;
      }
    };
    const keep = (u: () => void) => (active ? unlisten.push(u) : u());
    // the window's own close button
    void getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        void ask();
      })
      .then(keep);
    // Cmd-Q, the app menu, the Dock and the tray's Quit: the shell holds the exit back and asks us
    void listen("lilo-quit-requested", () => void ask()).then(keep);
    return () => {
      active = false;
      unlisten.splice(0).forEach((u) => u());
    };
  },

  ocrImage(bytes) {
    // a Uint8Array goes to Rust as the raw request body (no JSON round trip for megabytes)
    return invoke<OcrLine[]>("ocr_image", bytes);
  },

  recordRecent(path) {
    return invoke<void>("record_recent", { path });
  },

  listRecentProjects(limit) {
    return invoke<RecentProject[]>("list_recent_projects", { limit });
  },

  onOpenFile(callback) {
    let active = true;
    let unlisten: (() => void) | null = null;
    const drain = async () => {
      const paths = await invoke<string[]>("take_open_files");
      for (const path of paths) {
        if (!active) return;
        try {
          // a stitch file (PES, DST, ...) comes back once and with no path: Lilo never saves over it
          const stitch = !isProjectFile(path);
          const bytes = stitch ? await readOpenedStitchFile(path) : await tauriPlatform.readProjectFile(path);
          const file: OpenedPath = { path: stitch ? "" : path, name: nameOf(path), bytes };
          callback(file);
        } catch (e) {
          console.error(`Could not open ${path}`, e);
        }
      }
    };
    void listen("lilo-open-file", () => void drain()).then((u) => {
      if (active) unlisten = u;
      else u();
    });
    void drain();
    return () => {
      active = false;
      unlisten?.();
    };
  },

  async readProjectFile(path) {
    const data = await invoke<ArrayBuffer | number[]>("read_project_file", { path });
    return data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data);
  },

  async writeProjectFile(path, bytes) {
    await invoke("write_project_file", bytes, { headers: { path: encodeURIComponent(path) } });
  },

  projectsFolder() {
    return invoke<string>("projects_folder");
  },

  readHoops() {
    return invoke<HoopsFile>("read_hoops_file");
  },

  async writeHoops(json) {
    await invoke("write_hoops_file", { json });
  },

  screenInfo() {
    return invoke<ScreenInfo>("screen_info");
  },

  onWindowMaterial(callback) {
    let active = true;
    let unlisten: (() => void) | null = null;
    let heard = false;
    const hear = (m: WindowMaterial | null) => {
      if (active && m) {
        heard = true;
        callback(m);
      }
    };
    // the Rust side applies the material during setup, possibly before this page asks: ask, and also listen
    void listen<WindowMaterial>("lilo-window-material", (e) => hear(e.payload)).then((u) => {
      if (active) unlisten = u;
      else u();
    });
    void invoke<WindowMaterial | null>("window_material")
      .then((m) => {
        if (!heard) hear(m);
      })
      .catch(() => hear("solid"));
    return () => {
      active = false;
      unlisten?.();
    };
  },

  async reduceTransparency() {
    try {
      return await invoke<boolean>("reduce_transparency");
    } catch {
      return false;
    }
  },

  async setWindowTheme(theme) {
    try {
      await getCurrentWindow().setTheme(theme);
    } catch {
      // not allowed or not supported here: the page still follows the choice
    }
  },
};
