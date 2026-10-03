import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const open = vi.fn();
const save = vi.fn();
const readFile = vi.fn();
const writeFile = vi.fn();
const openUrl = vi.fn();
const destroy = vi.fn();
let closeCb: ((e: { preventDefault(): void }) => Promise<void>) | null = null;

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a), Channel: class {} }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (cb: typeof closeCb) => {
      closeCb = cb;
      return () => (closeCb = null);
    },
    destroy,
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...a: unknown[]) => open(...a), save: (...a: unknown[]) => save(...a) }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: (...a: unknown[]) => readFile(...a), writeFile: (...a: unknown[]) => writeFile(...a) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (...a: unknown[]) => openUrl(...a) }));

import { browserPlatform } from "./browser";
import { createMockPlatform } from "./mock";
import { tauriPlatform } from "./tauri";

beforeEach(() => {
  for (const m of [invoke, open, save, readFile, writeFile, openUrl, destroy]) m.mockReset();
  closeCb = null;
});

describe("tauri platform: screens", () => {
  it("openFiles reads every picked file", async () => {
    open.mockResolvedValue(["/a/one.pes", "/a/two.dst"]);
    readFile.mockImplementation(async (p: string) => new Uint8Array([p.length]));
    const files = await tauriPlatform.openFiles({ extensions: ["pes", "dst"] });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ multiple: true, directory: false }));
    expect(files.map((f) => f.name)).toEqual(["one.pes", "two.dst"]);
    open.mockResolvedValue(null);
    expect(await tauriPlatform.openFiles()).toEqual([]);
  });

  it("saveFilesToFolder asks for a folder once and writes each file into it", async () => {
    open.mockResolvedValue("/out");
    const dir = await tauriPlatform.saveFilesToFolder([
      { name: "a.pes", bytes: new Uint8Array([1]) },
      { name: "a.dst", bytes: new Uint8Array([2]) },
    ]);
    expect(dir).toBe("/out");
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ directory: true }));
    expect(writeFile.mock.calls.map((c) => c[0])).toEqual(["/out/a.pes", "/out/a.dst"]);
    open.mockResolvedValue(null);
    expect(await tauriPlatform.saveFilesToFolder([{ name: "x", bytes: new Uint8Array() }])).toBeNull();
  });

  it("My Threads goes through the two restricted commands", async () => {
    invoke.mockResolvedValueOnce(null).mockResolvedValueOnce(undefined);
    expect(await tauriPlatform.readMyThreads()).toBeNull();
    await tauriPlatform.writeMyThreads("{\"version\":1}");
    expect(invoke).toHaveBeenNthCalledWith(1, "read_my_threads");
    expect(invoke).toHaveBeenNthCalledWith(2, "write_my_threads", { json: "{\"version\":1}" });
  });

  it("opens links with the opener plugin", async () => {
    await tauriPlatform.openUrl("https://example.com/chart");
    expect(openUrl).toHaveBeenCalledWith("https://example.com/chart");
  });

  it("opens a project from a dialog that starts in the projects folder, and allows writing back to it", async () => {
    invoke.mockImplementation(async (cmd: string) => (cmd === "projects_folder" ? "/Users/me/Documents/Lilo" : cmd === "read_project_file" ? new Uint8Array([9]).buffer : undefined));
    open.mockResolvedValue("/Users/me/Desktop/Crest.lilo");
    const f = await tauriPlatform.openProjectDialog();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "/Users/me/Documents/Lilo", filters: [{ name: "Lilo project", extensions: ["lilo"] }] }));
    expect(invoke).toHaveBeenCalledWith("allow_project_path", { path: "/Users/me/Desktop/Crest.lilo" });
    expect(f).toMatchObject({ path: "/Users/me/Desktop/Crest.lilo", name: "Crest.lilo" });
    expect(Array.from(f!.bytes)).toEqual([9]);
    open.mockResolvedValue(null);
    expect(await tauriPlatform.openProjectDialog()).toBeNull();
  });

  it("Save As starts in the projects folder, adds .lilo, allows the path and writes through the project command", async () => {
    invoke.mockImplementation(async (cmd: string) => (cmd === "projects_folder" ? "/Users/me/Documents/Lilo" : undefined));
    save.mockResolvedValue("/Users/me/Desktop/Crest");
    const path = await tauriPlatform.saveProjectAs("Crest.lilo", new Uint8Array([1, 2]));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "/Users/me/Documents/Lilo/Crest.lilo" }));
    expect(path).toBe("/Users/me/Desktop/Crest.lilo");
    expect(invoke).toHaveBeenCalledWith("allow_project_path", { path: "/Users/me/Desktop/Crest.lilo" });
    expect(invoke).toHaveBeenCalledWith("write_project_file", expect.any(Uint8Array), { headers: { path: encodeURIComponent("/Users/me/Desktop/Crest.lilo") } });
    save.mockResolvedValue(null);
    expect(await tauriPlatform.saveProjectAs("x.lilo", new Uint8Array())).toBeNull();
  });

  it("closing the window waits for the handler: it stays open on false and is destroyed on true", async () => {
    const handler = vi.fn(async () => false);
    const off = tauriPlatform.onCloseRequested(handler);
    await vi.waitFor(() => expect(closeCb).not.toBeNull());
    const prevent = vi.fn();
    await closeCb!({ preventDefault: prevent });
    expect(prevent).toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
    handler.mockResolvedValue(true);
    await closeCb!({ preventDefault: prevent });
    expect(destroy).toHaveBeenCalledTimes(1);
    off();
    await vi.waitFor(() => expect(closeCb).toBeNull());
  });
});

describe("browser platform: screens", () => {
  it("keeps My Threads in localStorage", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } });
    expect(await browserPlatform.readMyThreads()).toBeNull();
    await browserPlatform.writeMyThreads("{}");
    expect(await browserPlatform.readMyThreads()).toBe("{}");
    vi.unstubAllGlobals();
  });

  it("has no project path to remember, no window close hook", async () => {
    const off = browserPlatform.onCloseRequested(async () => true);
    expect(typeof off).toBe("function");
    off();
  });
});

describe("mock platform", () => {
  it("round-trips a project through write, list and read, newest first", async () => {
    const { platform, state } = createMockPlatform();
    await platform.writeProjectFile("/p/a.lilo", new Uint8Array([1]));
    await platform.writeProjectFile("/p/b.lilo", new Uint8Array([2]));
    expect((await platform.listRecentProjects()).map((r) => r.name)).toEqual(["b", "a"]);
    expect(Array.from(await platform.readProjectFile("/p/a.lilo"))).toEqual([1]);
    expect(state.files.size).toBe(2);
    await expect(platform.readProjectFile("/nope.lilo")).rejects.toThrow(/No such file/);
  });
});
