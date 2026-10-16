import { nativeImage, type BrowserWindow, type NativeImage } from "electron";
import { readFileSync } from "node:fs";
import type { PlayerCommand, PlayerInfo } from "@shared/ipc";
import play1 from "../../../resources/thumb-play.png?asset";
import play2 from "../../../resources/thumb-play@2x.png?asset";
import pause1 from "../../../resources/thumb-pause.png?asset";
import pause2 from "../../../resources/thumb-pause@2x.png?asset";
import next1 from "../../../resources/thumb-next.png?asset";
import next2 from "../../../resources/thumb-next@2x.png?asset";
import prev1 from "../../../resources/thumb-previous.png?asset";
import prev2 from "../../../resources/thumb-previous@2x.png?asset";

/** ⏮ ⏯ ⏭ under the window's preview on the taskbar. Windows drops them when the window is hidden: set again on show. */
let icons: Record<"play" | "pause" | "next" | "previous", NativeImage> | null = null;

function image(x1: string, x2: string) {
  const img = nativeImage.createEmpty();
  img.addRepresentation({ scaleFactor: 1, buffer: readFileSync(x1) });
  img.addRepresentation({ scaleFactor: 2, buffer: readFileSync(x2) });
  return img;
}

let last = "";

export function updateThumbar(win: BrowserWindow | null, info: PlayerInfo, command: (c: PlayerCommand) => void, force = false) {
  if (!win || win.isDestroyed() || process.platform !== "win32") return;
  const key = `${!!info.track}|${info.playing}`;
  if (key === last && !force) return;
  last = key;
  icons ??= { play: image(play1, play2), pause: image(pause1, pause2), next: image(next1, next2), previous: image(prev1, prev2) };
  const off = info.track ? [] : (["disabled"] as const);
  win.setThumbarButtons([
    { tooltip: "Previous", icon: icons.previous, flags: [...off], click: () => command("previous") },
    { tooltip: info.playing ? "Pause" : "Play", icon: info.playing ? icons.pause : icons.play, flags: [...off], click: () => command("playPause") },
    { tooltip: "Next", icon: icons.next, flags: [...off], click: () => command("next") },
  ]);
}
