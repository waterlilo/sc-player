import { app } from "electron";

export const HIDDEN_ARG = "--hidden";

/**
 * Start with Windows. Only for the installed app: a dev build would register electron.exe, and a portable .exe
 * moves around. Started this way, the app gets --hidden (with "start minimized" it then stays in the tray).
 */
export function applyAutostart(enabled: boolean) {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;
  app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_ARG] });
}

export const startedHidden = () => process.argv.includes(HIDDEN_ARG);
