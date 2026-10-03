import { useEffect } from "react";
import { useStore } from "zustand";
import { getPlatform } from "../platform";
import { appearanceStore, htmlAttributes, type AppearanceState } from "../state/appearanceStore";

/** The canvas listens for this to re-read its colours (the CSS variables just changed). */
export const APPEARANCE_EVENT = "lilo:appearance";

/** Put the attributes on `<html>` that glass.css keys on. */
export function applyAppearance(root: HTMLElement, s: AppearanceState): void {
  const a = htmlAttributes(s);
  if (a.theme) root.dataset.theme = a.theme;
  else delete root.dataset.theme;
  root.dataset.material = a.material;
  root.dataset.solid = a.solid;
  root.dataset.reduceTransparency = a.reduce;
  // the macOS window has an overlay title bar (tauri.macos.conf.json): the page must leave room for the traffic lights
  root.dataset.titlebar = getPlatform().kind === "tauri" && /Mac/.test(navigator.userAgent) ? "overlay" : "none";
}

/**
 * Keeps `<html>` in step with the appearance choices and the window: the material the desktop shell
 * reports, the OS "Reduce transparency" setting (asked again whenever the window comes back to the front,
 * since there is no change notification we can hear), and the light/dark choice (also told to the native
 * window so its glass follows). Mount once, at the top of the app.
 */
export function useApplyAppearance(): void {
  const state = useStore(appearanceStore);

  useEffect(() => {
    const platform = getPlatform();
    const off = platform.onWindowMaterial((material) => appearanceStore.setState({ material }));
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-transparency: reduce)") : null;
    const ask = async () => {
      let system = mq?.matches ?? false;
      try {
        system = (await platform.reduceTransparency()) || system;
      } catch {
        // keep the media query's answer
      }
      if (system !== appearanceStore.getState().systemReduceTransparency) appearanceStore.setState({ systemReduceTransparency: system });
    };
    void ask();
    const onVisible = () => {
      if (document.visibilityState === "visible") void ask();
    };
    window.addEventListener("focus", ask);
    document.addEventListener("visibilitychange", onVisible);
    mq?.addEventListener?.("change", ask);
    return () => {
      off();
      window.removeEventListener("focus", ask);
      document.removeEventListener("visibilitychange", onVisible);
      mq?.removeEventListener?.("change", ask);
    };
  }, []);

  useEffect(() => {
    applyAppearance(document.documentElement, state);
    window.dispatchEvent(new Event(APPEARANCE_EVENT));
  }, [state]);

  useEffect(() => {
    void getPlatform().setWindowTheme(state.theme === "system" ? null : state.theme);
  }, [state.theme]);
}
