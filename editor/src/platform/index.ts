import { browserPlatform } from "./browser";
import { tauriPlatform } from "./tauri";
import type { Platform } from "./types";

export type * from "./types";

/** True when running inside the Tauri webview. */
export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let override: Platform | null = null;

/** Tests inject a fake platform here; pass null to reset. */
export function setPlatform(p: Platform | null): void {
  override = p;
}

export function getPlatform(): Platform {
  return override ?? (isTauri() ? tauriPlatform : browserPlatform);
}
