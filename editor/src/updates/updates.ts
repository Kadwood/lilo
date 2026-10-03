import { createContext, useContext, useSyncExternalStore } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * In-app updates: the logic, with the Tauri plugin behind a small interface so it can be tested.
 *
 * Rules (the product spec):
 * - check on launch, at most once a day, only if "Automatically check for updates" is on (default on)
 * - a failed or offline check is silent; only "Check for updates now" shows errors
 * - installing goes through the unsaved-changes question first (`guard`)
 * - Lilo only ever asks GitHub Releases for `latest.json` (endpoint in tauri.conf.json), nothing else
 */

export const AUTO_KEY = "lilo.updates.auto";
export const LAST_CHECK_KEY = "lilo.updates.lastCheck";
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** A newer version found by a check. */
export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  /** Release notes text from latest.json, if any. */
  notes: string | null;
  /** Download, verify the signature and install. Does not restart. */
  downloadAndInstall(onProgress: (downloaded: number, total: number | null) => void): Promise<void>;
}

export interface UpdaterBackend {
  /** null when updates work here, otherwise why not (shown in Settings). */
  unavailableReason(): Promise<string | null>;
  /** The newer version, or null when up to date. Rejects when offline or the server fails. */
  check(): Promise<AvailableUpdate | null>;
  relaunch(): Promise<void>;
}

export type CheckStatus = "idle" | "checking" | "up-to-date" | "error" | "unavailable";

export interface UpdateState {
  status: CheckStatus;
  update: AvailableUpdate | null;
  /** The banner was closed for this version. */
  dismissedVersion: string | null;
  installing: boolean;
  /** 0..1 while downloading, null when unknown. */
  progress: number | null;
  /** Shown for manual checks and failed installs; never set by a silent check. */
  error: string | null;
  /** Why updates can't run here (browser, build without a key). */
  unavailable: string | null;
  autoCheck: boolean;
}

export interface UpdatesDeps {
  backend: UpdaterBackend;
  storage: Pick<Storage, "getItem" | "setItem">;
  now?: () => number;
  /** Run the unsaved-changes question, then `fn`. Resolves to whether `fn` ran. */
  guard?: (fn: () => Promise<void>) => Promise<boolean>;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "string" ? e : "Unknown error");

/** Pure: is a launch-time check due? */
export function checkIsDue(autoCheck: boolean, lastCheck: number | null, now: number): boolean {
  if (!autoCheck) return false;
  if (lastCheck === null || !Number.isFinite(lastCheck)) return true;
  // a clock set back must not freeze updates forever
  return now < lastCheck || now - lastCheck >= CHECK_INTERVAL_MS;
}

export function createUpdates(deps: UpdatesDeps) {
  const { backend, storage } = deps;
  const now = deps.now ?? Date.now;
  const read = (k: string): string | null => {
    try {
      return storage.getItem(k);
    } catch {
      return null;
    }
  };
  const write = (k: string, v: string): void => {
    try {
      storage.setItem(k, v);
    } catch {
      /* private mode / full: the setting just won't persist */
    }
  };
  const lastCheck = (): number | null => {
    const v = read(LAST_CHECK_KEY);
    return v === null ? null : Number(v);
  };

  const store: StoreApi<UpdateState> = createStore<UpdateState>(() => ({
    status: "idle",
    update: null,
    dismissedVersion: null,
    installing: false,
    progress: null,
    error: null,
    unavailable: null,
    autoCheck: read(AUTO_KEY) !== "false",
  }));
  const { getState: get, setState: set } = store;

  /** One check. `manual` decides whether a failure is shown. */
  async function run(manual: boolean): Promise<void> {
    if (get().status === "checking" || get().installing) return;
    set({ status: "checking", error: null });
    try {
      const reason = await backend.unavailableReason();
      if (reason) {
        set({ status: "unavailable", unavailable: reason, error: null });
        return;
      }
      const update = await backend.check();
      write(LAST_CHECK_KEY, String(now()));
      set({ status: update ? "idle" : "up-to-date", update, unavailable: null });
    } catch (e) {
      set(manual ? { status: "error", error: errorText(e) } : { status: "idle" });
    }
  }

  return {
    store,

    /** Launch-time check: runs only when enabled and at least a day since the last good one. */
    async checkIfDue(): Promise<void> {
      if (checkIsDue(get().autoCheck, lastCheck(), now())) await run(false);
    },

    /** "Check for updates now": always runs and reports failures. */
    checkNow: () => run(true),

    setAutoCheck(on: boolean): void {
      write(AUTO_KEY, String(on));
      set({ autoCheck: on });
    },

    dismiss(): void {
      const u = get().update;
      if (u) set({ dismissedVersion: u.version });
    },

    /**
     * "Install and restart". `guard` asks about unsaved changes first; if the user backs out nothing
     * is downloaded.
     */
    async install(): Promise<void> {
      const u = get().update;
      if (!u || get().installing) return;
      const go = async () => {
        set({ installing: true, progress: null, error: null });
        try {
          await u.downloadAndInstall((done, total) => set({ progress: total ? Math.min(1, done / total) : null }));
          await backend.relaunch();
        } catch (e) {
          set({ installing: false, progress: null, error: `Could not install the update: ${errorText(e)}` });
        }
      };
      if (deps.guard) await deps.guard(go);
      else await go();
    },

    /** Replace the guard (the project manager only exists once the app is mounted). */
    setGuard(guard: UpdatesDeps["guard"]): void {
      deps.guard = guard;
    },
  };
}

export type Updates = ReturnType<typeof createUpdates>;

export const UpdatesContext = createContext<Updates | null>(null);

/** The controller, or null where there is no provider (a lone component in a test, the browser build of a page). */
export const useOptionalUpdates = (): Updates | null => useContext(UpdatesContext);

/** Subscribe to a slice of the update state. */
export function useUpdateState<T>(updates: Updates, select: (s: UpdateState) => T): T {
  return useSyncExternalStore(
    updates.store.subscribe,
    () => select(updates.store.getState()),
    () => select(updates.store.getState()),
  );
}
