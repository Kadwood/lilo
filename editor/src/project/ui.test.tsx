// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { addHistorySnapshot, createProject, emptyDesign, makeFill, planThumbnailPng, rectNodes, saveProject, type Design } from "@lilo/engine/light";
import { designToEmbroidery } from "@lilo/engine";
import { sampleDesign } from "../../../engine/src/stitch/sample-design";
import type { AppApi } from "../app/AppContext";
import { HomeView } from "../app/HomeView";
import { createMockPlatform, type MockState } from "../platform/mock";
import { setPlatform } from "../platform";
import { defaultThread } from "../state/editorStore";
import { resetShelfStore } from "../state/shelfStore";
import { lastEditor, renderEditor } from "../test/helpers";
import { ConfirmDialog } from "./ConfirmDialog";
import { FileMenu } from "./FileMenu";
import { HistoryPanel, whenLabel } from "./HistoryPanel";
import { AUTOSAVE_MS, useProject } from "./ProjectProvider";
import type { ProjectManager } from "./manager";
import { TopBar } from "../shell/TopBar";

const T = { timeout: 20_000 };
const thread = defaultThread();
const box = (id: string, x = 0) => makeFill(id, id, thread.id, rectNodes(x, 0, x + 10, 10));
const design = (...ids: string[]): Design => ({ ...emptyDesign(), threads: [thread], objects: ids.map((id, i) => box(id, i * 12)) });

let mock: MockState;
let manager: ProjectManager;
let go: ReturnType<typeof vi.fn>;

function Grab() {
  manager = useProject();
  return null;
}
function app(): AppApi {
  go = vi.fn();
  return { view: "home", go: go as unknown as AppApi["go"] };
}

function projectBytes(title: string, d: Design, history: Design[] = []): Uint8Array {
  const t = new Date("2026-10-03T10:00:00Z");
  let p = createProject({ title, design: d, now: t });
  p = { ...p, thumbnail: planThumbnailPng({ threads: [], stitches: [], warnings: [] }, { size: 32 }) };
  history.forEach((h, i) => (p = addHistorySnapshot({ ...p, doc: { ...p.doc, design: h } }, new Date(t.getTime() - (history.length - i) * 60_000))));
  p = { ...p, doc: { ...p.doc, design: d } };
  return saveProject(p, t);
}

beforeEach(() => {
  resetShelfStore();
  const m = createMockPlatform({ kind: "tauri" });
  mock = m.state;
  setPlatform(m.platform);
  URL.createObjectURL = () => "blob:thumb";
  URL.revokeObjectURL = () => {};
});
afterEach(() => {
  cleanup();
  setPlatform(null);
  resetShelfStore();
  vi.useRealTimers();
});

const mount = (ui: React.ReactElement, opts: { design?: Design } = {}): RenderResult => renderEditor(<><Grab />{ui}</>, { ...opts, app: app() });
const ready = () => waitFor(() => expect(lastEditor?.state.planResult).not.toBeNull(), T);

describe("Home", () => {
  const seed = () => {
    for (const [name, ms] of [["Crest", 3000], ["Monogram", 2000]] as const) {
      const path = `/mock/Documents/Lilo/${name}.lilo`;
      mock.files.set(path, projectBytes(name, design("a", "b")));
      mock.recents.push({ path, name, modifiedMs: Date.now() - ms, sizeBytes: 10 });
    }
  };

  it("shows a gallery of recent projects with their thumbnails and titles", async () => {
    seed();
    mount(<HomeView />);
    const grid = await screen.findByRole("list", { name: "Recent projects" }, T);
    await waitFor(() => expect(grid.querySelectorAll("img").length).toBe(2), T);
    expect(within(grid).getByRole("button", { name: "Open Crest" })).toBeTruthy();
    expect(within(grid).getByRole("button", { name: "Open Monogram" })).toBeTruthy();
  });

  it("opening a card loads the project and goes to the editor", async () => {
    seed();
    mount(<HomeView />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Crest" }, T));
    await waitFor(() => expect(go).toHaveBeenCalledWith("editor"), T);
    expect(lastEditor!.state.design!.objects.map((o) => o.id)).toEqual(["a", "b"]);
    expect(lastEditor!.state.projectName).toBe("Crest");
  });

  it("New and Open… are buttons; New starts a blank design in the editor", async () => {
    mount(<HomeView />);
    fireEvent.click(screen.getByRole("button", { name: "New design" }));
    await waitFor(() => expect(go).toHaveBeenCalledWith("editor"), T);
    mock.pickProject = { path: "/mock/Documents/Lilo/Crest.lilo", name: "Crest.lilo", bytes: projectBytes("Crest", design("q")) };
    fireEvent.click(screen.getByRole("button", { name: "Open…" }));
    await waitFor(() => expect(lastEditor!.state.projectName).toBe("Crest"), T);
  });

  it("Open… takes a PES: a new project named after the file opens in the editor", async () => {
    mount(<HomeView />);
    mock.pickProject = { path: "", name: "rooster.pes", bytes: designToEmbroidery(sampleDesign(), "pes", { label: "rooster" }).bytes };
    fireEvent.click(screen.getByRole("button", { name: "Open…" }));
    await waitFor(() => expect(go).toHaveBeenCalledWith("editor"), T);
    expect(lastEditor!.state.projectName).toBe("rooster");
    expect(lastEditor!.state.design!.layers?.map((l) => l.name)).toEqual(["rooster"]);
    expect(manager.store.getState().path).toBeNull();
  });

  it("a stitch file dropped on Home opens the same way; a damaged one shows the plain-words error and stays on Home", async () => {
    mount(<HomeView />);
    const home = screen.getByLabelText("Home");
    const pes = new File([designToEmbroidery(sampleDesign(), "pes", { label: "rooster" }).bytes as BlobPart], "rooster.pes");
    await act(async () => {
      fireEvent.drop(home, { dataTransfer: { files: [pes] } });
    });
    await waitFor(() => expect(go).toHaveBeenCalledWith("editor"), T);
    expect(lastEditor!.state.projectName).toBe("rooster");
    go.mockClear();
    manager.store.setState({ dirty: false });
    await act(async () => {
      fireEvent.drop(home, { dataTransfer: { files: [new File([new Uint8Array([1, 2, 3])], "broken.dst")] } });
    });
    expect((await screen.findByRole("alert", undefined, T)).textContent).toMatch(/couldn't read this file/);
    expect(go).not.toHaveBeenCalled();
  });

  it("says what is going on when there is nothing yet", async () => {
    mount(<HomeView />);
    expect(await screen.findByText(/Nothing here yet/, undefined, T)).toBeTruthy();
    cleanup();
    setPlatform(createMockPlatform({ kind: "browser" }).platform);
    mount(<HomeView />);
    expect(await screen.findByText(/desktop app/, undefined, T)).toBeTruthy();
  });

  it("a file that cannot be read is a disabled card, and shows the error from a bad Open", async () => {
    mock.files.set("/mock/Documents/Lilo/bad.lilo", new Uint8Array([1, 2, 3]));
    mock.recents.push({ path: "/mock/Documents/Lilo/bad.lilo", name: "bad", modifiedMs: Date.now(), sizeBytes: 3 });
    mount(<HomeView />);
    const card = await screen.findByRole("button", { name: "Open bad" }, T);
    await waitFor(() => expect((card as HTMLButtonElement).disabled).toBe(true), T);
    expect(screen.getByText("Can't be read")).toBeTruthy();
  });
});

describe("File menu", () => {
  it("opens from the keyboard, moves with arrows, runs with Enter and Esc gives focus back", async () => {
    mount(<FileMenu />, { design: design("a") });
    await ready();
    const button = screen.getByRole("button", { name: "File" });
    button.focus();
    fireEvent.keyDown(button, { key: "ArrowDown" });
    const menu = screen.getByRole("menu", { name: "File" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent?.replace(/⌘|⇧/g, "").trim())).toEqual(["New N", "Open… O", "Open image to auto-digitize…", "Save S", "Save As… S", "Revert to saved", "Version history…", "Export…", "Send to machine…"].map((s) => expect.stringContaining(s.split(" ")[0])));
    // New is first and active
    expect(menu.getAttribute("aria-activedescendant")).toBe(items[0].id);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(menu.getAttribute("aria-activedescendant")).toBe(items[1].id);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("Save and Save As… work from the menu; Revert is off until there is something to revert", async () => {
    mount(<FileMenu />, { design: design("a") });
    await ready();
    const open = () => fireEvent.click(screen.getByRole("button", { name: "File" }));
    open();
    expect(screen.getByRole("menuitem", { name: /Revert to saved/ }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("menuitem", { name: /Export/ }).getAttribute("aria-disabled")).toBe("false"); // it has stitches
    fireEvent.click(screen.getByRole("menuitem", { name: /^Save\b(?! As)/ }));
    await waitFor(() => expect(manager.store.getState().path).toBe("/mock/Documents/Lilo/Untitled design.lilo"), T);
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: /Save As/ }));
    await waitFor(() => expect(mock.files.size).toBe(1));
  });

  it("Version history… opens the history dialog from the top bar", async () => {
    mount(<TopBar />, { design: design("a") });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "File" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Version history/ }));
    expect(await screen.findByRole("dialog", { name: "Version history" })).toBeTruthy();
  });
});

describe("title and unsaved dot", () => {
  it("the top bar shows an unsaved dot after an edit and not after saving; the window title follows", async () => {
    mount(<TopBar />, { design: design("a") });
    await ready();
    act(() => manager.markClean());
    expect(screen.queryByRole("img", { name: "Unsaved changes" })).toBeNull();
    act(() => lastEditor!.actions.setName("Crest"));
    expect(screen.getByRole("img", { name: "Unsaved changes" })).toBeTruthy();
    expect(document.title).toBe("Crest • — Lilo");
    await act(async () => void (await manager.save()));
    expect(screen.queryByRole("img", { name: "Unsaved changes" })).toBeNull();
    expect(document.title).toBe("Crest — Lilo");
  });
});

describe("the in-page unsaved-changes question", () => {
  it("is a dialog with Save, Don't save and Cancel (not window.confirm), Esc cancels, focus goes to Save", async () => {
    const confirm = vi.spyOn(window, "confirm");
    mount(<ConfirmDialog />, { design: design("a") });
    await ready();
    act(() => lastEditor!.actions.setName("Crest v2"));
    let result: Promise<boolean> | undefined;
    act(() => void (result = manager.newProject()));
    const dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getByText(/Save changes to “Crest v2”\?/)).toBeTruthy();
    expect(within(dlg).getAllByRole("button").map((b) => b.textContent)).toEqual(["Don't save", "Cancel", "Save"]);
    expect(document.activeElement).toBe(within(dlg).getByRole("button", { name: "Save" }));
    fireEvent.keyDown(dlg, { key: "Escape" });
    expect(await result).toBe(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(lastEditor!.state.projectName).toBe("Crest v2");

    act(() => void (result = manager.newProject()));
    fireEvent.click(await screen.findByRole("button", { name: "Don't save" }));
    expect(await result).toBe(true);
    expect(lastEditor!.state.projectName).toBe("Untitled design");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("Revert asks a different question", async () => {
    mount(<ConfirmDialog />, { design: design("a") });
    await ready();
    await act(async () => void (await manager.save()));
    act(() => lastEditor!.actions.setName("Changed"));
    let result: Promise<boolean> | undefined;
    act(() => void (result = manager.revert()));
    expect(await screen.findByRole("heading", { name: "Revert to the saved version?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(await result).toBe(true);
    expect(lastEditor!.state.projectName).toBe("Untitled design");
  });
});

describe("Version history panel", () => {
  async function openWithHistory() {
    const onClose = vi.fn();
    const path = "/mock/Documents/Lilo/Crest.lilo";
    mock.files.set(path, projectBytes("Crest", design("a", "b", "c"), [design("a"), design("a", "b")]));
    mount(<HistoryPanel onClose={onClose} />);
    await act(async () => void (await manager.openPath(path)));
    return onClose;
  }

  it("lists versions newest first with a time and a thumbnail, and previews the one picked", async () => {
    await openWithHistory();
    const list = await screen.findByRole("listbox", { name: "Saved versions" }, T);
    const options = within(list).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("latest");
    await waitFor(() => expect(list.querySelectorAll("img")).toHaveLength(2), T);
    fireEvent.click(within(options[1]).getByRole("button"));
    expect(within(screen.getByLabelText("Preview")).getByText("Shapes").nextElementSibling!.textContent).toBe("1");
    fireEvent.click(within(options[0]).getByRole("button"));
    expect(within(screen.getByLabelText("Preview")).getByText("Shapes").nextElementSibling!.textContent).toBe("2");
  });

  it("Restore brings a version back as an undoable edit and closes the panel", async () => {
    const onClose = await openWithHistory();
    expect(lastEditor!.state.design!.objects).toHaveLength(3);
    const list = await screen.findByRole("listbox", { name: "Saved versions" }, T);
    fireEvent.click(within(within(list).getAllByRole("option")[1]).getByRole("button"));
    fireEvent.click(screen.getByRole("button", { name: "Restore this version" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled(), T);
    expect(lastEditor!.state.design!.objects.map((o) => o.id)).toEqual(["a"]);
    act(() => lastEditor!.actions.undo());
    expect(lastEditor!.state.design!.objects.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("explains an empty history", async () => {
    mount(<HistoryPanel onClose={() => {}} />);
    expect(screen.getByText(/No versions yet/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Restore this version" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("times read like people say them", () => {
    const now = new Date("2026-10-03T12:00:00");
    expect(whenLabel("2026-10-03T11:59:50", now)).toBe("just now");
    expect(whenLabel("2026-10-03T11:50:00", now)).toBe("10 min ago");
    expect(whenLabel("2026-10-03T08:30:00", now)).toMatch(/^today /);
    expect(whenLabel("2026-10-02T08:30:00", now)).toMatch(/^yesterday /);
    expect(whenLabel("2025-01-02T08:30:00", now)).toMatch(/2025/);
    expect(whenLabel("nope", now)).toBe("unknown time");
  });
});

describe("autosave, open-file and close wiring", () => {
  it("tells the shell when there are unsaved changes, so Cmd-Q and the tray can be held back", async () => {
    mount(<TopBar />, { design: design("a") });
    await ready();
    act(() => manager.markClean());
    act(() => lastEditor!.actions.setName("Edited"));
    await act(async () => void (await manager.save()));
    expect(mock.dirtyReports.slice(-3)).toEqual([false, true, false]);
  });

  it("autosaves every 30 s and when the window loses focus", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    mount(<div />, { design: design("a") });
    await vi.waitFor(() => expect(lastEditor?.state.planResult).not.toBeNull(), { timeout: 20_000, interval: 50 });
    act(() => lastEditor!.actions.addObjects([box("b", 20)], "Add"));
    expect(manager.store.getState().history).toHaveLength(0);
    await act(async () => void (await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 10)));
    expect(manager.store.getState().history).toHaveLength(1);
    act(() => lastEditor!.actions.addObjects([box("c", 40)], "Add"));
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(manager.store.getState().history).toHaveLength(2);
  });

  it("a project the OS opens (double-click) is opened, and the editor is shown", async () => {
    mount(<div />);
    await waitFor(() => expect(mock.openFileCb).not.toBeNull());
    await act(async () => mock.openFileCb!({ path: "/mock/Documents/Lilo/Crest.lilo", name: "Crest.lilo", bytes: projectBytes("Crest", design("a", "b")) }));
    await waitFor(() => expect(lastEditor!.state.projectName).toBe("Crest"), T);
    await waitFor(() => expect(go).toHaveBeenCalledWith("editor"), T);
  });

  it("closing the window waits for the unsaved-changes answer", async () => {
    mount(<ConfirmDialog />, { design: design("a") });
    await ready();
    await waitFor(() => expect(mock.closeHandler).not.toBeNull());
    manager.markClean();
    expect(await mock.closeHandler!()).toBe(true); // clean
    act(() => lastEditor!.actions.setName("Dirty"));
    let r!: Promise<boolean>;
    act(() => void (r = mock.closeHandler!()));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await r).toBe(false);
  });
});
