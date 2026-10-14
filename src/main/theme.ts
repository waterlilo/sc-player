import { nativeTheme } from "electron";
import type { ThemePref, ThemeState } from "@shared/ipc";
import { store } from "./store";

export const THEME_BG = { night: "#07050d", day: "#2b4fd1" } as const;

/** Follows Windows (dark → night, light → day) until the user picks a theme; the choice is remembered. */
export function themeState(): ThemeState {
  const pref = store().get().theme;
  const theme = pref === "system" ? (nativeTheme.shouldUseDarkColors ? "night" : "day") : pref;
  return { pref, theme };
}

export function setThemePref(pref: ThemePref): ThemeState {
  store().patch({ theme: pref });
  return themeState();
}

export function onSystemTheme(cb: (state: ThemeState) => void) {
  nativeTheme.on("updated", () => {
    if (store().get().theme === "system") cb(themeState());
  });
}
