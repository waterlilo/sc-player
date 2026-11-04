import { app } from "electron";
import { log } from "./log";
import { linuxAutostart } from "./linux";

export const HIDDEN_ARG = "--hidden";

/**
 * Start with the system. Only for the installed app: a dev build would register electron.exe, and a portable .exe
 * moves around. Started this way, the app gets --hidden (with "start minimized" it then stays in the tray).
 * Windows and macOS keep it as a login item; Linux as an entry in ~/.config/autostart.
 */
export function applyAutostart(enabled: boolean) {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;
  try {
    if (process.platform === "linux") linuxAutostart(enabled, HIDDEN_ARG);
    else app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_ARG] });
  } catch (err) {
    // macOS refuses a login item for an app run from outside /Applications (straight from the .dmg)
    log("main", `autostart: ${String(err)}`);
  }
}

export const startedHidden = () => process.argv.includes(HIDDEN_ARG);
