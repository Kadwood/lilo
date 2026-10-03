import { useEffect, useMemo, type ReactNode } from "react";
import { useOptionalProject } from "../project/ProjectProvider";
import { currentBackend } from "./backend";
import { createUpdates, UpdatesContext, type Updates } from "./updates";

/** How long after launch the first check waits, so it never competes with the app starting up. */
export const LAUNCH_CHECK_DELAY_MS = 8_000;

function safeStorage(): Pick<Storage, "getItem" | "setItem"> {
  try {
    return window.localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
  }
}

/**
 * Owns the update controller: checks on launch (when due), and routes "Install and restart"
 * through the project's unsaved-changes question. Mount inside <ProjectProvider>.
 * No launch check in development (`pnpm dev`), and none where the platform can't update.
 */
export function UpdatesProvider({
  children,
  updates,
  launchCheck = !import.meta.env.DEV,
  delayMs = LAUNCH_CHECK_DELAY_MS,
}: {
  children: ReactNode;
  /** A ready-made controller (tests). */
  updates?: Updates;
  launchCheck?: boolean;
  delayMs?: number;
}) {
  const project = useOptionalProject();
  const u = useMemo(() => updates ?? createUpdates({ backend: currentBackend(), storage: safeStorage() }), [updates]);

  useEffect(() => {
    u.setGuard(project ? (fn) => project.runGuarded("install the update", fn) : undefined);
  }, [u, project]);

  useEffect(() => {
    if (!launchCheck) return;
    const t = setTimeout(() => void u.checkIfDue(), delayMs);
    return () => clearTimeout(t);
  }, [u, launchCheck, delayMs]);

  return <UpdatesContext.Provider value={u}>{children}</UpdatesContext.Provider>;
}
