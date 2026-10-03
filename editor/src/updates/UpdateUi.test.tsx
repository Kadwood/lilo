// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setPlatform } from "../platform";
import { createMockPlatform, type MockState } from "../platform/mock";
import { UpdateBanner } from "./UpdateBanner";
import { UpdatesProvider } from "./UpdatesProvider";
import { UpdatesSection } from "./UpdatesSection";
import { createUpdates, type AvailableUpdate, type UpdaterBackend } from "./updates";

let mock: MockState;
beforeEach(() => {
  const m = createMockPlatform();
  mock = m.state;
  setPlatform(m.platform);
});
afterEach(() => {
  cleanup();
  setPlatform(null);
});

const update: AvailableUpdate = { version: "1.0.1", currentVersion: "1.0.0", notes: null, downloadAndInstall: vi.fn(async () => {}) };

function controller(over: Partial<UpdaterBackend> = {}) {
  const backend: UpdaterBackend = { unavailableReason: async () => null, check: async () => update, relaunch: vi.fn(async () => {}), ...over };
  const store = new Map<string, string>();
  return { backend, updates: createUpdates({ backend, storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) } }) };
}

describe("update banner", () => {
  it("shows nothing until an update is found, then names the version", async () => {
    const { updates } = controller();
    render(
      <UpdatesProvider updates={updates} launchCheck={false}>
        <UpdateBanner />
      </UpdatesProvider>,
    );
    expect(screen.queryByRole("status")).toBeNull();
    await act(() => updates.checkNow());
    expect(screen.getByRole("status").textContent).toMatch(/Lilo 1\.0\.1 is available/);
    expect(screen.getByRole("button", { name: "Install and restart" })).toBeTruthy();
  });

  it("What's new opens the release page; the x hides the banner", async () => {
    const { updates } = controller();
    render(
      <UpdatesProvider updates={updates} launchCheck={false}>
        <UpdateBanner />
      </UpdatesProvider>,
    );
    await act(() => updates.checkNow());
    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    expect(mock.openedUrls).toEqual(["https://github.com/Kadwood/lilo/releases/tag/v1.0.1"]);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("Install and restart installs and relaunches", async () => {
    const { updates, backend } = controller();
    render(
      <UpdatesProvider updates={updates} launchCheck={false}>
        <UpdateBanner />
      </UpdatesProvider>,
    );
    await act(() => updates.checkNow());
    fireEvent.click(screen.getByRole("button", { name: "Install and restart" }));
    await waitFor(() => expect(backend.relaunch).toHaveBeenCalledTimes(1));
    expect(update.downloadAndInstall).toHaveBeenCalled();
  });

  it("checks on launch after the delay, silently", async () => {
    vi.useFakeTimers();
    try {
      const { updates, backend } = controller({ check: vi.fn(async () => Promise.reject(new Error("offline"))) });
      render(
        <UpdatesProvider updates={updates} launchCheck delayMs={5000}>
          <UpdateBanner />
        </UpdatesProvider>,
      );
      expect(backend.check).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
        for (let i = 0; i < 5; i++) await Promise.resolve(); // let the check's awaits settle
      });
      expect(backend.check).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("status")).toBeNull(); // offline: no banner, no error
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Settings > Updates", () => {
  const section = (c: ReturnType<typeof controller>) =>
    render(
      <UpdatesProvider updates={c.updates} launchCheck={false}>
        <UpdatesSection version="1.0.0" />
      </UpdatesProvider>,
    );

  it("has the automatic-check switch (on by default) and a manual check", async () => {
    const c = controller({ check: async () => null });
    section(c);
    const box = screen.getByRole("checkbox", { name: "Automatically check for updates" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(c.updates.store.getState().autoCheck).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Check for updates now" }));
    await screen.findByText("Lilo is up to date.");
  });

  it("shows failures for the manual check", async () => {
    section(controller({ check: async () => Promise.reject(new Error("404 Not Found")) }));
    fireEvent.click(screen.getByRole("button", { name: "Check for updates now" }));
    await screen.findByText(/Couldn't check for updates: 404 Not Found/);
  });

  it("explains when this build can't update", async () => {
    section(controller({ unavailableReason: async () => "Updates are only available in the Lilo desktop app." }));
    fireEvent.click(screen.getByRole("button", { name: "Check for updates now" }));
    await screen.findByText("Updates are only available in the Lilo desktop app.");
  });

  it("renders nothing without a provider", () => {
    const { container } = render(<UpdatesSection />);
    expect(container.textContent).toBe("");
  });
});
