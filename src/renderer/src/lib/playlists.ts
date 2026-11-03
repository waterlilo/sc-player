import { useQuery } from "@tanstack/react-query";
import type { Page, Playlist } from "@shared/types";
import { queryClient, usePlaylists } from "@/api/queries";
import { useSettings } from "@/state/settings";
import { call } from "./sky";

/**
 * Own playlists, made and changed in the app and kept on this computer (main's local-playlists.ts, ids starting with
 * "local-"): SoundCloud's bot protection refuses playlist changes from the app, so SoundCloud's own playlists are for
 * listening here. Every change refreshes the lists and pages that show them.
 */

export const isLocal = (id: string) => id.startsWith("local-");

/** Can this playlist be changed here: one of your own, on this computer. */
export const canEdit = (p: Playlist | undefined): boolean => !!p && isLocal(p.id);

function refresh(id?: string) {
  void queryClient.invalidateQueries({ queryKey: ["playlists"] });
  void queryClient.invalidateQueries({ queryKey: ["myPlaylists"] });
  if (id) {
    void queryClient.invalidateQueries({ queryKey: ["playlist", id] });
    void queryClient.invalidateQueries({ queryKey: ["playlistTracks", id] });
  }
}

/**
 * ♥ on an album or someone's playlist: kept on this computer (main's local-likes.ts), shown in Playlists and Albums.
 * Liked: ♥-ed here, or liked by the account on SoundCloud (and not un-♥-ed here).
 */
export function usePlaylistLike(p: Playlist | undefined): { liked: boolean; toggle: () => Promise<boolean> } {
  const saved = useQuery({ queryKey: ["savedPlaylists"], queryFn: () => call("data:savedPlaylists") });
  const mine = usePlaylists("me", !!p && !isLocal(p.id));
  const liked = !!p && (!!saved.data?.includes(p.id) || !!mine.data?.pages.some((pg) => pg.items.some((x) => x.id === p.id && x.relation === "liked")));
  const toggle = async () => {
    if (!p) return liked;
    await call("data:setPlaylistSaved", p.id, !liked);
    void queryClient.invalidateQueries({ queryKey: ["savedPlaylists"] });
    refresh();
    return !liked;
  };
  return { liked, toggle };
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

/**
 * A SoundCloud playlist (yours, someone else's or SoundCloud's own) as one of yours on this computer, to change: in
 * parts of 500 when longer. Copied before: the copy made then, with existed true.
 */
export async function copyPlaylist(p: Playlist): Promise<{ made: Playlist[]; existed: boolean }> {
  const res = await call("data:copyPlaylist", p.id);
  if (!res.existed) refresh();
  return res;
}

/**
 * All of your SoundCloud playlists and albums copied to this computer, one after another (the ones copied before are
 * left as they are). `progress` gets how many are done of how many.
 */
export async function copyMine(progress: (done: number, all: number) => void): Promise<{ copied: number; existed: number; failed: number }> {
  const mine: Playlist[] = [];
  let cursor: string | null = null;
  do {
    const page: Page<Playlist> = await call("data:playlists", cursor);
    mine.push(...page.items.filter((p) => p.relation === "own" && !isLocal(p.id)));
    cursor = page.next;
  } while (cursor);
  const out = { copied: 0, existed: 0, failed: 0 };
  progress(0, mine.length);
  for (const [i, p] of mine.entries()) {
    try {
      const res = await call("data:copyPlaylist", p.id);
      out[res.existed ? "existed" : "copied"]++;
    } catch {
      out.failed++;
    }
    progress(i + 1, mine.length);
  }
  refresh();
  return out;
}

export async function exportPlaylists() {
  return call("data:exportPlaylists");
}

export async function importPlaylists() {
  const n = await call("data:importPlaylists");
  if (n) refresh();
  return n;
}

export async function deletePlaylist(id: string) {
  await call("data:deletePlaylist", id);
  repin(id, null);
  refresh();
  queryClient.removeQueries({ queryKey: ["playlist", id] });
  queryClient.removeQueries({ queryKey: ["playlistTracks", id] });
}
