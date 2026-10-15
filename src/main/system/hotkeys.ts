import { globalShortcut } from "electron";
import type { HotkeyAction, Prefs } from "@shared/ipc";

/**
 * Global shortcuts: they work while another app (After Effects) has focus. Settings records them; a shortcut another
 * app already holds can't be taken and is reported back. Suspended while Settings records a new one, so pressing it
 * doesn't fire the old action.
 */
let current: Prefs["hotkeys"] | null = null;
let suspended = false;
let handler: ((action: HotkeyAction) => void) | null = null;

export function initHotkeys(onAction: (action: HotkeyAction) => void) {
  handler = onAction;
}

/** Registers the shortcuts; returns the actions whose shortcut couldn't be registered. */
export function applyHotkeys(hotkeys: Prefs["hotkeys"]): HotkeyAction[] {
  current = hotkeys;
  globalShortcut.unregisterAll();
  if (suspended) return [];
  const failed: HotkeyAction[] = [];
  for (const [action, accel] of Object.entries(hotkeys) as [HotkeyAction, string][]) {
    if (!accel) continue;
    try {
      if (!globalShortcut.register(accel, () => handler?.(action))) failed.push(action);
    } catch {
      failed.push(action);
    }
  }
  return failed;
}

export function suspendHotkeys(on: boolean): HotkeyAction[] {
  suspended = on;
  if (on) {
    globalShortcut.unregisterAll();
    return [];
  }
  return current ? applyHotkeys(current) : [];
}
