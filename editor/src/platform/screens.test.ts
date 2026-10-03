import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const open = vi.fn();
const save = vi.fn();
const readFile = vi.fn();
const writeFile = vi.fn();
const openUrl = vi.fn();
let closeCb: ((e: { preventDefault(): void }) => Promise<void>) | null = null;

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a), Channel: class {} }));
const events = new Map<string, () => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: () => void) => {
    events.set(name, cb);
    return () => events.delete(name);
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (cb: typeof closeCb) => {
      closeCb = cb;
      return () => (closeCb = null);
    },
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...a: unknown[]) => open(...a), save: (...a: unknown[]) => save(...a) }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: (...a: unknown[]) => readFile(...a), writeFile: (...a: unknown[]) => writeFile(...a) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (...a: unknown[]) => openUrl(...a) }));

import { browserPlatform } from "./browser";
import { createMockPlatform } from "./mock";
import { tauriPlatform } from "./tauri";

beforeEach(() => {
  for (const m of [invoke, open, save, readFile, writeFile, openUrl]) m.mockReset();
  closeCb = null;
  events.clear();
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
    expect(await tauriPlatform.readMyThreads()).toBeNull(); // whatever Rust says comes back as is
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

  it("quitting waits for the handler: nothing happens on false, quit_now on true", async () => {
    const handler = vi.fn(async () => false);
    const off = tauriPlatform.onCloseRequested(handler);
    await vi.waitFor(() => expect(closeCb).not.toBeNull());
    const prevent = vi.fn();
    await closeCb!({ preventDefault: prevent });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(prevent).toHaveBeenCalled(); // the window stays; the shell decides when to exit
    expect(invoke).not.toHaveBeenCalledWith("quit_now");
    handler.mockResolvedValue(true);
    await closeCb!({ preventDefault: prevent });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("quit_now"));
    off();
    await vi.waitFor(() => expect(closeCb).toBeNull());
    expect(events.size).toBe(0);
  });

  it("Cmd-Q, the app menu, the Dock and the tray's Quit arrive as the shell's quit event and run the same guard", async () => {
    let answer = false;
    const handler = vi.fn(async () => answer);
    tauriPlatform.onCloseRequested(handler);
    await vi.waitFor(() => expect(events.has("lilo-quit-requested")).toBe(true));
    events.get("lilo-quit-requested")!();
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(invoke).not.toHaveBeenCalledWith("quit_now");
    answer = true;
    events.get("lilo-quit-requested")!();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("quit_now"));
  });

  it("a second quit request while the question is open does not open a second question", async () => {
    let release!: (v: boolean) => void;
    const handler = vi.fn(() => new Promise<boolean>((r) => (release = r)));
    tauriPlatform.onCloseRequested(handler);
    await vi.waitFor(() => expect(events.has("lilo-quit-requested")).toBe(true));
    events.get("lilo-quit-requested")!();
    events.get("lilo-quit-requested")!();
    await closeCb!({ preventDefault() {} });
    expect(handler).toHaveBeenCalledTimes(1);
    release(false);
  });

  it("reports unsaved changes to the shell, and reads a project's backup (null when there is none)", async () => {
    tauriPlatform.setDirty(true);
    expect(invoke).toHaveBeenCalledWith("set_dirty", { dirty: true });
    invoke.mockResolvedValueOnce(new Uint8Array([1, 2]).buffer);
    expect(Array.from((await tauriPlatform.readProjectBackup("/p/a.lilo"))!)).toEqual([1, 2]);
    expect(invoke).toHaveBeenCalledWith("read_project_backup", { path: "/p/a.lilo" });
    invoke.mockRejectedValueOnce("There is no earlier copy.");
    expect(await tauriPlatform.readProjectBackup("/p/a.lilo")).toBeNull();
  });
});

describe("browser platform: screens", () => {
  it("keeps My Threads in localStorage", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } });
    expect(await browserPlatform.readMyThreads()).toEqual({ text: null, backup: null, corrupt: false });
    await browserPlatform.writeMyThreads("{}");
    expect(await browserPlatform.readMyThreads()).toEqual({ text: "{}", backup: null, corrupt: false });
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
