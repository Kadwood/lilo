import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { BridgeClient } from "../link/api/client";
import type { SavedMachine } from "../link/api/types";
import type { JobRecord } from "../link/api/types";
import type { OcrLine, OpenedPath, Platform, PlatformMachine, RecentProject, SendResult } from "./types";

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
    // Dongle machines need their serial so the Rust side can find the pairing token.
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

  async readMyThreads() {
    return invoke<string | null>("read_my_threads");
  },

  async writeMyThreads(json) {
    await invoke("write_my_threads", { json });
  },

  async openUrl(url) {
    await openUrl(url);
  },

  async openProjectDialog() {
    const folder = await invoke<string>("projects_folder").catch(() => undefined);
    const picked = await open({ multiple: false, directory: false, defaultPath: folder, filters: [{ name: "Lilo project", extensions: ["lilo"] }] });
    if (!picked) return null;
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
    let unlisten: (() => void) | null = null;
    const win = getCurrentWindow();
    void win
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (await handler()) await win.destroy();
      })
      .then((u) => {
        if (active) unlisten = u;
        else u();
      });
    return () => {
      active = false;
      unlisten?.();
    };
  },

  ocrImage(bytes) {
    // a Uint8Array goes to Rust as the raw request body (no JSON round trip for megabytes)
    return invoke<OcrLine[]>("ocr_image", bytes);
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
          const file: OpenedPath = { path, name: nameOf(path), bytes: await tauriPlatform.readProjectFile(path) };
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
};
