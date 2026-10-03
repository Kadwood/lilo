import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { emptyShelf, exportShelf, importShelf, type Shelf } from "@lilo/engine/light";
import { getPlatform } from "../platform";

/**
 * "My Threads", app-wide (not per project): the spools the user owns. Loaded once from the platform
 * (`~/Documents/Lilo/my-threads.json` on the desktop, localStorage in the browser) and written back
 * after every change. The engine does the shelf maths (`threads/shelf.ts`); this is just the holder.
 */
export interface ShelfState {
  shelf: Shelf;
  status: "idle" | "loading" | "ready" | "error";
  /** Set when reading or writing failed; the shelf still works for this session. */
  error: string | null;
  /** The file was damaged but the previous save is good: the panel offers to restore it. */
  recovery: { backup: string } | null;
}

export const shelfStore = createStore<ShelfState>(() => ({ shelf: emptyShelf(), status: "idle", error: null, recovery: null }));

/** The shelf right now (empty until `loadShelf` finishes). */
export const getShelf = (): Shelf => shelfStore.getState().shelf;

let loading: Promise<void> | null = null;
let writes: Promise<void> = Promise.resolve();

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Read the shelf from the platform. Safe to call many times: it loads once. */
export function loadShelf(): Promise<void> {
  loading ??= (async () => {
    shelfStore.setState({ status: "loading" });
    try {
      const file = await getPlatform().readMyThreads();
      if (file.corrupt) {
        // never overwrite what we could not read; offer the previous save if it is good
        shelfStore.setState({
          status: "error",
          error: file.backup ? "Your My Threads file is damaged, but the copy from the previous save is intact." : "Your My Threads file is damaged and there is no earlier copy, so it has been left alone.",
          recovery: file.backup ? { backup: file.backup } : null,
        });
        return;
      }
      shelfStore.setState({ shelf: file.text ? importShelf(file.text) : emptyShelf(), status: "ready", error: null, recovery: null });
    } catch (e) {
      // keep going with an empty shelf, but never overwrite the file we could not read
      shelfStore.setState({ status: "error", error: `Could not read My Threads: ${msg(e)}` });
    }
  })();
  return loading;
}

/** Edit the shelf (`fn` is one of the engine's pure shelf functions) and save it. */
export async function updateShelf(fn: (s: Shelf) => Shelf): Promise<void> {
  await loadShelf();
  const next = fn(shelfStore.getState().shelf);
  shelfStore.setState({ shelf: next });
  if (shelfStore.getState().status === "error") return;
  const text = exportShelf(next);
  writes = writes.then(() => getPlatform().writeMyThreads(text)).catch((e) => shelfStore.setState({ error: `Could not save My Threads: ${msg(e)}` }));
  await writes;
}

/** Use the previous save in place of the damaged file, and save it as the shelf. */
export async function restoreShelfBackup(): Promise<void> {
  const r = shelfStore.getState().recovery;
  if (!r) return;
  const shelf = importShelf(r.backup);
  shelfStore.setState({ shelf, status: "ready", error: null, recovery: null });
  await getPlatform().writeMyThreads(exportShelf(shelf));
}

/** Carry on with an empty shelf; the damaged file is replaced by the next change (the good backup is kept). */
export function startShelfEmpty(): void {
  shelfStore.setState({ shelf: emptyShelf(), status: "ready", error: null, recovery: null });
}

/** Forget everything (tests). */
export function resetShelfStore(): void {
  loading = null;
  writes = Promise.resolve();
  shelfStore.setState({ shelf: emptyShelf(), status: "idle", error: null, recovery: null });
}

export function useShelf(): ShelfState {
  return useStore(shelfStore);
}
