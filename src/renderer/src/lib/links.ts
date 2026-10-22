import type { Playlist, SavedProfile, User } from "@shared/types";
import { useNav } from "@/state/nav";
import { player } from "@/state/player";
import { useSettings } from "@/state/settings";
import { call } from "./sky";

export function saveProfile(user: User) {
  const { savedProfiles, save } = useSettings.getState();
  if (savedProfiles.some((p) => p.id === user.id)) return;
  const entry: SavedProfile = { id: user.id, username: user.username, permalinkUrl: user.permalinkUrl, avatarUrl: user.avatarUrl };
  save({ savedProfiles: [...savedProfiles, entry] });
}

/** Pin a playlist to the sidebar, or unpin it. */
export function togglePin(p: Playlist) {
  const { pinnedPlaylists, save } = useSettings.getState();
  save({
    pinnedPlaylists: pinnedPlaylists.some((x) => x.id === p.id)
      ? pinnedPlaylists.filter((x) => x.id !== p.id)
      : [...pinnedPlaylists, { id: p.id, title: p.title, artworkUrl: p.artworkUrl, trackCount: p.trackCount }],
  });
}

export function unsaveProfile(id: number) {
  const { savedProfiles, save } = useSettings.getState();
  save({ savedProfiles: savedProfiles.filter((p) => p.id !== id) });
}

export const looksLikeLink = (text: string) => /^\s*(https?:\/\/)?([\w-]+\.)?soundcloud\.com\//i.test(text);

/**
 * Open a soundcloud.com link inside the app: a profile opens its page (and can be kept in the sidebar), a playlist
 * opens its page, a track starts playing. Throws SkyError for links that don't resolve.
 */
export async function openLink(text: string, opts: { saveUser?: boolean } = {}) {
  const url = /^https?:\/\//i.test(text.trim()) ? text.trim() : `https://${text.trim()}`;
  const resolved = await call("data:resolve", url);
  const { go, open } = useNav.getState();
  if (resolved.kind === "user") {
    const root = { name: "profile", userId: resolved.user.id } as const;
    // a profile kept in the sidebar opens as its own section; otherwise it opens inside the current one
    if (opts.saveUser) {
      saveProfile(resolved.user);
      open(`profile:${resolved.user.id}`, root);
    } else go(root);
  } else if (resolved.kind === "playlist") {
    go({ name: "playlist", id: resolved.playlist.id });
  } else {
    player.playFrom([resolved.track], 0, { kind: "static" });
  }
  return resolved;
}
