import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { app } from "electron";
import iconPath from "../../../resources/icon.png?asset";
import { log } from "./log";

/**
 * Linux: the .deb installs a menu entry (and with it the scplayer:// links for the browser sign-in and friend links);
 * an AppImage is one file anywhere, so it writes its own entry the first time it runs (and again when it moves).
 * Start with the system goes through ~/.config/autostart, as desktops expect.
 */

const NAME = "sc-player";
const dataHome = () => process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
const configHome = () => process.env.XDG_CONFIG_HOME || join(homedir(), ".config");

/** what starts the app: the AppImage file itself, or the installed binary */
const launcher = () => process.env.APPIMAGE || process.execPath;

/** a path in a .desktop Exec line: quoted, with ", `, $ and \ escaped */
const quoted = (s: string) => `"${s.replace(/(["`$\\])/g, "\\$1")}"`;

function writeIfChanged(file: string, text: string): boolean {
  try {
    if (existsSync(file) && readFileSync(file, "utf8") === text) return false;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, "utf8");
    return true;
  } catch (err) {
    log("main", `linux: couldn't write ${file}: ${String(err)}`);
    return false;
  }
}

function entry(exec: string, extra: string[] = []) {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=sc player",
    "Comment=SoundCloud player",
    `Exec=${exec}`,
    `Icon=${NAME}`,
    "Terminal=false",
    "Categories=AudioVideo;Audio;Player;",
    ...extra,
    "",
  ].join("\n");
}

/** The AppImage's menu entry and icon (the link handler comes with the entry). */
export function integrateLinux() {
  if (process.platform !== "linux" || !app.isPackaged || !process.env.APPIMAGE) return;
  const icon = join(dataHome(), "icons", "hicolor", "256x256", "apps", `${NAME}.png`);
  try {
    if (!existsSync(icon)) {
      mkdirSync(dirname(icon), { recursive: true });
      writeFileSync(icon, readFileSync(iconPath));
    }
  } catch (err) {
    log("main", `linux: couldn't place the icon: ${String(err)}`);
  }
  const apps = join(dataHome(), "applications");
  if (writeIfChanged(join(apps, `${NAME}.desktop`), entry(`${quoted(launcher())} %U`, ["MimeType=x-scheme-handler/scplayer;"]))) {
    log("main", "linux: menu entry written for the AppImage");
    // the desktop learns about the new link handler; missing tools are fine
    try {
      spawn("update-desktop-database", [apps], { stdio: "ignore" }).on("error", () => undefined);
    } catch {
      /* not there */
    }
  }
}

/** Start with the system: an entry in ~/.config/autostart (started this way the app gets --hidden). */
export function linuxAutostart(enabled: boolean, hiddenArg: string) {
  const file = join(configHome(), "autostart", `${NAME}.desktop`);
  if (!enabled) {
    rmSync(file, { force: true });
    return;
  }
  writeIfChanged(file, entry(`${quoted(launcher())} ${hiddenArg}`, ["X-GNOME-Autostart-enabled=true"]));
}
