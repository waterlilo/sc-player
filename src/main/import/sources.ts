import { net } from "electron";
import type { ImportItem, ImportList, ImportService } from "@shared/types";
import { chromeUserAgent, ScError } from "../soundcloud";
import { m } from "../i18n";
import { log } from "../system/log";
import { parseInput, spotifyTitle, withVersion, youtubeTitle, type Source } from "./parse";

/**
 * Reads what a pasted link points to, without an account on the other service:
 * - Yandex Music: the API its own app uses (api.music.yandex.net, unofficial) answers public playlists, albums and
 *   shared "Мне нравится" links with every track — title, version, artists, length.
 * - Spotify: the player it gives websites to embed (open.spotify.com/embed) carries a playlist's first 100 tracks, an
 *   album, or one track. Spotify's API reads other people's playlists only for big companies' apps (2026), and the
 *   site's own API is closed to other programs — so a longer playlist comes as its track links (Ctrl+A, Ctrl+C in
 *   the Spotify app), read one by one.
 * - YouTube Music: the API its web player uses (music.youtube.com/youtubei, unofficial) answers public and unlisted
 *   playlists and albums whole, 100 tracks a page, and one video. Someone's "Liked music" opens to no one else.
 * Nobody's password or token is asked for.
 */

// a VK "My music" of a couple of thousand tracks fits (saved as playlists of 500)
const MAX_ITEMS = 3000;
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
    throw new ScError("offline", m().yandexOffline);
  }
  const data = (await res.json().catch(() => null)) as { result?: T; error?: { name?: string } } | null;
  if (res.status === 404 || res.status === 403 || /not-found|no-rights/.test(data?.error?.name ?? "")) throw new ScError("not_found", m().yandexClosed);
  // Yandex Music doesn't serve some countries (Finland, for one): the address it sees is there — often a VPN's
  if (res.status === 451) {
    log("main", `import: yandex ${path}: 451, closed to this country`);
    throw new ScError("unavailable", m().yandexRegion);
  }
  if (!res.ok || !data?.result) {
    log("main", `import: yandex ${path}: ${res.status} ${data?.error?.name ?? ""}`);
    throw new ScError("unavailable", m().yandexBusy(res.status));
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
  if (!item) throw new ScError("not_found", m().yandexTrack);
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


/** What Spotify's embedded player knows about a playlist, album or track (its page's data). */
async function spotifyEmbed(type: "playlist" | "album" | "track", id: string): Promise<SEntity> {
  let res: Response;
  try {
    res = await net.fetch(`https://open.spotify.com/embed/${type}/${id}`, { headers: { "User-Agent": chromeUserAgent(), "Accept-Language": "en" }, signal: AbortSignal.timeout(TIMEOUT) });
  } catch (err) {
    log("main", `import: spotify ${type}: ${String(err)}`);
    throw new ScError("offline", m().spotifyOffline);
  }
  if (res.status === 404 || res.status === 400) throw new ScError("not_found", m().spotifyClosed);
  if (!res.ok) throw new ScError("unavailable", m().spotifyBusy(res.status));
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
    throw new ScError("not_found", m().spotifyClosed);
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
  if (!title) throw new ScError("not_found", m().spotifyTrack);
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

// ---- YouTube Music ------------------------------------------------------------------------------------------------

const YTM = "https://music.youtube.com";
/** the web player's version it asks with; when YouTube stops taking it, the one its page names now (once a run) */
let ytmVersion = "1.20251020.01.00";
let ytmVersionChecked = false;

async function ytmFreshVersion(): Promise<boolean> {
  if (ytmVersionChecked) return false;
  ytmVersionChecked = true;
  try {
    const html = await (await net.fetch(YTM, { headers: { "User-Agent": chromeUserAgent(), "Accept-Language": "en" }, signal: AbortSignal.timeout(TIMEOUT) })).text();
    const v = html.match(/"INNERTUBE_CLIENT_VERSION":"([\d.]+)"/)?.[1];
    if (!v || v === ytmVersion) return false;
    log("main", `import: youtube music version ${ytmVersion} → ${v}`);
    ytmVersion = v;
    return true;
  } catch {
    return false;
  }
}

/**
 * The language YouTube names artists in. In Russian, Russian artists come by the names SoundCloud mostly has them
 * under ("Макс Корж", not "Max Korzh") — but some others turn Russian too ("Кулио"): a list is read in both, the
 * English name kept to look for when the Russian one finds nothing.
 */
type Lang = "ru" | "en";

async function ytm(endpoint: "browse" | "next", body: Record<string, unknown>, hl: Lang, again = true): Promise<unknown> {
  let res: Response;
  try {
    res = await net.fetch(`${YTM}/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: "POST",
      body: JSON.stringify({ context: { client: { clientName: "WEB_REMIX", clientVersion: ytmVersion, hl, gl: "US" } }, ...body }),
      headers: { "Content-Type": "application/json", Origin: YTM, Referer: `${YTM}/`, "User-Agent": chromeUserAgent() },
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch (err) {
    log("main", `import: youtube ${endpoint}: ${String(err)}`);
    throw new ScError("offline", m().youtubeOffline);
  }
  if ((res.status === 400 || res.status === 412) && again && (await ytmFreshVersion())) return ytm(endpoint, body, hl, false);
  if (res.status === 404 || res.status === 403) throw new ScError("not_found", m().youtubeClosed);
  if (!res.ok) {
    log("main", `import: youtube ${endpoint}: ${res.status}`);
    throw new ScError("unavailable", m().youtubeBusy(res.status));
  }
  return res.json().catch(() => ({}));
}

/** Every value under `key` anywhere in an answer: YouTube moves its parts around often, their names stay. */
function every(o: unknown, key: string, out: unknown[] = []): unknown[] {
  if (o && typeof o === "object") {
    if (key in o) out.push((o as Record<string, unknown>)[key]);
    for (const v of Object.values(o)) every(v, key, out);
  }
  return out;
}

const ytText = (t: unknown) => {
  const v = t as { runs?: { text?: string }[]; simpleText?: string } | undefined;
  return (v?.runs?.map((r) => r.text ?? "").join("") ?? v?.simpleText ?? "").trim();
};

/** "3:45", "1:02:03" → ms */
function ytLength(s: string): number | null {
  if (!/^\d{1,3}(:\d{2}){1,2}$/.test(s)) return null;
  return s.split(":").reduce((sum, n) => sum * 60 + Number(n), 0) * 1000;
}

interface YtRow {
  flexColumns?: { musicResponsiveListItemFlexColumnRenderer?: { text?: unknown } }[];
  fixedColumns?: { musicResponsiveListItemFixedColumnRenderer?: { text?: unknown } }[];
}
interface YtHeader {
  title?: unknown;
  straplineTextOne?: unknown;
}

type Runs = { runs?: { text?: string; navigationEndpoint?: unknown }[] };

/** The artists, "A, B": the linked names (between them YouTube writes "&" or, in Russian, "и"); else the text up to " • ". */
function ytArtists(t: unknown): string {
  const linked = ((t as Runs | undefined)?.runs ?? []).filter((r) => r.navigationEndpoint && r.text?.trim()).map((r) => r.text!.trim());
  return linked.length ? linked.join(", ") : ytText(t).split(" • ")[0]!.trim();
}

/** A track as one language names it. */
interface YtTrack {
  videoId: string;
  name: string;
  by: string;
  uploaded: boolean;
  durationMs: number | null;
}

/** A row of a playlist or an album: name, artists (an album's rows leave them to the album), length. */
function youtubeRow(row: YtRow, albumArtist: string): YtTrack | null {
  const column = (i: number) => row.flexColumns?.[i]?.musicResponsiveListItemFlexColumnRenderer?.text;
  const name = ytText(column(0));
  if (!name || /^\[(deleted|private) video\]$/i.test(name)) return null;
  return {
    videoId: String(every(row, "videoId")[0] ?? ""),
    name,
    by: ytArtists(column(1)) || albumArtist,
    uploaded: every(row, "musicVideoType")[0] === "MUSIC_VIDEO_TYPE_UGC",
    durationMs: ytLength(ytText(row.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text)),
  };
}

/**
 * A track to look for: the name as English has it ("feat. A & B", not "feat. A и B"), the artist as Russian has it,
 * and the English artist besides when it differs.
 */
function youtubeItem(ru: YtTrack, en: YtTrack | undefined): ImportItem {
  const found = youtubeTitle(en?.name ?? ru.name, ru.by, ru.uploaded);
  const alt = en ? youtubeTitle(en.name, en.by, en.uploaded).artist : "";
  return { ...found, ...(alt && alt !== found.artist ? { artistAlt: alt } : {}), durationMs: ru.durationMs };
}

const nextPage = (page: unknown) =>
  (every(page, "continuationCommand")[0] as { token?: string } | undefined)?.token ?? (every(page, "nextContinuationData")[0] as { continuation?: string } | undefined)?.continuation;

/** A playlist (or an album's page) whole, in one language: the first page, then the rest 100 at a time. */
async function youtubeRows(browseId: string, hl: Lang): Promise<{ header: YtHeader | undefined; rows: YtRow[] }> {
  const first = await ytm("browse", { browseId }, hl);
  const header = (every(first, "musicResponsiveHeaderRenderer")[0] ?? every(first, "musicDetailHeaderRenderer")[0]) as YtHeader | undefined;
  const rows = every(first, "musicResponsiveListItemRenderer") as YtRow[];
  if (!header && !rows.length) throw new ScError("not_found", m().youtubeClosed);
  let token = nextPage(first);
  for (let pages = 1; token && rows.length < MAX_ITEMS && pages < 20; pages++) {
    const page = await ytm("browse", { continuation: token }, hl);
    const more = every(page, "musicResponsiveListItemRenderer") as YtRow[];
    if (!more.length) break;
    rows.push(...more);
    token = nextPage(page);
  }
  return { header, rows };
}

/** A playlist or an album, read in Russian and in English at once (English failing costs only the second names). */
async function youtubeList(browseId: string, albumRows: boolean): Promise<{ title: string | null; items: ImportItem[] }> {
  const [ru, en] = await Promise.all([youtubeRows(browseId, "ru"), youtubeRows(browseId, "en").catch(() => null)]);
  // an album names its artist once, above its rows
  const album = (header: YtHeader | undefined) => (albumRows ? ytText(header?.straplineTextOne) : "");
  const english = new Map((en?.rows ?? []).map((r) => youtubeRow(r, album(en?.header))).filter((t): t is YtTrack => !!t?.videoId).map((t) => [t.videoId, t]));
  const items = ru.rows
    .map((r) => youtubeRow(r, album(ru.header)))
    .filter((t): t is YtTrack => !!t)
    .map((t) => youtubeItem(t, english.get(t.videoId)));
  return { title: ytText(ru.header?.title) || null, items };
}

const youtubePlaylist = (id: string) => {
  // the likes ("LM" on YouTube Music, "LL" on YouTube) open only to whoever is signed in
  if (id === "LM" || id === "LL") throw new ScError("not_found", m().youtubeLikes);
  return youtubeList(`VL${id}`, id.startsWith("OLAK5uy_"));
};

async function youtubeVideo(id: string, hl: Lang): Promise<YtTrack | undefined> {
  const next = await ytm("next", { videoId: id, isAudioOnly: true }, hl);
  type Panel = { videoId?: string; title?: unknown; longBylineText?: unknown; lengthText?: unknown };
  const panels = every(next, "playlistPanelVideoRenderer") as Panel[];
  const p = panels.find((x) => x.videoId === id) ?? panels[0];
  const name = ytText(p?.title);
  if (!p || !name) return undefined;
  return { videoId: id, name, by: ytArtists(p.longBylineText), uploaded: every(p, "musicVideoType")[0] === "MUSIC_VIDEO_TYPE_UGC", durationMs: ytLength(ytText(p.lengthText)) };
}

async function youtubeTrack(id: string): Promise<ImportItem> {
  const [ru, en] = await Promise.all([youtubeVideo(id, "ru"), youtubeVideo(id, "en").catch(() => undefined)]);
  if (!ru) throw new ScError("not_found", m().youtubeTrack);
  return youtubeItem(ru, en);
}

// ---- reading ------------------------------------------------------------------------------------------------------

const isList = (s: Source) =>
  s.kind === "yandexPlaylist" ||
  s.kind === "yandexShared" ||
  s.kind === "yandexAlbum" ||
  s.kind === "spotifyPlaylist" ||
  s.kind === "spotifyAlbum" ||
  s.kind === "youtubePlaylist" ||
  s.kind === "youtubeAlbum" ||
  s.kind === "vkList";

const fail = (_: unknown): never => {
  throw new ScError("unknown", "VK is read in its own window");
};

/**
 * The pasted text read: a playlist or album link → its tracks (the first such link; one list at a time); otherwise
 * track links and lines of text → those tracks, a link's title and artist read later (`resolveItem`), while
 * SoundCloud is searched, so a long list shows its progress. A VK link is read by `vk` (a window to sign in to).
 */
export async function readImport(text: string, vk?: (target: { url: string; key: string }) => Promise<{ title: string | null; items: ImportItem[] }>): Promise<ImportList> {
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
  if (!sources.length) throw new ScError("not_found", m().importNothing);

  const list = sources.find(isList);
  if (list) {
    const read =
      list.kind === "vkList"
        ? { ...(await (vk ?? fail)(list)), service: "vk" as const, partial: false }
        : list.kind === "yandexPlaylist"
        ? { ...(await yandexPlaylist(`/users/${encodeURIComponent(list.owner)}/playlists/${list.id}`)), service: "yandex" as const, partial: false }
        : list.kind === "yandexShared"
          ? { ...(await yandexPlaylist(`/playlist/${list.uuid}`)), service: "yandex" as const, partial: false }
          : list.kind === "yandexAlbum"
            ? { ...(await yandexAlbum(list.id)), service: "yandex" as const, partial: false }
            : list.kind === "youtubePlaylist"
              ? { ...(await youtubePlaylist(list.id)), service: "youtube" as const, partial: false }
              : list.kind === "youtubeAlbum"
                ? { ...(await youtubeList(list.id, true)), service: "youtube" as const, partial: false }
                : { ...(await spotifyList(list.kind === "spotifyPlaylist" ? "playlist" : "album", list.id)), service: "spotify" as const };
    if (!read.items.length) throw new ScError("not_found", m().importEmpty);
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
          : s.kind === "youtubeTrack"
            ? [{ title: "", artist: "", durationMs: null, ref: `youtube:${s.id}` }]
            : [],
  );
  const refs = items.filter((i) => i.ref);
  const from = (service: string) => refs.some((i) => i.ref!.startsWith(`${service}:`));
  const service: ImportService = from("spotify") ? "spotify" : from("youtube") ? "youtube" : refs.length ? "yandex" : "text";
  log("main", `import: read ${items.length} ${service === "text" ? "lines" : "tracks"}`);
  return { service, title: null, items, partial: false };
}

/** A track link's title, artist and length (the rest come filled in already). */
export async function resolveItem(item: ImportItem): Promise<ImportItem> {
  if (!item.ref) return item;
  const [service, id] = item.ref.split(":");
  // YouTube's ids have "-" and "_" too
  if (!id || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new ScError("unknown", "bad track link");
  if (service === "spotify") return spotifyTrack(id);
  if (service === "yandex") return yandexTrack(id);
  if (service === "youtube") return youtubeTrack(id);
  throw new ScError("unknown", "bad track link");
}
