// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createProject, emptyDesign, saveProject } from "@lilo/engine/light";
import { createMockPlatform, type MockState } from "../platform/mock";
import { setPlatform } from "../platform";
import { resetShelfStore } from "../state/shelfStore";
import { buildCommands, searchCommands } from "../tools/commands";
import { projectCommands } from "../project/commands";
import { lastEditor, renderEditor } from "../test/helpers";
import App from "../App";
import { pixelCommands } from "./pixelCommands";
import { createInlineEngine } from "../engine/client";
import { useProject } from "../project/ProjectProvider";
import type { ProjectManager } from "../project/manager";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

const T = { timeout: 20_000 };
let mock: MockState;
beforeEach(() => {
  resetShelfStore();
  const m = createMockPlatform({ kind: "tauri" });
  mock = m.state;
  setPlatform(m.platform);
  window.location.hash = "";
});
afterEach(() => {
  cleanup();
  setPlatform(null);
  resetShelfStore();
  window.location.hash = "";
});

const meta = (key: string, extra: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key, metaKey: true, ...extra });

describe("project shortcuts work on every screen", () => {
  it("⌘N starts a new design in the editor, from Home", async () => {
    render(<App />);
    meta("n");
    await waitFor(() => expect(window.location.hash).toBe("#/editor"), T);
    expect(screen.getByLabelText("Canvas")).toBeTruthy();
  });

  it("⌘S saves (asking where the first time); ⇧⌘S is Save As", async () => {
    render(<App />);
    meta("s");
    await waitFor(() => expect(mock.files.size).toBe(1), T);
    expect([...mock.files.keys()][0]).toBe("/mock/Documents/Lilo/Untitled design.lilo");
    meta("s", { shiftKey: true });
    await waitFor(() => expect(mock.files.size).toBe(1)); // same name: it overwrote the one file
  });

  it("⌘O opens a project and goes to the editor", async () => {
    const p = createProject({ title: "Crest", design: emptyDesign() });
    mock.pickProject = { path: "/mock/Documents/Lilo/Crest.lilo", name: "Crest.lilo", bytes: saveProject(p) };
    render(<App />);
    meta("o");
    await waitFor(() => expect(window.location.hash).toBe("#/editor"), T);
    expect(await screen.findByDisplayValue("Crest")).toBeTruthy();
  });

  it("⌘K opens the palette on the converter and pixel screens, and closes with Esc", () => {
    for (const hash of ["#/converter", "#/pixel", "#/"]) {
      window.location.hash = hash;
      const { unmount } = render(<App />);
      meta("k");
      expect(screen.getByRole("dialog", { name: "Command palette" })).toBeTruthy();
      fireEvent.keyDown(within(screen.getByRole("dialog", { name: "Command palette" })).getByRole("combobox"), { key: "Escape" });
      expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
      unmount();
    }
  });

  it("⌘K in the editor opens it once (the editor and the app do not both toggle)", () => {
    window.location.hash = "#/editor";
    render(<App />);
    meta("k");
    expect(screen.getAllByRole("dialog", { name: "Command palette" })).toHaveLength(1);
  });
});

describe("every new action is in the command palette", () => {
  let project: ProjectManager;
  const Grab = () => ((project = useProject()), null);

  it("click to stitch, threads, version history, projects, screens and pixel art", async () => {
    renderEditor(<Grab />);
    await waitFor(() => expect(lastEditor).not.toBeNull());
    const { state, actions } = lastEditor!;
    const cmds = [
      ...buildCommands({ state, actions, openImage: () => {}, fit: () => {}, app: { view: "editor", go: () => {} } }),
      ...projectCommands(project, { view: "editor", go: () => {} }, state, actions),
      ...pixelCommands(createInlineEngine(), undefined, state, actions),
    ];
    const ids = new Set(cmds.map((c) => c.id));
    for (const id of [
      "tool.clickstitch", "stitch.click", "stitch.clickPending", "stitch.clear",
      "threads.open", "threads.photo", "threads.use",
      "file.history", "file.new", "file.openProject", "file.save", "file.saveAs", "file.revert", "file.images", "file.open", "file.export", "file.send",
      "go.home", "go.editor", "go.pixel", "go.converter", "go.link",
      "pixel.new", "pixel.send", "pixel.export",
    ]) expect(ids.has(id), id).toBe(true);
    expect(new Set([...ids]).size).toBe(cmds.length); // ids are unique
    // they can be found by what a person would type
    expect(searchCommands(cmds, "my threads")[0].id).toBe("threads.open");
    expect(searchCommands(cmds, "save as")[0].id).toBe("file.saveAs");
    expect(searchCommands(cmds, "version history")[0].id).toBe("file.history");
    expect(searchCommands(cmds, "click to stitch").some((c) => c.id === "tool.clickstitch")).toBe(true);
    expect(searchCommands(cmds, "pixel art send")[0].id).toBe("pixel.send");
  });

  it("running them does what they say", async () => {
    renderEditor(<Grab />);
    await waitFor(() => expect(lastEditor).not.toBeNull());
    const go = vi.fn();
    const { state, actions } = lastEditor!;
    const cmds = buildCommands({ state, actions, openImage: () => {}, fit: () => {}, app: { view: "home", go } });
    const run = (id: string) => act(() => cmds.find((c) => c.id === id)!.run());
    run("threads.open");
    expect(go).toHaveBeenCalledWith("editor");
    expect(lastEditor!.state.seqTab).toBe("threads");
    run("threads.use");
    expect(lastEditor!.state.options.useMyThreads).toBe(true);
    run("file.history");
    expect(lastEditor!.state.dialog).toBe("history");
    run("go.pixel");
    expect(go).toHaveBeenLastCalledWith("pixel");
    expect(cmds.find((c) => c.id === "go.home")!.enabled).toBe(false); // already there
    expect(cmds.find((c) => c.id === "stitch.click")!.enabled).toBe(false); // no trace yet
  });
});
