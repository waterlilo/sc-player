import type { Playlist } from "@shared/types";
import { queryClient } from "@/api/queries";
import { useAuth } from "@/state/auth";
import { useSettings } from "@/state/settings";
import { call } from "./sky";

/**
 * Own playlists, made and changed in the app: on SoundCloud when signed in, otherwise kept on this computer (main's
 * local-playlists.ts, ids starting with "local-"). Every change refreshes the lists and pages that show them.
 */

export const isLocal = (id: string) => id.startsWith("local-");

/** Can this playlist be changed here: one on this computer, or the signed-in user's own on SoundCloud. */
export function canEdit(p: Playlist | undefined): boolean {
  if (!p) return false;
  if (isLocal(p.id)) return true;
  const me = useAuth.getState().status?.user?.id;
  return !p.id.startsWith("soundcloud:") && me !== undefined && p.user.id === me;
}

function refresh(id?: string) {
  void queryClient.invalidateQueries({ queryKey: ["playlists"] });
  void queryClient.invalidateQueries({ queryKey: ["myPlaylists"] });
  if (id) {
    void queryClient.invalidateQueries({ queryKey: ["playlist", id] });
    void queryClient.invalidateQueries({ queryKey: ["playlistTracks", id] });
  }
}

/** a pinned playlist's card keeps its title and cover */
function repin(id: string, change: Partial<{ title: string }> | null) {
  const { pinnedPlaylists, save } = useSettings.getState();
  if (!pinnedPlaylists.some((x) => x.id === id)) return;
  save({ pinnedPlaylists: change ? pinnedPlaylists.map((x) => (x.id === id ? { ...x, ...change } : x)) : pinnedPlaylists.filter((x) => x.id !== id) });
}

export async function createPlaylist(title: string, trackIds: number[] = []): Promise<Playlist> {
  const p = await call("data:createPlaylist", title, trackIds);
  refresh();
  return p;
}

export async function addToPlaylist(id: string, trackId: number) {
  await call("data:addToPlaylist", id, trackId);
  refresh(id);
}

/** The whole list in this order: reordered, or with tracks taken out. */
export async function setTracks(id: string, trackIds: number[]) {
  await call("data:setPlaylistTracks", id, trackIds);
  refresh(id);
}

export async function removeFromPlaylist(id: string, trackId: number) {
  const ids = await call("data:sourceIds", { kind: "playlist", playlistId: id, cursor: null });
  await setTracks(
    id,
    ids.filter((x) => x !== trackId),
  );
}

export async function renamePlaylist(id: string, title: string) {
  await call("data:renamePlaylist", id, title);
  repin(id, { title });
  refresh(id);
}

export async function deletePlaylist(id: string) {
  await call("data:deletePlaylist", id);
  repin(id, null);
  refresh();
  queryClient.removeQueries({ queryKey: ["playlist", id] });
  queryClient.removeQueries({ queryKey: ["playlistTracks", id] });
}

/** One on this computer goes to SoundCloud (signed in): the new playlist. */
export async function uploadPlaylist(id: string): Promise<Playlist> {
  const p = await call("data:uploadPlaylist", id);
  repin(id, null);
  refresh();
  return p;
}
