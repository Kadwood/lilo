import { describe, expect, it } from "vitest";
import { browserPlatform } from "./browser";
import { getPlatform, setPlatform } from "./index";

describe("browser platform stub", () => {
  it("rejects machine operations with 'not available in browser'", async () => {
    await expect(browserPlatform.discoverMachines()).rejects.toThrow("not available in browser");
    await expect(browserPlatform.savedMachines()).rejects.toThrow("not available in browser");
    await expect(browserPlatform.sendToMachine("1.2.3.4", "a.pes", new Uint8Array())).rejects.toThrow(
      "not available in browser",
    );
  });
});

describe("getPlatform", () => {
  it("falls back to the browser stub outside Tauri and honours overrides", () => {
    setPlatform(null);
    expect(getPlatform().kind).toBe("browser");
    const fake = { ...browserPlatform, kind: "tauri" as const };
    setPlatform(fake);
    expect(getPlatform()).toBe(fake);
    setPlatform(null);
  });
});
