import { createStore } from "zustand/vanilla";
import type { WindowMaterial } from "../platform/types";

/**
 * How Lilo looks: light/dark, and whether the chrome may be see-through. App-wide and remembered in
 * localStorage (a preference of this computer, not part of a project). `material` is what the window is
 * made of behind the page (reported by the desktop shell; always "solid" in a browser).
 */
export type ThemeChoice = "system" | "light" | "dark";

export interface AppearanceState {
  theme: ThemeChoice;
  /** The user's own "Reduce transparency" switch. */
  reduceTransparency: boolean;
  /** The OS accessibility setting of the same name (macOS) or `prefers-reduced-transparency`. */
  systemReduceTransparency: boolean;
  material: WindowMaterial;
}

const KEY = "lilo.appearance";

function load(): Pick<AppearanceState, "theme" | "reduceTransparency"> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
    return {
      theme: raw.theme === "light" || raw.theme === "dark" ? raw.theme : "system",
      reduceTransparency: raw.reduceTransparency === true,
    };
  } catch {
    return { theme: "system", reduceTransparency: false };
  }
}

function save(s: AppearanceState): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ theme: s.theme, reduceTransparency: s.reduceTransparency }));
  } catch {
    // private mode / full: the choice still holds for this session
  }
}

export const appearanceStore = createStore<AppearanceState>(() => ({ ...load(), systemReduceTransparency: false, material: "solid" }));

export function setTheme(theme: ThemeChoice): void {
  appearanceStore.setState({ theme });
  save(appearanceStore.getState());
}

export function setReduceTransparency(on: boolean): void {
  appearanceStore.setState({ reduceTransparency: on });
  save(appearanceStore.getState());
}

/** Is the chrome solid right now: the user said so, the OS said so, or there is nothing behind the page to see through. */
export const surfacesSolid = (s: Pick<AppearanceState, "reduceTransparency" | "systemReduceTransparency" | "material">): boolean =>
  s.reduceTransparency || s.systemReduceTransparency || s.material === "solid";

/** The attributes `<html>` carries so the stylesheet can follow (see glass.css). `theme` is absent for "system". */
export function htmlAttributes(s: AppearanceState): { theme: "light" | "dark" | null; material: WindowMaterial; solid: "true" | "false"; reduce: "true" | "false" } {
  return {
    theme: s.theme === "system" ? null : s.theme,
    material: s.material,
    solid: surfacesSolid(s) ? "true" : "false",
    reduce: s.reduceTransparency || s.systemReduceTransparency ? "true" : "false",
  };
}
