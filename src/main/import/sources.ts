import { net } from "electron";
import type { ImportItem, ImportList, ImportService } from "@shared/types";
import { chromeUserAgent, ScError } from "../soundcloud";
import { log } from "../system/log";
import { parseInput, spotifyTitle, withVersion, type Source } from "./parse";

/**
 * Reads what a pasted link points to, without an account on the other service:
 * - Yandex Music: the API its own app uses (api.music.yandex.net, unofficial) answers public playlists, albums and
 *   shared "Мне нравится" links with every track — title, version, artists, length.
 * - Spotify: the player it gives websites to embed (open.spotify.com/embed) carries a playlist's first 100 tracks, an
 *   album, or one track. Spotify's API reads other people's playlists only for big companies' apps (2026), and the
 *   site's own API is closed to other programs — so a longer playlist comes as its track links (Ctrl+A, Ctrl+C in
 *   the Spotify app), read one by one.
 * Nobody's password or token is asked for.
 */

const MAX_ITEMS = 1000;
const TIMEOUT = 15_000;

// ---- Yandex Music -------------------------------------------------------------------------------------------------

const YANDEX_API = "https://api.music.yandex.net";

interface YTrack {
  id?: string | number;
  title?: string;
  version?: string;
  artists?: { name?: string }[];
  durationMs?: number;
}
interface YPlaylist {
  title?: string;
  trackCount?: number;
  tracks?: { id?: string | number; track?: YTrack }[];
}
interface YAlbum {
  title?: string;
  volumes?: YTrack[][];
}

const NOT_OPEN_YANDEX = "This Yandex Music playlist doesn't open. If it's private, copy its link with Share in Yandex Music, or make it public.";

async function yandex<T>(path: string, body?: URLSearchParams): Promise<T> {
  let res: Response;
  try {
    res = await net.fetch(YANDEX_API + path, {
      method: body ? "POST" : "GET",
      body,
      headers: { "X-Yandex-Music-Client": "YandexMusicAndroid/24023621", Accept: "application/json", ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch (err) {
    log("main", `import: yandex ${path}: ${String(err)}`);
    throw new ScError("offline", "Couldn't reach Yandex Music. Check the connection and try again.");
  }
  const data = (await res.json().catch(() => null)) as { result?: T; error?: { name?: string } } | null;
  if (res.status === 404 || res.status === 403 || /not-found|no-rights/.test(data?.error?.name ?? "")) throw new ScError("not_found", NOT_OPEN_YANDEX);
  if (!res.ok || !data?.result) {
    log("main", `import: yandex ${path}: ${res.status} ${data?.error?.name ?? ""}`);
    throw new ScError("unavailable", `Yandex Music didn't answer (${res.status}). Try again in a minute.`);
  }
  return data.result;
}

const fromYandex = (t: YTrack): ImportItem | null =>
  t.title ? { title: withVersion(t.title, t.version), artist: (t.artists ?? []).map((a) => a.name).filter(Boolean).join(", "), durationMs: t.durationMs || null } : null;

/** Tracks by id, 200 at a time (a playlist may list some by id only). */
async function yandexTracks(ids: string[]): Promise<YTrack[]> {
  const out: YTrack[] = [];
  for (let i = 0; i < ids.length; i += 200) out.push(...(await yandex<YTrack[]>("/tracks", new URLSearchParams({ "track-ids": ids.slice(i, i + 200).join(",") }))));
  return out;
}

async function yandexPlaylist(path: string): Promise<{ title: string | null; items: ImportItem[] }> {
  const p = await yandex<YPlaylist>(path);
  const entries = (p.tracks ?? []).slice(0, MAX_ITEMS);
  const missing = entries.filter((e) => !e.track?.title && e.id !== undefined).map((e) => String(e.id));
  const fetched = new Map((missing.length ? await yandexTracks(missing) : []).map((t) => [String(t.id), t]));
  const items = entries.map((e) => fromYandex(e.track?.title ? e.track : (fetched.get(String(e.id)) ?? {}))).filter((i): i is ImportItem => !!i);
  return { title: p.title?.trim() || null, items };
}

async function yandexAlbum(id: string): Promise<{ title: string | null; items: ImportItem[] }> {
  const a = await yandex<YAlbum>(`/albums/${id}/with-tracks`);
  const items = (a.volumes ?? []).flat().map(fromYandex).filter((i): i is ImportItem => !!i);
  return { title: a.title?.trim() || null, items };
}

async function yandexTrack(id: string): Promise<ImportItem> {
  const [t] = await yandex<YTrack[]>(`/tracks/${id}`);
  const item = t && fromYandex(t);
  if (!item) throw new ScError("not_found", "This Yandex Music track doesn't open.");
  return item;
}

// ---- Spotify ------------------------------------------------------------------------------------------------------

interface SEntity {
  type?: string;
  name?: string;
  title?: string;
  duration?: number;
  artists?: { name?: string }[];
  trackList?: { title?: string; subtitle?: string; duration?: number; entityType?: string }[];
}

const NOT_OPEN_SPOTIFY = "This Spotify link doesn't open. The playlist may be private or deleted: in Spotify, make it public, or copy its tracks (see below).";

/** What Spotify's embedded player knows about a playlist, album or track (its page's data). */
async function spotifyEmbed(type: "playlist" | "album" | "track", id: string): Promise<SEntity> {
  let res: Response;
  try {
    res = await net.fetch(`https://open.spotify.com/embed/${type}/${id}`, { headers: { "User-Agent": chromeUserAgent(), "Accept-Language": "en" }, signal: AbortSignal.timeout(TIMEOUT) });
  } catch (err) {
    log("main", `import: spotify ${type}: ${String(err)}`);
    throw new ScError("offline", "Couldn't reach Spotify. Check the connection and try again.");
  }
  if (res.status === 404 || res.status === 400) throw new ScError("not_found", NOT_OPEN_SPOTIFY);
  if (!res.ok) throw new ScError("unavailable", `Spotify didn't answer (${res.status}). Try again in a minute.`);
  const html = await res.text();
  const json = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  let entity: SEntity | undefined;
  try {
    entity = json ? (JSON.parse(json) as { props?: { pageProps?: { state?: { data?: { entity?: SEntity } } } } }).props?.pageProps?.state?.data?.entity : undefined;
  } catch {
    entity = undefined;
  }
  if (!entity) {
    log("main", `import: spotify ${type}: no data in the page`);
    throw new ScError("not_found", NOT_OPEN_SPOTIFY);
  }
  return entity;
}

const SPOTIFY_FIRST = 100;

async function spotifyList(type: "playlist" | "album", id: string): Promise<{ title: string | null; items: ImportItem[]; partial: boolean }> {
  const e = await spotifyEmbed(type, id);
  const tracks = (e.trackList ?? []).filter((t) => t.title && (t.entityType ?? "track") === "track");
  const items = tracks.map((t) => ({ title: spotifyTitle(t.title!), artist: t.subtitle ?? "", durationMs: t.duration || null }));
  return { title: (e.name ?? e.title)?.trim() || null, items, partial: type === "playlist" && (e.trackList?.length ?? 0) >= SPOTIFY_FIRST };
}

async function spotifyTrack(id: string): Promise<ImportItem> {
  const e = await spotifyEmbed("track", id);
  const title = e.name ?? e.title;
  if (!title) throw new ScError("not_found", "This Spotify track doesn't open.");
  return { title: spotifyTitle(title), artist: (e.artists ?? []).map((a) => a.name).filter(Boolean).join(", "), durationMs: e.duration || null };
}

/** spotify.link/… leads to an open.spotify.com page: where it lands. */
async function followShort(url: string): Promise<Source | null> {
  try {
    const res = await net.fetch(url, { headers: { "User-Agent": chromeUserAgent() }, signal: AbortSignal.timeout(TIMEOUT) });
    const landed = res.url.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|album|track)\/([A-Za-z0-9]{22})/) ?? (await res.text()).match(/open\.spotify\.com\/(playlist|album|track)\/([A-Za-z0-9]{22})/);
    if (!landed) return null;
    return { kind: landed[1] === "playlist" ? "spotifyPlaylist" : landed[1] === "album" ? "spotifyAlbum" : "spotifyTrack", id: landed[2]! };
  } catch {
    return null;
  }
}

// ---- reading ------------------------------------------------------------------------------------------------------

const isList = (s: Source) => s.kind === "yandexPlaylist" || s.kind === "yandexShared" || s.kind === "yandexAlbum" || s.kind === "spotifyPlaylist" || s.kind === "spotifyAlbum";

/**
 * The pasted text read: a playlist or album link → its tracks (the first such link; one list at a time); otherwise
 * track links and lines of text → those tracks, a link's title and artist read later (`resolveItem`), while
 * SoundCloud is searched, so a long list shows its progress.
 */
export async function readImport(text: string): Promise<ImportList> {
  let sources = parseInput(text, MAX_ITEMS);
  // a short link is replaced by what it leads to
  if (sources.some((s) => s.kind === "spotifyShort")) {
    const out: Source[] = [];
    for (const s of sources) {
      if (s.kind !== "spotifyShort") out.push(s);
      else {
        const landed = await followShort(s.url);
        if (landed) out.push(landed);
      }
    }
    sources = out;
  }
  if (!sources.length) throw new ScError("not_found", "Nothing to import here. Paste a link to a playlist or album, track links, or lines like “Artist — Title”.");

  const list = sources.find(isList);
  if (list) {
    const read =
      list.kind === "yandexPlaylist"
        ? { ...(await yandexPlaylist(`/users/${encodeURIComponent(list.owner)}/playlists/${list.id}`)), service: "yandex" as const, partial: false }
        : list.kind === "yandexShared"
          ? { ...(await yandexPlaylist(`/playlist/${list.uuid}`)), service: "yandex" as const, partial: false }
          : list.kind === "yandexAlbum"
            ? { ...(await yandexAlbum(list.id)), service: "yandex" as const, partial: false }
            : { ...(await spotifyList(list.kind === "spotifyPlaylist" ? "playlist" : "album", list.id)), service: "spotify" as const };
    if (!read.items.length) throw new ScError("not_found", "There are no tracks in this playlist.");
    log("main", `import: read a ${read.service} ${list.kind}: ${read.items.length} tracks${read.partial ? " (the first part)" : ""}`);
    return { service: read.service, title: read.title, items: read.items.slice(0, MAX_ITEMS), partial: read.partial };
  }

  const items: ImportItem[] = sources.flatMap((s): ImportItem[] =>
    s.kind === "line"
      ? [{ title: s.title, artist: s.artist, durationMs: s.durationMs }]
      : s.kind === "spotifyTrack"
        ? [{ title: "", artist: "", durationMs: null, ref: `spotify:${s.id}` }]
        : s.kind === "yandexTrack"
          ? [{ title: "", artist: "", durationMs: null, ref: `yandex:${s.id}` }]
          : [],
  );
  const refs = items.filter((i) => i.ref);
  const service: ImportService = refs.some((i) => i.ref!.startsWith("spotify:")) ? "spotify" : refs.length ? "yandex" : "text";
  log("main", `import: read ${items.length} ${service === "text" ? "lines" : "tracks"}`);
  return { service, title: null, items, partial: false };
}

/** A track link's title, artist and length (the rest come filled in already). */
export async function resolveItem(item: ImportItem): Promise<ImportItem> {
  if (!item.ref) return item;
  const [service, id] = item.ref.split(":");
  if (!id || !/^[A-Za-z0-9]{1,40}$/.test(id)) throw new ScError("unknown", "bad track link");
  if (service === "spotify") return spotifyTrack(id);
  if (service === "yandex") return yandexTrack(id);
  throw new ScError("unknown", "bad track link");
}
