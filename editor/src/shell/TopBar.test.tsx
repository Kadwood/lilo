// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { readPes } from "@lilo/engine";
import { setPlatform, type Platform } from "../platform";
import { browserPlatform } from "../platform/browser";
import { renderEditor, testDesign } from "../test/helpers";
import { EditorShell } from "./EditorShell";

function fakePlatform(overrides: Partial<Platform> = {}): Platform {
  return {
    ...browserPlatform,
    kind: "tauri",
    discoverMachines: vi.fn(async () => []),
    savedMachines: vi.fn(async () => [
      { ip: "192.168.1.9", name: "NV2700", manufacturer: "brother", serial: null, model: null, saved: true },
    ]),
    sendToMachine: vi.fn(async (_ip: string, name: string) => ({ jobId: "j1", state: "done" as const, storedAs: name, error: null })),
    saveFile: vi.fn(async (name: string) => name),
    openFile: vi.fn(async () => null),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  setPlatform(null);
});

const T = { timeout: 20_000 };

describe("editor shell", () => {
  it("renders the frame regions", () => {
    setPlatform(fakePlatform());
    renderEditor(<EditorShell />);
    for (const name of ["Settings", "Canvas", "Tools", "Sequencer"]) {
      expect(screen.getByLabelText(name)).toBeTruthy();
    }
    expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe("Untitled design");
  });

  it("disables Export and Send until there is a design", () => {
    setPlatform(fakePlatform());
    renderEditor(<EditorShell />);
    expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Export", () => {
  it("shows stats, saves a PES with the real thread colours, centred by default", async () => {
    const platform = fakePlatform();
    setPlatform(platform);
    renderEditor(<EditorShell />, { design: testDesign() });
    await waitFor(() => expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(false), T);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    const stats = await screen.findByLabelText("Export stats", undefined, T);
    expect(within(stats).getByText("Colour changes").nextSibling?.textContent).toBe("1");
    expect(within(stats).getByText("Size").nextSibling?.textContent).toMatch(/^\d+\.\d × \d+\.\d mm$/);
    expect((screen.getByLabelText("centre") as HTMLElement).getAttribute("aria-checked")).toBe("true");

    fireEvent.change(screen.getByLabelText("File name"), { target: { value: "my badge" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Save PES" }) as HTMLButtonElement).disabled).toBe(false), T);
    fireEvent.click(screen.getByRole("button", { name: "Save PES" }));
    await waitFor(() => expect(platform.saveFile).toHaveBeenCalledTimes(1), T);

    const [name, bytes] = (platform.saveFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Uint8Array];
    expect(name).toBe("my badge.pes");
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("#PES");
    const pes = readPes(bytes);
    expect(pes.colors.map((c) => c.name)).toEqual(["Blue", "Red"]); // real colours, not the demo's fixed table
    const xs = pes.stitches.filter((s) => s.type === "stitch").map((s) => s.x);
    expect(Math.min(...xs)).toBeCloseTo(-Math.max(...xs), 0); // centre origin
  });

  it("moves the origin when another of the 3x3 points is chosen", async () => {
    const platform = fakePlatform();
    setPlatform(platform);
    renderEditor(<EditorShell />, { design: testDesign() });
    await waitFor(() => expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(false), T);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await screen.findByLabelText("Export stats", undefined, T);
    fireEvent.click(screen.getByLabelText("top left"));
    await waitFor(() => expect((screen.getByRole("button", { name: "Save PES" }) as HTMLButtonElement).disabled).toBe(false), T);
    // wait for the re-prepared file (button flickers disabled while re-preparing)
    await new Promise((r) => setTimeout(r, 50));
    await waitFor(() => expect((screen.getByRole("button", { name: "Save PES" }) as HTMLButtonElement).disabled).toBe(false), T);
    fireEvent.click(screen.getByRole("button", { name: "Save PES" }));
    await waitFor(() => expect(platform.saveFile).toHaveBeenCalled(), T);
    const bytes = (platform.saveFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as Uint8Array;
    const st = readPes(bytes).stitches.filter((s) => s.type === "stitch");
    expect(Math.min(...st.map((s) => s.x))).toBeCloseTo(0, 0);
    expect(Math.min(...st.map((s) => s.y))).toBeCloseTo(0, 0);
  });

  it("shows validation warnings before saving", async () => {
    setPlatform(fakePlatform());
    const d = testDesign();
    d.hoop = { name: "tiny", widthMm: 20, heightMm: 20 };
    renderEditor(<EditorShell />, { design: d });
    await waitFor(() => expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(false), T);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    const list = await screen.findByLabelText("Warnings", undefined, T);
    expect(list.textContent).toMatch(/tiny hoop/);
  });

  it("reports a failed save", async () => {
    setPlatform(fakePlatform({ saveFile: vi.fn(async () => Promise.reject(new Error("disk full"))) }));
    renderEditor(<EditorShell />, { design: testDesign() });
    await waitFor(() => expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(false), T);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Save PES" }) as HTMLButtonElement).disabled).toBe(false), T);
    fireEvent.click(screen.getByRole("button", { name: "Save PES" }));
    await screen.findByText(/Export failed: disk full/);
  });
});

describe("Send", () => {
  it("lists saved machines and sends the real design PES to the chosen one", async () => {
    const platform = fakePlatform();
    setPlatform(platform);
    renderEditor(<EditorShell />, { design: testDesign() });
    await waitFor(() => expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false), T);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText(/NV2700 \(192\.168\.1\.9\)/);
    const sendButtons = () => screen.getAllByRole("button", { name: "Send" });
    await waitFor(() => expect((sendButtons().at(-1) as HTMLButtonElement).disabled).toBe(false), T);
    fireEvent.click(sendButtons().at(-1)!);
    await screen.findByText(/Sent as Untitled design\.pes/, undefined, T);
    const [ip, filename, bytes] = (platform.sendToMachine as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, Uint8Array];
    expect([ip, filename]).toEqual(["192.168.1.9", "Untitled design.pes"]);
    expect(readPes(bytes).colors.map((c) => c.name)).toEqual(["Blue", "Red"]);
  });

  it("shows the browser stub error instead of crashing", async () => {
    setPlatform(fakePlatform({ savedMachines: vi.fn(async () => Promise.reject(new Error("savedMachines is not available in browser"))) }));
    renderEditor(<EditorShell />, { design: testDesign() });
    await waitFor(() => expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false), T);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText(/not available in browser/);
  });
});
