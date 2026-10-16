import { artwork } from "@shared/types";
import { player, usePlayer, usePosition } from "@/state/player";

/**
 * The keyboard's media keys and Windows' media flyout (cover, title, ⏮ ⏯ ⏭, the seek bar) through the Media Session
 * API: Chromium hands it to Windows' System Media Transport Controls. Updated only when something changes.
 */
export function initMediaSession() {
  const ms = navigator.mediaSession;
  if (!ms) return;
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", () => player.play()],
    ["pause", () => player.pause()],
    ["previoustrack", () => player.prev()],
    ["nexttrack", () => player.next()],
    ["seekbackward", (d) => player.seekBy(-(d.seekOffset ?? 10))],
    ["seekforward", (d) => player.seekBy(d.seekOffset ?? 10)],
    ["seekto", (d) => d.seekTime !== undefined && player.seek(d.seekTime)],
    ["stop", () => player.pause()],
  ];
  for (const [action, fn] of handlers) {
    try {
      ms.setActionHandler(action, fn);
    } catch {
      /* not supported here */
    }
  }

  let trackId: number | null = null;
  let state = "";
  let positionAt = 0;
  const position = () => {
    const { duration } = usePlayer.getState();
    if (!(duration > 0)) return;
    try {
      ms.setPositionState({ duration, position: Math.min(duration, Math.max(0, usePosition.getState().position)), playbackRate: 1 });
    } catch {
      /* a position past the end while the next track loads */
    }
  };

  usePlayer.subscribe((s) => {
    const t = s.queue[s.index];
    if ((t?.id ?? null) !== trackId) {
      trackId = t?.id ?? null;
      ms.metadata = t
        ? new MediaMetadata({
            title: t.title,
            artist: t.artist,
            artwork: t.artworkUrl ? [{ src: artwork(t.artworkUrl, "t500x500") ?? t.artworkUrl, sizes: "500x500", type: "image/jpeg" }] : [],
          })
        : null;
    }
    const next = !t ? "none" : s.status === "playing" || s.status === "loading" ? "playing" : "paused";
    if (next !== state) {
      state = next;
      ms.playbackState = next as MediaSessionPlaybackState;
      position();
    }
  });
  // the flyout's seek bar: on a new duration and after jumps (it runs on its own between them)
  usePlayer.subscribe((s, prev) => s.duration !== prev.duration && position());
  usePosition.subscribe(({ position: p }) => {
    if (Math.abs(p - positionAt) > 2 || p < positionAt) position();
    positionAt = p;
  });
}
