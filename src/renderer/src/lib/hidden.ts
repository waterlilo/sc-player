import { useMemo } from "react";
import type { Track } from "@shared/types";
import { useSettings } from "@/state/settings";

/** Blocked artists and hidden keywords (Settings): such tracks are left out of lists and skipped in the queue. */
export function isHidden(track: Track): boolean {
  const { blockedArtists, hiddenKeywords } = useSettings.getState().prefs;
  if (blockedArtists.some((a) => a.id === track.user.id)) return true;
  if (!hiddenKeywords.length) return false;
  const text = `${track.title} ${track.artist} ${track.user.username}`.toLowerCase();
  return hiddenKeywords.some((k) => k && text.includes(k.toLowerCase()));
}

/** Same, as a hook-friendly filter for lists (re-renders when the settings change). */
export function useVisibleTracks(tracks: Track[]): Track[] {
  const blocked = useSettings((s) => s.prefs.blockedArtists);
  const keywords = useSettings((s) => s.prefs.hiddenKeywords);
  return useMemo(() => (blocked.length || keywords.length ? tracks.filter((t) => !isHidden(t)) : tracks), [tracks, blocked, keywords]);
}
