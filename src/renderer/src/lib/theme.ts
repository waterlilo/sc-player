import { useSyncExternalStore } from "react";
import type { ThemePref, ThemeState } from "@shared/ipc";
import { call, on } from "./sky";

/**
 * Theme state lives in main (follows Windows until the user picks one). The first value arrives synchronously through
 * preload, so <html data-theme> is right before the first paint; the switch itself is the 1.2 s token transition.
 */
let state: ThemeState = window.sky.boot.theme;
const listeners = new Set<() => void>();

function apply(next: ThemeState) {
  state = next;
  if (document.documentElement.dataset.theme !== next.theme) document.documentElement.dataset.theme = next.theme;
  listeners.forEach((l) => l());
}

export function initTheme() {
  document.documentElement.dataset.theme = state.theme;
  on("theme:changed", apply);
}

export async function setThemePref(pref: ThemePref) {
  apply(await call("theme:set", pref));
}

/** The title bar's moon/sun and the flower on Now Playing: flip night ↔ day (a manual choice, remembered). */
export function toggleTheme() {
  return setThemePref(state.theme === "night" ? "day" : "night");
}

export function useTheme() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
