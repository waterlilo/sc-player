import type { Playlist } from "@shared/types";
import { queryClient } from "@/api/queries";
import { en as t } from "@/i18n/en";
import { useAuth } from "@/state/auth";
import { askCheck, useCheck } from "@/state/check";
import { useSettings } from "@/state/settings";
import { call, errorCode } from "./sky";

/**
 * Own playlists, made and changed in the app: on SoundCloud when signed in, otherwise kept on this computer (main's
 * local-playlists.ts, ids starting with "local-"). Every change refreshes the lists and pages that show them.
 */

export const isLocal = (id: string) => id.startsWith("local-");

/** where on soundcloud.com the bot protection's check is passed for a playlist change */
const PLAYLISTS_PAGE = "https://soundcloud.com/you/sets";

/**
 * SoundCloud's bot protection may stop a change (seen on making a playlist): the check dialog (CheckDialog) lets the
 * person pass the site's check, then the change is tried again. Closed without it, the change fails like any other.
 */
async function checked<T>(action: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (errorCode(err) !== "verify") throw err;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      askCheck({
        action,
        url: PLAYLISTS_PAGE,
        passOnly: true,
        retry: async () => {
          try {
            resolve(await run());
            done = true;
            return true;
          } catch {
            return false;
          }
        },
      });
      const off = useCheck.subscribe((s) => {
        if (s.pending) return;
        off();
        if (!done) reject(err);
      });
    });
  }
}

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

/**
 * A new playlist. SoundCloud's bot protection can refuse making one from the app, and passing the site's check doesn't
 * lift it (seen 2026-10-25): then it can be kept on this computer instead.
 */
export async function createPlaylist(title: string, trackIds: number[] = []): Promise<Playlist> {
  let p: Playlist;
  try {
    p = await call("data:createPlaylist", title, trackIds);
  } catch (err) {
    if (errorCode(err) !== "verify" || !window.confirm(t.keepLocalConfirm)) throw err;
    p = await call("data:createPlaylist", title, trackIds, "local");
  }
  refresh();
  return p;
}

export async function addToPlaylist(id: string, trackId: number) {
  await checked(t.addToPlaylist, () => call("data:addToPlaylist", id, trackId));
  refresh(id);
}

/** The whole list in this order: reordered, or with tracks taken out. */
export async function setTracks(id: string, trackIds: number[]) {
  await checked(t.editPlaylist, () => call("data:setPlaylistTracks", id, trackIds));
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
  await checked(t.editPlaylist, () => call("data:renamePlaylist", id, title));
  repin(id, { title });
  refresh(id);
}

export async function deletePlaylist(id: string) {
  await checked(t.deletePlaylist, () => call("data:deletePlaylist", id));
  repin(id, null);
  refresh();
  queryClient.removeQueries({ queryKey: ["playlist", id] });
  queryClient.removeQueries({ queryKey: ["playlistTracks", id] });
}
