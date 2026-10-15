import { create } from "zustand";
import type { HotkeyAction, PlayerInfo, UpdateStatus } from "@shared/ipc";
import { player, usePlayer } from "@/state/player";
import { call, on } from "./sky";

/** What main reports back: updates, global shortcuts that another app holds. */
export const useSystem = create<{ update: UpdateStatus; hotkeysFailed: HotkeyAction[] }>(() => ({
  update: { state: "idle" },
  hotkeysFailed: [],
}));

/**
 * The page's side of the tray, global shortcuts and notifications: commands from main drive the player, and main
 * hears about the current track and play state (only when they change).
 */
export function initSystemBridge() {
  on("player:command", (c) => {
    if (c === "playPause") player.toggle();
    else if (c === "next") player.next();
    else player.prev();
  });
  on("hotkeys:failed", (failed) => useSystem.setState({ hotkeysFailed: failed }));
  on("update:status", (update) => useSystem.setState({ update }));

  let last = "";
  const report = () => {
    const s = usePlayer.getState();
    const t = s.queue[s.index];
    const info: PlayerInfo = {
      track: t ? { id: t.id, title: t.title, artist: t.artist, artworkUrl: t.artworkUrl } : null,
      playing: s.status === "playing" || s.status === "loading",
    };
    const key = `${info.track?.id ?? ""}|${info.playing}`;
    if (key === last) return;
    last = key;
    void call("player:state", info).catch(() => undefined);
  };
  usePlayer.subscribe(report);

  // page errors go to the log file (Settings → Diagnostics)
  window.addEventListener("error", (e) => void call("log:write", `${e.message} @ ${e.filename}:${e.lineno}`).catch(() => undefined));
  window.addEventListener("unhandledrejection", (e) => void call("log:write", `unhandled: ${String(e.reason)}`).catch(() => undefined));
}
