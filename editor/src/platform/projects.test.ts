import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const listeners = new Map<string, () => void>();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a), Channel: class {} }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: () => void) => {
    listeners.set(name, cb);
    return () => listeners.delete(name);
  }),
}));

import { browserPlatform } from "./browser";
import { tauriPlatform } from "./tauri";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("browser platform: M5 methods", () => {
  it("has no OCR, no recents, and a no-op open-file hook", async () => {
    await expect(browserPlatform.ocrImage(new Uint8Array([1]))).rejects.toThrow(/^unsupported/);
    expect(await browserPlatform.listRecentProjects()).toEqual([]);
    expect(await browserPlatform.projectsFolder()).toBeNull();
    const off = browserPlatform.onOpenFile(() => {
      throw new Error("never called");
    });
    expect(typeof off).toBe("function");
    off();
    await expect(browserPlatform.readProjectFile("/x.lilo")).rejects.toThrow("not available in browser");
    await expect(browserPlatform.writeProjectFile("/x.lilo", new Uint8Array())).rejects.toThrow("not available in browser");
  });
});

describe("tauri platform: OCR, recents, open-file", () => {
  beforeEach(() => {
    invoke.mockReset();
    listeners.clear();
  });

  it("sends image bytes raw to ocr_image and returns the lines", async () => {
    const lines = [{ text: "MADEIRA", confidence: 0.99, bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 } }];
    invoke.mockResolvedValueOnce(lines);
    const bytes = new Uint8Array([137, 80, 78, 71]);
    expect(await tauriPlatform.ocrImage(bytes)).toEqual(lines);
    expect(invoke).toHaveBeenCalledWith("ocr_image", bytes);
  });

  it("surfaces 'unsupported' from other operating systems", async () => {
    invoke.mockRejectedValueOnce("unsupported: text recognition is only available on macOS");
    await expect(tauriPlatform.ocrImage(new Uint8Array([1]))).rejects.toMatch(/^unsupported/);
  });

  it("lists recent projects with an optional limit", async () => {
    const rows = [{ path: "/Users/me/Documents/Lilo/Crest.lilo", name: "Crest", modifiedMs: 5, sizeBytes: 100 }];
    invoke.mockResolvedValueOnce(rows);
    expect(await tauriPlatform.listRecentProjects(12)).toEqual(rows);
    expect(invoke).toHaveBeenCalledWith("list_recent_projects", { limit: 12 });
  });

  it("reads project bytes from an ArrayBuffer", async () => {
    invoke.mockResolvedValueOnce(new Uint8Array([9, 8, 7]).buffer);
    expect([...(await tauriPlatform.readProjectFile("/p/a.lilo"))]).toEqual([9, 8, 7]);
    expect(invoke).toHaveBeenCalledWith("read_project_file", { path: "/p/a.lilo" });
  });

  it("writes project bytes as the raw body with the path in a header", async () => {
    invoke.mockResolvedValueOnce(undefined);
    const bytes = new Uint8Array([1, 2, 3]);
    await tauriPlatform.writeProjectFile("/Users/me/My Docs/Crest.lilo", bytes);
    expect(invoke).toHaveBeenCalledWith("write_project_file", bytes, {
      headers: { path: encodeURIComponent("/Users/me/My Docs/Crest.lilo") },
    });
  });

  it("onOpenFile hands over files that arrived before it was called, then later ones", async () => {
    const opened: string[] = [];
    invoke.mockImplementation(async (cmd: string, args?: { path?: string }) => {
      if (cmd === "take_open_files") return pending.splice(0);
      if (cmd === "read_project_file") return new TextEncoder().encode(args!.path!).buffer;
      throw new Error(`unexpected ${cmd}`);
    });
    const pending = ["/Users/me/Documents/Lilo/Early.lilo"];
    const off = tauriPlatform.onOpenFile((f) => opened.push(`${f.name}:${new TextDecoder().decode(f.bytes)}`));
    await flush();
    await flush();
    expect(opened).toEqual(["Early.lilo:/Users/me/Documents/Lilo/Early.lilo"]);
    // a second file opened while running: Rust emits the event, the editor drains
    pending.push("/Volumes/USB/Late.lilo");
    listeners.get("lilo-open-file")!();
    await flush();
    await flush();
    expect(opened).toHaveLength(2);
    expect(opened[1]).toBe("Late.lilo:/Volumes/USB/Late.lilo");
    off();
    expect(listeners.has("lilo-open-file")).toBe(false);
  });

  it("a file that can't be read doesn't break the others", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const pending = ["/a/bad.lilo", "/a/good.lilo"];
    invoke.mockImplementation(async (cmd: string, args?: { path?: string }) => {
      if (cmd === "take_open_files") return pending.splice(0);
      if (args?.path === "/a/bad.lilo") throw new Error("denied");
      return new Uint8Array([1]).buffer;
    });
    const names: string[] = [];
    const off = tauriPlatform.onOpenFile((f) => names.push(f.name));
    await flush();
    await flush();
    expect(names).toEqual(["good.lilo"]);
    expect(err).toHaveBeenCalled();
    off();
    err.mockRestore();
  });
});
