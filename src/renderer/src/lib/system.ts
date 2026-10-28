import { create } from "zustand";
import type { HotkeyAction, PlayerInfo, UpdateStatus } from "@shared/ipc";
import * as engine from "@/audio/engine";
import { player, usePlayer, usePosition } from "@/state/player";
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
  let lastStart = 0;
  const report = () => {
    const s = usePlayer.getState();
    const t = s.queue[s.index];
    const playing = s.status === "playing" || s.status === "loading";
    // Discord's time bar: sent again when the position jumps (a seek), not as it runs
    const startedAt = playing && t ? Math.round(Date.now() - engine.currentTime() * 1000) : 0;
    const info: PlayerInfo = {
      track: t ? { id: t.id, title: t.title, artist: t.artist, artworkUrl: t.artworkUrl, permalinkUrl: t.permalinkUrl } : null,
      playing,
      ...(startedAt ? { startedAt, durationMs: Math.round(s.duration * 1000) || t?.durationMs } : {}),
    };
    const key = `${info.track?.id ?? ""}|${info.playing}|${s.duration}`;
    if (key === last && Math.abs(startedAt - lastStart) < 2000) return;
    last = key;
    lastStart = startedAt;
    void call("player:state", info).catch(() => undefined);
  };
  usePlayer.subscribe(report);
  usePosition.subscribe(report);

  // page errors go to the log file (Settings → Diagnostics)
  window.addEventListener("error", (e) => void call("log:write", `${e.message} @ ${e.filename}:${e.lineno}`).catch(() => undefined));
  window.addEventListener("unhandledrejection", (e) => void call("log:write", `unhandled: ${String(e.reason)}`).catch(() => undefined));
}
