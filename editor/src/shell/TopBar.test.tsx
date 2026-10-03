// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setPlatform, type Platform } from "../platform";
import { EditorShell } from "./EditorShell";

function fakePlatform(overrides: Partial<Platform> = {}): Platform {
  return {
    kind: "tauri",
    discoverMachines: vi.fn(async () => []),
    savedMachines: vi.fn(async () => [
      { ip: "192.168.1.9", name: "NV2700", manufacturer: "brother", serial: null, model: null, saved: true },
    ]),
    sendToMachine: vi.fn(async () => ({ jobId: "j1", state: "done" as const, storedAs: "demo.pes", error: null })),
    saveFile: vi.fn(async (name: string) => name),
    openFile: vi.fn(async () => null),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  setPlatform(null);
});

describe("editor shell", () => {
  it("renders the frame regions", () => {
    setPlatform(fakePlatform());
    render(<EditorShell />);
    for (const name of ["Settings", "Canvas", "Tools", "Sequencer"]) {
      expect(screen.getByLabelText(name)).toBeTruthy();
    }
    expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe("Untitled design");
  });

  it("Export saves the demo PES through the platform", async () => {
    const platform = fakePlatform();
    setPlatform(platform);
    render(<EditorShell />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    // The engine (stitchjs) loads lazily on first use, which can be slow on a cold cache.
    await waitFor(() => expect(platform.saveFile).toHaveBeenCalledTimes(1), { timeout: 20_000 });
    const [name, bytes] = (platform.saveFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Uint8Array];
    expect(name).toBe("demo.pes");
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("#PES");
  });

  it("Send lists saved machines and sends the demo PES to the chosen one", async () => {
    const platform = fakePlatform();
    setPlatform(platform);
    render(<EditorShell />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText(/NV2700 \(192\.168\.1\.9\)/);
    fireEvent.click(screen.getAllByRole("button", { name: "Send" }).at(-1)!);
    await screen.findByText(/Sent as demo\.pes/, undefined, { timeout: 20_000 });
    const [ip, filename, bytes] = (platform.sendToMachine as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
      Uint8Array,
    ];
    expect([ip, filename]).toEqual(["192.168.1.9", "demo.pes"]);
    expect(bytes.length).toBeGreaterThan(100);
  });

  it("shows the browser stub error instead of crashing", async () => {
    setPlatform(
      fakePlatform({ savedMachines: vi.fn(async () => Promise.reject(new Error("savedMachines is not available in browser"))) }),
    );
    render(<EditorShell />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText(/not available in browser/);
  });
});
