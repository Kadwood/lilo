import type { Platform } from "./types";

const unavailable = (what: string) => new Error(`${what} is not available in browser`);

/**
 * Browser stub. Machine access needs the desktop app, so those methods throw. File save/open use
 * plain web APIs (download link / file input) so `pnpm dev` in a browser can still export.
 */
export const browserPlatform: Platform = {
  kind: "browser",
  discoverMachines: () => Promise.reject(unavailable("discoverMachines")),
  savedMachines: () => Promise.reject(unavailable("savedMachines")),
  sendToMachine: () => Promise.reject(unavailable("sendToMachine")),

  ocrImage: () => Promise.reject(new Error("unsupported: text recognition needs the desktop app")),
  listRecentProjects: () => Promise.resolve([]),
  onOpenFile: () => () => {},
  readProjectFile: () => Promise.reject(unavailable("readProjectFile")),
  writeProjectFile: () => Promise.reject(unavailable("writeProjectFile")),
  projectsFolder: () => Promise.resolve(null),

  async saveFile(suggestedName, bytes) {
    download(suggestedName, bytes);
    return suggestedName;
  },

  async saveFilesToFolder(files) {
    for (const f of files) download(f.name, f.bytes);
    return files.length ? "Downloads" : null;
  },

  openFile: async (options) => (await pick(options, false))[0] ?? null,
  openFiles: (options) => pick(options, true),

  async readMyThreads() {
    try {
      return window.localStorage.getItem(SHELF_KEY);
    } catch {
      return null;
    }
  },
  async writeMyThreads(json) {
    window.localStorage.setItem(SHELF_KEY, json);
  },

  async openUrl(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  },

  async openProjectDialog() {
    const f = (await pick({ extensions: ["lilo"] }, false))[0];
    return f ? { path: "", name: f.name, bytes: f.bytes } : null;
  },
  saveProjectAs: (suggestedName, bytes) => browserPlatform.saveFile(suggestedName, bytes),
  onCloseRequested: () => () => {},
};

const SHELF_KEY = "lilo.my-threads";

function download(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function pick(options: { extensions?: string[] } | undefined, multiple: boolean): Promise<{ name: string; bytes: Uint8Array }[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    if (options?.extensions?.length) input.accept = options.extensions.map((e) => `.${e}`).join(",");
    input.onchange = async () => {
      try {
        resolve(await Promise.all([...(input.files ?? [])].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
      } catch (e) {
        reject(e);
      }
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}
