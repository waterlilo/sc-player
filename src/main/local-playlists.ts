import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { app } from "electron";
import type { Page, Playlist, Track } from "@shared/types";
import { ScError } from "./soundcloud";
import { JsonFile } from "./store/json-file";

/**
 * Playlists kept on this computer, for whoever isn't signed in to SoundCloud (signed in, playlists are made on
 * SoundCloud). A playlist is its tracks' ids plus what its card needs without asking SoundCloud (length, a cover);
 * the tracks themselves are fetched like any others. Signed in later, one can be moved to SoundCloud.
 */

interface Item {
  id: number;
  durationMs: number;
  artworkUrl: string | null;
}
interface LocalList {
  id: string;
  title: string;
  items: Item[];
  created: number;
}

export const LOCAL_PREFIX = "local-";
export const isLocal = (id: string) => id.startsWith(LOCAL_PREFIX);
/** SoundCloud's own limit for a playlist */
export const MAX_TRACKS = 500;
const PAGE = 50;

let file: JsonFile<{ lists: LocalList[] }> | null = null;
const store = () => (file ??= new JsonFile(join(app.getPath("userData"), "local-playlists.json"), { lists: [] as LocalList[] }));
const lists = () => store().get().lists;
const save = (next: LocalList[]) => store().patch({ lists: next });

function find(id: string): LocalList {
  const l = lists().find((x) => x.id === id);
  if (!l) throw new ScError("not_found", "this playlist is gone");
  return l;
}

const item = (t: Track): Item => ({ id: t.id, durationMs: t.durationMs, artworkUrl: t.artworkUrl });

function toPlaylist(l: LocalList): Playlist {
  return {
    id: l.id,
    title: l.title,
    // no SoundCloud user: the page shows "On this computer" instead of a profile link
    user: { id: 0, username: "", permalinkUrl: "" },
    artworkUrl: l.items.find((i) => i.artworkUrl)?.artworkUrl ?? null,
    trackCount: l.items.length,
    durationMs: l.items.reduce((sum, i) => sum + i.durationMs, 0),
    permalinkUrl: "",
    isAlbum: false,
    relation: "own",
    releaseDate: new Date(l.created).toISOString(),
    genre: null,
  };
}

export const localPlaylists = (): Playlist[] => [...lists()].sort((a, b) => b.created - a.created).map(toPlaylist);
export const localPlaylist = (id: string): Playlist => toPlaylist(find(id));
export const localIds = (id: string): number[] => find(id).items.map((i) => i.id);

/** A page of the tracks, fetched by id (`getTracks` takes up to 200 at a time). */
export async function localTracks(id: string, cursor: string | null, getTracks: (ids: number[]) => Promise<Track[]>): Promise<Page<Track>> {
  const offset = cursor ? Number(cursor) : 0;
  if (!Number.isInteger(offset) || offset < 0) throw new ScError("unknown", "bad cursor");
  const ids = localIds(id);
  const items = await getTracks(ids.slice(offset, offset + PAGE));
  return { items, next: offset + PAGE < ids.length ? String(offset + PAGE) : null };
}

export function createLocal(title: string, tracks: Track[]): Playlist {
  const l: LocalList = { id: LOCAL_PREFIX + randomBytes(8).toString("hex"), title, items: dedupe(tracks).slice(0, MAX_TRACKS).map(item), created: Date.now() };
  save([...lists(), l]);
  return toPlaylist(l);
}

/** The list in a new order, or with tracks taken out: `ids` are the ones left, in order (others are ignored). */
export function setLocalTracks(id: string, ids: number[]) {
  const l = find(id);
  const have = new Map(l.items.map((i) => [i.id, i]));
  const items = [...new Set(ids)].map((x) => have.get(x)).filter((i): i is Item => !!i);
  save(lists().map((x) => (x === l ? { ...l, items } : x)));
}

export function addLocal(id: string, track: Track) {
  const l = find(id);
  if (l.items.some((i) => i.id === track.id)) return;
  if (l.items.length >= MAX_TRACKS) throw new ScError("unknown", `a playlist holds up to ${MAX_TRACKS} tracks`);
  save(lists().map((x) => (x === l ? { ...l, items: [...l.items, item(track)] } : x)));
}

export function renameLocal(id: string, title: string) {
  const l = find(id);
  save(lists().map((x) => (x === l ? { ...l, title } : x)));
}

export function deleteLocal(id: string) {
  find(id);
  save(lists().filter((x) => x.id !== id));
}

export const flushLocalPlaylists = () => file?.flush();

function dedupe(tracks: Track[]) {
  const seen = new Set<number>();
  return tracks.filter((t) => !seen.has(t.id) && seen.add(t.id));
}
