// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { AppApi } from "../app/AppContext";
import { Toolbar } from "../canvas/Toolbar";
import { FileMenu } from "../project/FileMenu";
import { createMockPlatform } from "../platform/mock";
import { setPlatform } from "../platform";
import { renderEditor } from "../test/helpers";
import { AppearanceMenu } from "./AppearanceMenu";

/**
 * Menus and pop-ups must live on document.body: inside the top bar or the tool dock they sit in a
 * stacking context and get painted over (or clipped) by their neighbours.
 */
const app: AppApi = { view: "editor", go: () => undefined };
const STACKING = ".topbar, .toolbar, .app-nav, .canvas";

beforeEach(() => setPlatform(createMockPlatform({ kind: "tauri" }).platform));
afterEach(() => {
  cleanup();
  setPlatform(null);
});

function expectPortalled(el: HTMLElement) {
  expect(el.closest(".anchored-pop")?.parentElement).toBe(document.body);
  expect(el.closest(STACKING)).toBeNull();
}

describe("Appearance popover", () => {
  const open = () => {
    renderEditor(
      <header className="topbar">
        <nav className="app-nav">
          <AppearanceMenu />
        </nav>
      </header>,
      { app },
    );
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    return screen.getByRole("dialog", { name: "Appearance" });
  };

  it("is portalled to the body, outside the top bar", () => expectPortalled(open()));
  it("closes on an outside click, stays open for a click inside", () => {
    const pop = open();
    fireEvent.mouseDown(screen.getByText("Theme"));
    expect(screen.queryByRole("dialog", { name: "Appearance" })).toBe(pop);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Appearance" })).toBeNull();
  });
  it("closes on Escape", () => {
    open();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Appearance" })).toBeNull();
  });
});

describe("Toolbar colour popover", () => {
  const open = () => {
    renderEditor(<Toolbar />, { app });
    fireEvent.click(screen.getByRole("button", { name: "Drawing colour" }));
    return document.querySelector<HTMLElement>(".anchored-pop .popover")!;
  };

  it("is portalled to the body, outside the tool dock", () => {
    const pop = open();
    expect(pop).toBeTruthy();
    expectPortalled(pop);
  });
  it("closes on an outside click, stays open for a click inside", () => {
    const pop = open();
    fireEvent.mouseDown(pop);
    expect(document.querySelector(".anchored-pop")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(document.querySelector(".anchored-pop")).toBeNull();
  });
  it("closes on Escape", () => {
    open();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(document.querySelector(".anchored-pop")).toBeNull();
  });
});

describe("File menu", () => {
  const open = () => {
    renderEditor(
      <header className="topbar">
        <FileMenu />
      </header>,
      { app },
    );
    fireEvent.click(screen.getByRole("button", { name: "File" }));
    return screen.getByRole("menu", { name: "File" });
  };

  it("is portalled to the body, outside the top bar", () => expectPortalled(open()));
  it("closes on an outside click, stays open for a click on the menu itself", () => {
    const menu = open();
    fireEvent.mouseDown(menu);
    expect(screen.queryByRole("menu", { name: "File" })).toBe(menu);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu", { name: "File" })).toBeNull();
  });
  it("closes on Escape and gives focus back to the button", () => {
    const menu = open();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "File" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "File" }));
  });
});
