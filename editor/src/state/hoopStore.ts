import { createStore } from "zustand/vanilla";
import {
  emptyCustomHoops,
  exportCustomHoops,
  importCustomHoops,
  makeCustomHoop,
  normalizeHoop,
  removeCustomHoop,
  upsertCustomHoop,
  type CustomHoopInput,
  type Hoop,
} from "@lilo/engine/light";
import { getPlatform } from "../platform";

/**
 * The user's own hoops, app-wide (not per project): `~/Documents/Lilo/hoops.json` on the desktop,
 * localStorage in a browser. Built and checked by the engine (`hoops/index.ts`); this is the holder, the
 * same pattern as the My Threads shelf. Also the recently used hoops (this computer's localStorage).
 */
export interface HoopLibState {
  custom: Hoop[];
  status: "idle" | "loading" | "ready" | "error";
  /** Set when reading or writing failed; the list still works for this session. */
  error: string | null;
  /** The file was damaged but the previous save is good: the picker offers to restore it. */
  recovery: { backup: string } | null;
  /** Recently chosen hoops, newest first. */
  recents: Hoop[];
}

const RECENTS_KEY = "lilo.hoop-recents";
const MAX_RECENTS = 6;

function loadRecents(): Hoop[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENTS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, MAX_RECENTS).map((h) => normalizeHoop(h));
  } catch {
    return [];
  }
}

export const hoopStore = createStore<HoopLibState>(() => ({ custom: [], status: "idle", error: null, recovery: null, recents: loadRecents() }));

let loading: Promise<void> | null = null;
let writes: Promise<void> = Promise.resolve();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Read the custom hoops from the platform. Safe to call many times: it loads once. */
export function loadHoops(): Promise<void> {
  loading ??= (async () => {
    hoopStore.setState({ status: "loading" });
    try {
      const file = await getPlatform().readHoops();
      if (file.corrupt) {
        // never overwrite what we could not read; offer the previous save if it is good
        hoopStore.setState({
          status: "error",
          error: file.backup ? "Your custom hoops file is damaged, but the copy from the previous save is intact." : "Your custom hoops file is damaged and there is no earlier copy, so it has been left alone.",
          recovery: file.backup ? { backup: file.backup } : null,
        });
        return;
      }
      hoopStore.setState({ custom: file.text ? importCustomHoops(file.text).hoops : emptyCustomHoops().hoops, status: "ready", error: null, recovery: null });
    } catch (e) {
      // keep going with an empty list, but never overwrite the file we could not read
      hoopStore.setState({ status: "error", error: `Could not read your hoops: ${msg(e)}` });
    }
  })();
  return loading;
}

async function persist(list: Hoop[]): Promise<void> {
  hoopStore.setState({ custom: list });
  if (hoopStore.getState().status === "error") return; // do not overwrite a file we could not read
  const text = exportCustomHoops(list);
  writes = writes.then(() => getPlatform().writeHoops(text)).catch((e) => hoopStore.setState({ error: `Could not save your hoops: ${msg(e)}` }));
  await writes;
}

/** Add a hoop (or, with `editingId`, replace that one). Returns the saved hoop; throws `HoopError` listing form problems. */
export async function saveCustomHoop(input: CustomHoopInput, editingId?: string): Promise<Hoop> {
  await loadHoops();
  const list = hoopStore.getState().custom;
  const hoop = makeCustomHoop(input, list, editingId);
  await persist(upsertCustomHoop(list, hoop));
  return hoop;
}

export async function deleteCustomHoop(id: string): Promise<void> {
  await loadHoops();
  await persist(removeCustomHoop(hoopStore.getState().custom, id));
  hoopStore.setState({ recents: hoopStore.getState().recents.filter((h) => h.id !== id) });
  saveRecents();
}

/** Bring back the previous save of a damaged hoops file (and keep using it from now on). */
export async function restoreHoopsBackup(): Promise<void> {
  const r = hoopStore.getState().recovery;
  if (!r) return;
  const list = importCustomHoops(r.backup).hoops;
  hoopStore.setState({ status: "ready", error: null, recovery: null });
  await persist(list);
}

function saveRecents(): void {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(hoopStore.getState().recents));
  } catch {
    // no localStorage: recents last for this session
  }
}

/** Remember a chosen hoop at the top of the recents (the same id or the same size replaces its older entry). */
export function rememberHoop(hoop: Hoop): void {
  const same = (a: Hoop) => (hoop.id ? a.id === hoop.id : !a.id && a.widthMm === hoop.widthMm && a.heightMm === hoop.heightMm && a.name === hoop.name);
  hoopStore.setState({ recents: [hoop, ...hoopStore.getState().recents.filter((a) => !same(a))].slice(0, MAX_RECENTS) });
  saveRecents();
}

/** Test hook: forget everything loaded so far. */
export function resetHoopStore(): void {
  loading = null;
  writes = Promise.resolve();
  hoopStore.setState({ custom: [], status: "idle", error: null, recovery: null, recents: [] });
}
