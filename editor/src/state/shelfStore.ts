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
}

export const shelfStore = createStore<ShelfState>(() => ({ shelf: emptyShelf(), status: "idle", error: null }));

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
      const text = await getPlatform().readMyThreads();
      shelfStore.setState({ shelf: text ? importShelf(text) : emptyShelf(), status: "ready", error: null });
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

/** Forget everything (tests). */
export function resetShelfStore(): void {
  loading = null;
  writes = Promise.resolve();
  shelfStore.setState({ shelf: emptyShelf(), status: "idle", error: null });
}

export function useShelf(): ShelfState {
  return useStore(shelfStore);
}
