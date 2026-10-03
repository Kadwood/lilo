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
  it("switches between the editor and the Lilo Link view", async () => {
    render(<App />);
    expect(screen.getByLabelText("Canvas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Lilo Link" }));
    // LinkApp is lazy-loaded; allow for a cold module cache.
    expect(await screen.findByText(/Could not reach the app backend/, undefined, { timeout: 20_000 })).toBeTruthy();
    expect(window.location.hash).toBe("#/link");
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    expect(screen.getByLabelText("Canvas")).toBeTruthy();
  });
});
