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

  async saveFile(suggestedName, bytes) {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return suggestedName;
  },

  openFile(options) {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      if (options?.extensions?.length) input.accept = options.extensions.map((e) => `.${e}`).join(",");
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        try {
          resolve({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
        } catch (e) {
          reject(e);
        }
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  },
};
