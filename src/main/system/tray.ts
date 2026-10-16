import { Menu, nativeImage, Tray, type BrowserWindow } from "electron";
import type { PlayerCommand, PlayerInfo } from "@shared/ipc";
import iconPath from "../../../resources/icon.png?asset";
import { log } from "./log";

/**
 * The tray icon: a click shows or hides the window, the menu has the current track and the transport. Music keeps
 * playing while the window is hidden.
 */
let tray: Tray | null = null;
let info: PlayerInfo = { track: null, playing: false };
let deps: { window: () => BrowserWindow | null; command: (c: PlayerCommand) => void; quit: () => void } | null = null;

export const appIcon = () => nativeImage.createFromPath(iconPath);

export function showWindow(win: BrowserWindow | null) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function rebuild() {
  if (!tray || !deps) return;
  const t = info.track;
  const title = t ? `${t.artist} — ${t.title}` : "sc player";
  tray.setToolTip(cut(title, 120));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t ? cut(title, 60) : "Nothing playing", enabled: false },
      { type: "separator" },
      { label: info.playing ? "Pause" : "Play", enabled: !!t, click: () => deps?.command("playPause") },
      { label: "Next", enabled: !!t, click: () => deps?.command("next") },
      { label: "Previous", enabled: !!t, click: () => deps?.command("previous") },
      { type: "separator" },
      { label: "Show sc player", click: () => showWindow(deps?.window() ?? null) },
      { label: "Quit", click: () => deps?.quit() },
    ]),
  );
}

export function createTray(d: NonNullable<typeof deps>) {
  deps = d;
  const icon = appIcon();
  // the picture ships in app.asar/resources (package.json build.files); an empty one means it was left out
  if (icon.isEmpty()) log("main", `tray: icon missing at ${iconPath}`);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.on("click", () => {
    const win = d.window();
    if (!win) return;
    if (win.isVisible() && !win.isMinimized() && win.isFocused()) win.hide();
    else showWindow(win);
  });
  rebuild();
}

export function updateTray(next: PlayerInfo) {
  const changed = next.playing !== info.playing || next.track?.id !== info.track?.id;
  info = next;
  if (changed) rebuild();
}
