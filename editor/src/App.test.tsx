// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Outside the Tauri webview the Rust side is unreachable; the Link view must say so, not crash.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => {
    throw new Error("no tauri here");
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import App from "./App";

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("App navigation", () => {
  it("launches on Home, and switches between Home, the editor, pixel art, the converter and Lilo Link", async () => {
    render(<App />);
    expect(screen.getByLabelText("Home")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBe("page");

    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    expect(screen.getByLabelText("Canvas")).toBeTruthy();
    expect(window.location.hash).toBe("#/editor");

    fireEvent.click(screen.getByRole("button", { name: "Pixel art" }));
    expect(screen.getByLabelText("Pixel grid, 32 by 32. Arrow keys move, Space paints with the current tool.", { exact: false })).toBeTruthy();
    expect(window.location.hash).toBe("#/pixel");

    fireEvent.click(screen.getByRole("button", { name: "Converter" }));
    expect(screen.getByRole("heading", { name: "Converter" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Lilo Link" }));
    // LinkApp is lazy-loaded; allow for a cold module cache.
    expect(await screen.findByText(/Could not reach the app backend/, undefined, { timeout: 20_000 })).toBeTruthy();
    expect(window.location.hash).toBe("#/link");
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    expect(screen.getByLabelText("Canvas")).toBeTruthy();
  });

  it("opens the view named in the URL", () => {
    window.location.hash = "#/converter";
    render(<App />);
    expect(screen.getByRole("heading", { name: "Converter" })).toBeTruthy();
  });

  it("⌘K opens the palette on every screen, with the screens in it", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "go to pixel" } });
    expect(screen.getByRole("option", { name: /Go to Pixel art/ })).toBeTruthy();
  });
});
