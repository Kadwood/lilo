import { describe, expect, it, vi } from "vitest";
import { AUTO_KEY, CHECK_INTERVAL_MS, checkIsDue, createUpdates, LAST_CHECK_KEY, type AvailableUpdate, type UpdaterBackend } from "./updates";

const memory = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

const found = (over: Partial<AvailableUpdate> = {}): AvailableUpdate => ({
  version: "1.0.1",
  currentVersion: "1.0.0",
  notes: "Fixes",
  downloadAndInstall: vi.fn(async (onProgress) => {
    onProgress(50, 100);
    onProgress(100, 100);
  }),
  ...over,
});

function setup(opts: { update?: AvailableUpdate | null; checkError?: Error; reason?: string | null; storage?: ReturnType<typeof memory>; now?: number; guard?: (fn: () => Promise<void>) => Promise<boolean> } = {}) {
  const storage = opts.storage ?? memory();
  const backend: UpdaterBackend = {
    unavailableReason: vi.fn(async () => opts.reason ?? null),
    check: vi.fn(async () => {
      if (opts.checkError) throw opts.checkError;
      return opts.update === undefined ? found() : opts.update;
    }),
    relaunch: vi.fn(async () => {}),
  };
  const updates = createUpdates({ backend, storage, now: () => opts.now ?? 1_000_000_000_000, guard: opts.guard });
  return { updates, backend, storage, state: () => updates.store.getState() };
}

describe("checkIsDue", () => {
  const now = 10 * CHECK_INTERVAL_MS;
  it("is due with no earlier check, and not before a day has passed", () => {
    expect(checkIsDue(true, null, now)).toBe(true);
    expect(checkIsDue(true, now - CHECK_INTERVAL_MS + 1, now)).toBe(false);
    expect(checkIsDue(true, now - CHECK_INTERVAL_MS, now)).toBe(true);
  });
  it("never runs when automatic checks are off", () => {
    expect(checkIsDue(false, null, now)).toBe(false);
  });
  it("recovers from a clock that was set back or a garbage value", () => {
    expect(checkIsDue(true, now + 5 * CHECK_INTERVAL_MS, now)).toBe(true);
    expect(checkIsDue(true, Number.NaN, now)).toBe(true);
  });
});

describe("launch check", () => {
  it("defaults to on, finds an update and remembers when it checked", async () => {
    const t = setup();
    expect(t.state().autoCheck).toBe(true);
    await t.updates.checkIfDue();
    expect(t.state().update?.version).toBe("1.0.1");
    expect(t.state().error).toBeNull();
    expect(t.storage.m.get(LAST_CHECK_KEY)).toBe("1000000000000");
  });

  it("checks at most once a day", async () => {
    const now = 1_000_000_000_000;
    const t = setup({ now, storage: memory({ [LAST_CHECK_KEY]: String(now - 3_600_000) }) });
    await t.updates.checkIfDue();
    expect(t.backend.check).not.toHaveBeenCalled();
  });

  it("does nothing when the user turned automatic checks off (and remembers the choice)", async () => {
    const t = setup({ storage: memory({ [AUTO_KEY]: "false" }) });
    expect(t.state().autoCheck).toBe(false);
    await t.updates.checkIfDue();
    expect(t.backend.check).not.toHaveBeenCalled();
    t.updates.setAutoCheck(true);
    expect(t.storage.m.get(AUTO_KEY)).toBe("true");
    await t.updates.checkIfDue();
    expect(t.backend.check).toHaveBeenCalledTimes(1);
  });

  it("is silent when offline: no error, and it tries again next launch", async () => {
    const t = setup({ checkError: new Error("network is unreachable") });
    await t.updates.checkIfDue();
    expect(t.state().error).toBeNull();
    expect(t.state().status).toBe("idle");
    expect(t.storage.m.has(LAST_CHECK_KEY)).toBe(false);
  });

  it("does not check in a build without an update key", async () => {
    const t = setup({ reason: "no key" });
    await t.updates.checkIfDue();
    expect(t.backend.check).not.toHaveBeenCalled();
    expect(t.state()).toMatchObject({ status: "unavailable", unavailable: "no key", error: null });
  });
});

describe("Check for updates now", () => {
  it("runs even right after a check and says when Lilo is up to date", async () => {
    const t = setup({ update: null, storage: memory({ [LAST_CHECK_KEY]: "1000000000000" }) });
    await t.updates.checkNow();
    expect(t.backend.check).toHaveBeenCalledTimes(1);
    expect(t.state().status).toBe("up-to-date");
  });

  it("shows the error (unlike the silent launch check)", async () => {
    const t = setup({ checkError: new Error("404 Not Found") });
    await t.updates.checkNow();
    expect(t.state()).toMatchObject({ status: "error", error: "404 Not Found" });
  });

  it("ignores a second click while one is running", async () => {
    const t = setup();
    await Promise.all([t.updates.checkNow(), t.updates.checkNow()]);
    expect(t.backend.check).toHaveBeenCalledTimes(1);
  });
});

describe("Install and restart", () => {
  it("downloads, installs, then relaunches", async () => {
    const update = found();
    const t = setup({ update });
    await t.updates.checkNow();
    const seen: (number | null)[] = [];
    t.updates.store.subscribe((s) => seen.push(s.progress));
    await t.updates.install();
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(seen).toContain(0.5);
    expect(t.backend.relaunch).toHaveBeenCalledTimes(1);
  });

  it("asks the unsaved-changes guard first and downloads nothing if the user backs out", async () => {
    const update = found();
    const guard = vi.fn(async () => false);
    const t = setup({ update, guard });
    await t.updates.checkNow();
    await t.updates.install();
    expect(guard).toHaveBeenCalledTimes(1);
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    expect(t.backend.relaunch).not.toHaveBeenCalled();
    expect(t.state().installing).toBe(false);
  });

  it("runs the install inside the guard when the user agrees", async () => {
    const update = found();
    const guard = vi.fn(async (fn: () => Promise<void>) => {
      await fn();
      return true;
    });
    const t = setup({ update, guard });
    await t.updates.checkNow();
    await t.updates.install();
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(t.backend.relaunch).toHaveBeenCalledTimes(1);
  });

  it("keeps the banner and offers a retry when the download or signature check fails", async () => {
    const update = found({ downloadAndInstall: vi.fn(async () => Promise.reject(new Error("signature mismatch"))) });
    const t = setup({ update });
    await t.updates.checkNow();
    await t.updates.install();
    expect(t.state().installing).toBe(false);
    expect(t.state().error).toContain("signature mismatch");
    expect(t.state().update).toBe(update);
    expect(t.backend.relaunch).not.toHaveBeenCalled();
  });

  it("dismiss hides the banner for that version only", async () => {
    const t = setup();
    await t.updates.checkNow();
    t.updates.dismiss();
    expect(t.state().dismissedVersion).toBe("1.0.1");
  });
});
