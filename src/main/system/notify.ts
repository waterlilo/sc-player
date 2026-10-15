import { nativeImage, Notification } from "electron";
import type { PlayerInfo } from "@shared/ipc";
import { scSession } from "../soundcloud";
import { appIcon } from "./tray";

/** A toast with the new track when it changes while the window isn't in front (Settings → Notifications). */
let lastId: number | null = null;

export async function notifyTrack(info: PlayerInfo, enabled: boolean, windowInFront: boolean) {
  const t = info.track;
  if (!t || t.id === lastId) return;
  lastId = t.id;
  if (!enabled || windowInFront || !info.playing || !Notification.isSupported()) return;
  let icon = appIcon();
  if (t.artworkUrl && /^https:\/\/[a-z0-9.-]+\.sndcdn\.com\//.test(t.artworkUrl)) {
    try {
      const res = await scSession().fetch(t.artworkUrl.replace(/-(large|t\d+x\d+)\./, "-t300x300."), { signal: AbortSignal.timeout(4000) });
      if (res.ok) icon = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
    } catch {
      /* the app icon then */
    }
  }
  new Notification({ title: t.title, body: t.artist, icon, silent: true }).show();
}
