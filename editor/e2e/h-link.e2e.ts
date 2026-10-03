import { afterAll, describe, expect, it } from "vitest";
import { readEmbroidery } from "@lilo/engine";
import type { BrowserContext } from "playwright-core";
import { fixture, openApp, pickFile, stopStack } from "./harness";

afterAll(stopStack);

const API = "http://127.0.0.1:47999";

/**
 * The Lilo Link view talks to the Rust bridge: `invoke("local_api_info")` for the port and token, then
 * HTTP on localhost. In a browser neither exists, so the tauri bridge object is faked in the page and the
 * HTTP calls are answered here with a canned machine.
 */
async function fakeBridge(context: BrowserContext, calls: string[]): Promise<void> {
  await context.addInitScript((api) => {
    const w = window as unknown as Record<string, unknown>;
    w.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === "local_api_info") return { port: 47999, token: "test-token", version: "0.1.0", serverRunning: true, serverError: null, api };
        if (cmd.startsWith("plugin:event|listen")) return 1;
        return null;
      },
      transformCallback: () => 1,
      unregisterCallback: () => undefined,
      convertFileSrc: (p: string) => p,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
  }, API);

  const info = {
    identity: { manufacturer: "Brother", model: "NV2700", name: "Brother NV2700", firmware: "1.0", serial: "NV2700-0001", ip: "192.168.1.50" },
    capabilities: { embWidthMm: 160, embHeightMm: 260, needles: 1, maxFileBytes: 4_000_000, formats: ["pes"], canDeleteFiles: true, overwritesByName: false },
  };
  const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" }, body: JSON.stringify(body) });
  await context.route(`${API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    calls.push(`${req.method()} ${url.pathname}`);
    if (req.method() === "OPTIONS") return route.fulfill(json({}));
    const p = url.pathname;
    if (p === "/api/status" && url.searchParams.has("ip")) return route.fulfill(json({ info, storage: { totalBytes: 8_000_000, freeBytes: 6_000_000, usedBytes: 2_000_000, files: ["crest.pes"] } }));
    if (p === "/api/status") return route.fulfill(json({ app: "Lilo", version: "0.1.0", apiVersion: 1, uptimeSeconds: 12, server: { running: true, port: 47999, error: null }, pendingUploads: 0, savedMachines: 1, discoveryRunning: false }));
    if (p === "/api/machines") return route.fulfill(json({ saved: [{ ip: "192.168.1.50", nickname: "Suit room", manufacturer: "Brother", serial: "NV2700-0001" }], discovered: [{ info }], discoveryCompletedAtMs: Date.now(), discoveryRunning: false }));
    if (p === "/api/discover") return route.fulfill(json({ discovered: [{ info }] }));
    if (p === "/api/info") return route.fulfill(json(info));
    if (p === "/api/pairing") return route.fulfill(json({ pending: null }));
    if (p === "/api/logs") return route.fulfill(json({ entries: [{ seq: 1, timestampMs: Date.now(), level: "info", message: "Bridge started" }], lastSeq: 1 }));
    if (p === "/api/settings") return route.fulfill(json({ apiToken: "test-token", allowedOrigins: [], port: 47999 }));
    if (p === "/api/jobs") return route.fulfill(json({ jobs: [] }));
    return route.fulfill(json({ error: { code: "not_mocked", message: `not mocked: ${p}` } }, 404));
  });
}

describe("journey h: Lilo Link and Send", () => {
  it("opens the Lilo Link view against a mock bridge and sends a design to a mock machine", async () => {
    const calls: string[] = [];
    const j = await openApp("h", { setup: (c) => fakeBridge(c, calls) });
    const { page } = j;
    await j.run(async () => {
      // the Lilo Link view loads and lists the machine
      await page.getByRole("button", { name: "Lilo Link" }).click();
      await page.getByText("Local bridge ready").waitFor({ timeout: 20_000 });
      await j.shot("1-link-machines");
      await expect.poll(() => page.locator("body").innerText(), { timeout: 20_000 }).toMatch(/NV2700|Suit room/);
      for (const label of ["Send", "Logs", "Settings"]) {
        await page.locator(".link-root nav").getByRole("button", { name: label }).first().click();
        await page.waitForTimeout(500);
        await j.shot(`2-link-${label.toLowerCase()}`);
      }
      expect(calls.some((c) => c === "GET /api/machines")).toBe(true);

      // back to the editor: digitize a picture, then Send to the mock machine
      await page.getByRole("button", { name: "Home", exact: true }).click();
      await pickFile(page, "k-logo.png", fixture("k-logo.png"));
      await page.getByRole("button", { name: "Digitize a picture…" }).click();
      await page.getByText(/\d[\d,]* \/ [\d,]+ stitches/).waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1200);
      await page.getByRole("button", { name: "Send", exact: true }).first().click();
      const dialog = page.getByRole("dialog", { name: "Send to machine" });
      await dialog.getByRole("combobox", { name: "Machine" }).waitFor();
      expect(await dialog.getByRole("combobox", { name: "Machine" }).innerText()).toMatch(/Brother NV2700 \(192\.168\.1\.50\)/);
      await j.shot("3-send-dialog");
      // a sweep finds a second machine that is not saved yet
      await dialog.getByRole("button", { name: "Search network" }).click();
      await expect.poll(() => dialog.getByRole("combobox", { name: "Machine" }).innerText()).toMatch(/PR1055X.*not saved/);
      await dialog.getByRole("combobox", { name: "Machine" }).selectOption({ index: 0 });
      await dialog.getByRole("button", { name: "Send", exact: true }).click();
      await dialog.getByRole("status").filter({ hasText: /Sent/ }).waitFor({ timeout: 30_000 });
      await j.shot("4-sent");
      const sent = await page.evaluate(() => window.__lilo!.state.sends.map((s) => ({ ip: s.ip, filename: s.filename, bytes: [...s.bytes] })));
      expect(sent).toHaveLength(1);
      expect(sent[0].ip).toBe("192.168.1.50");
      expect(sent[0].filename).toMatch(/\.pes$/);
      expect(readEmbroidery(new Uint8Array(sent[0].bytes), "pes").plan.stitches.length).toBeGreaterThan(500);
      j.expectClean();
    });
  });
});
