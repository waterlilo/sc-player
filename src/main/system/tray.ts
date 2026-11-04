import { app, Menu, nativeImage, Tray, type BrowserWindow, type NativeImage } from "electron";
import type { PlayerCommand, PlayerInfo } from "@shared/ipc";
import iconPath from "../../../resources/icon.png?asset";
import trayTemplate1 from "../../../resources/trayTemplate.png?asset";
import trayTemplate2 from "../../../resources/trayTemplate@2x.png?asset";
import { m } from "../i18n";
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
  if (process.platform === "darwin") app.focus({ steal: true });
}

/**
 * The picture in the tray: on macOS the black-on-clear template (the menu bar colours it; the coloured logo would be a
 * blob), on Linux a bigger one (the panel scales it to its own size), on Windows 16 px.
 */
function trayIcon(icon: NativeImage): NativeImage {
  if (process.platform === "darwin") {
    const t = nativeImage.createFromPath(trayTemplate1);
    const big = nativeImage.createFromPath(trayTemplate2);
    if (!big.isEmpty()) t.addRepresentation({ scaleFactor: 2, buffer: big.toPNG() });
    if (!t.isEmpty()) {
      t.setTemplateImage(true);
      return t;
    }
  }
  return icon.resize(process.platform === "linux" ? { width: 32, height: 32 } : { width: 16, height: 16 });
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function rebuild() {
  if (!tray || !deps) return;
  const t = info.track;
  const title = t ? `${t.artist} — ${t.title}` : "sc player";
  tray.setToolTip(cut(title, 120));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t ? cut(title, 60) : m().nothingPlaying, enabled: false },
      { type: "separator" },
      { label: info.playing ? m().pause : m().play, enabled: !!t, click: () => deps?.command("playPause") },
      { label: m().next, enabled: !!t, click: () => deps?.command("next") },
      { label: m().previous, enabled: !!t, click: () => deps?.command("previous") },
      { type: "separator" },
      { label: m().show, click: () => showWindow(deps?.window() ?? null) },
      { label: m().quit, click: () => deps?.quit() },
    ]),
  );
}

export function createTray(d: NonNullable<typeof deps>) {
  deps = d;
  const icon = appIcon();
  // the picture ships in app.asar/resources (package.json build.files); an empty one means it was left out
  if (icon.isEmpty()) log("main", `tray: icon missing at ${iconPath}`);
  tray = new Tray(trayIcon(icon));
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
