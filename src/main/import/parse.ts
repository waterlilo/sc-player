/**
 * What a pasted text asks to import: links to Yandex Music, Spotify and YouTube (Music) playlists, albums and tracks,
 * or lines of "Artist — Title". Pure functions (no imports) so they can be tested on their own (npm test).
 */

export type Source =
  | { kind: "yandexPlaylist"; owner: string; id: string }
  | { kind: "yandexShared"; uuid: string }
  | { kind: "yandexAlbum"; id: string }
  | { kind: "yandexTrack"; id: string }
  | { kind: "spotifyPlaylist"; id: string }
  | { kind: "spotifyAlbum"; id: string }
  | { kind: "spotifyTrack"; id: string }
  /** spotify.link/… — Spotify's short link, read by following it */
  | { kind: "spotifyShort"; url: string }
  /** a playlist's id ("PL…", an album's "OLAK5uy_…"; "LM" — someone's likes, which open to no one else) */
  | { kind: "youtubePlaylist"; id: string }
  /** an album page of YouTube Music ("MPREb_…") */
  | { kind: "youtubeAlbum"; id: string }
  /** a video's id (11 characters) */
  | { kind: "youtubeTrack"; id: string }
  | { kind: "line"; artist: string; title: string; durationMs: number | null };

const YANDEX = /^https?:\/\/(?:www\.)?music\.yandex\.(?:ru|com|by|kz|uz|ua)(\/[^\s?#]*)/i;
const SPOTIFY = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(playlist|album|track)\/([A-Za-z0-9]{22})/i;
const SPOTIFY_URI = /^spotify:(playlist|album|track):([A-Za-z0-9]{22})$/i;
const SPOTIFY_SHORT = /^https?:\/\/spotify\.link\/[A-Za-z0-9]+$/i;
const YOUTUBE = /^https?:\/\/(?:(?:www|m|music)\.)?(?:youtube\.com|youtu\.be)\//i;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{2,64}$/;

/**
 * A YouTube or YouTube Music link: a playlist (also as `watch?v=…&list=…`, playing from it), an album page, or one
 * video (`watch?v=`, `youtu.be/`). A mix ("RD…", made up by YouTube as it plays) is not a playlist: its video is
 * (YouTube Music's own playlists are "RDCLAK5uy_…", real ones).
 */
function youtubeSource(word: string): Source | null {
  let url: URL;
  try {
    url = new URL(word);
  } catch {
    return null;
  }
  const list = url.searchParams.get("list");
  const video = url.hostname.endsWith("youtu.be") ? url.pathname.slice(1).split("/")[0]! : url.pathname === "/watch" ? (url.searchParams.get("v") ?? "") : (url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1] ?? "");
  const album = url.pathname.match(/^\/browse\/(MPREb_[A-Za-z0-9_-]+)/)?.[1];
  if (album) return { kind: "youtubeAlbum", id: album };
  if (list && LIST_ID.test(list) && (!/^RD/.test(list) || list.startsWith("RDCLAK5uy_"))) return { kind: "youtubePlaylist", id: list };
  if (VIDEO_ID.test(video)) return { kind: "youtubeTrack", id: video };
  return null;
}

function yandexSource(path: string): Source | null {
  let m: RegExpMatchArray | null;
  // the login may be written with %40 for "@" and the like
  const login = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  if ((m = path.match(/^\/users\/([^/]+)\/playlists\/(\d+)/))) return { kind: "yandexPlaylist", owner: login(m[1]!), id: m[2]! };
  // a profile's "Мне нравится" page: its playlist number 3
  if ((m = path.match(/^\/users\/([^/]+)\/tracks\/?$/))) return { kind: "yandexPlaylist", owner: login(m[1]!), id: "3" };
  // the new share links: "lk." — someone's likes, "ar." — Yandex's own playlists
  if ((m = path.match(/^\/playlists\/((?:lk\.|ar\.)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i))) return { kind: "yandexShared", uuid: m[1]!.toLowerCase() };
  if ((m = path.match(/^\/album\/\d+\/track\/(\d+)/))) return { kind: "yandexTrack", id: m[1]! };
  if ((m = path.match(/^\/track\/(\d+)/))) return { kind: "yandexTrack", id: m[1]! };
  if ((m = path.match(/^\/album\/(\d+)/))) return { kind: "yandexAlbum", id: m[1]! };
  return null;
}

function linkSource(word: string): Source | null {
  let m: RegExpMatchArray | null;
  if ((m = word.match(YANDEX))) return yandexSource(m[1]!);
  if ((m = word.match(SPOTIFY) ?? word.match(SPOTIFY_URI))) {
    const type = m[1]!.toLowerCase();
    return { kind: type === "playlist" ? "spotifyPlaylist" : type === "album" ? "spotifyAlbum" : "spotifyTrack", id: m[2]! };
  }
  if (SPOTIFY_SHORT.test(word)) return { kind: "spotifyShort", url: word };
  if (YOUTUBE.test(word)) return youtubeSource(word);
  return null;
}

/**
 * A line of text as a track: "Artist — Title" (or "Artist - Title"), maybe numbered ("12. ") and with its length at
 * the end ("3:45"). A line with no dash is a title alone. Null for an empty line.
 */
export function lineSource(raw: string): Source | null {
  let line = raw.replace(/\s+/g, " ").trim();
  // "1. ", "01) ", "12 - " numbering
  line = line.replace(/^\d{1,4}\s*[.)]\s+/, "").replace(/^\d{1,4}\s+[-–—]\s+/, "");
  let durationMs: number | null = null;
  const len = line.match(/\s+\(?(\d{1,2}):([0-5]\d)\)?$/);
  if (len) {
    durationMs = (Number(len[1]) * 60 + Number(len[2])) * 1000;
    line = line.slice(0, len.index).trim();
  }
  // the dash that separates is the first one with spaces around it; a lone "—" or "–" counts too
  const sep = line.match(/\s+[-–—]\s+/) ?? line.match(/[–—]/);
  let artist = "";
  let title = line;
  if (sep && sep.index !== undefined && sep.index > 0) {
    artist = line.slice(0, sep.index).trim();
    title = line.slice(sep.index + sep[0].length).trim();
  }
  title = title.replace(/^["«“]|["»”]$/g, "").trim();
  if (!title) return null;
  return { kind: "line", artist, title, durationMs };
}

/** Every link and line of the text, in order (a line holding links counts only for them). At most `limit`. */
export function parseInput(text: string, limit = 1000): Source[] {
  const out: Source[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (out.length >= limit) break;
    const words = line.trim().split(/\s+/).filter(Boolean);
    const links = words.map(linkSource).filter((s): s is Source => !!s);
    if (links.length) out.push(...links);
    else if (!words.some((w) => /^https?:\/\//i.test(w))) {
      const s = lineSource(line);
      if (s) out.push(s);
    }
  }
  return out.slice(0, limit);
}

/** A version that changes the song (a remix, a live take, an edit for a film) stays part of its name; a remaster doesn't. */
const SAME_SONG = /remaster|^(radio|single|album|clean|explicit|original|mono|stereo)( (edit|version|mix))?$|^(from|из) |саундтрек|soundtrack|^\d{4}( version)?$/i;
const OTHER_VERSION = /\b(remix|rmx|mix|live|acoustic|instrumental|slowed|sped up|speed up|nightcore|bootleg|flip|cover|demo|unplugged|orchestral|piano|edit|extended|version)\b|ремикс|кавер|акустик/i;

const keepVersion = (v: string) => !SAME_SONG.test(v.trim()) && OTHER_VERSION.test(v);

/** Yandex keeps a track's version apart ("Remix", "Remastered 2011"): the name with it when it changes the song. */
export function withVersion(title: string, version: string | null | undefined): string {
  const v = version?.trim();
  return v && keepVersion(v) ? `${title} (${v})` : title;
}

/** Spotify writes the version after " - " ("Dreams - 2004 Remaster", "Song - Radio Edit"): the same rule. */
export function spotifyTitle(title: string): string {
  const at = title.indexOf(" - ");
  if (at <= 0) return title;
  const v = title.slice(at + 3).trim();
  return keepVersion(v) ? `${title.slice(0, at)} (${v})` : title.slice(0, at);
}

/** what a video's name says about the video, not the song: "(Official Music Video)", "[Lyrics]", "(HD)", "(Клип)" */
const VIDEO_WORDS =
  /^(?:official\s+)?(?:(?:hd|hq|4k)\s+)?(?:music\s+|lyrics?\s+|hd\s+)?(?:video|audio|visuali[sz]er|clip|lyrics?)(?:\s+(?:hd|hq|4k))?$|^(?:hd|hq|4k|mv|m\/v|official|lyrics?|audio only)$|^(?:премьера|клип|официальный клип|official video премьера).*$/i;
const DASH = /\s+[-–—]\s+/;
/** "Artist - Topic", "ArtistVEVO", "Artist Official": a channel's name as the artist's */
const channelArtist = (name: string) => name.replace(/\s*-\s*Topic$/i, "").replace(/VEVO$/, "").replace(/\s+official(?:\s+channel)?$/i, "").trim();
const same = (a: string, b: string) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * A YouTube (Music) track as a title and an artist to look for. A song of YouTube Music comes clean; a video's name
 * loses what it says about the video, "Artist - Song" gives the artist when the uploader is just a channel
 * (`uploaded`) or names the same artist, and any other " - Part" is a version (kept when it changes the song).
 */
export function youtubeTitle(name: string, artist: string, uploaded: boolean): { title: string; artist: string } {
  let title = name
    // "(Official Video, 2022)" too
    .replace(/\s*[([【]([^)\]】]*)[)\]】]/g, (all, inside: string) => (VIDEO_WORDS.test(inside.replace(/[,\s]*(?:19|20)\d{2}$/, "").trim()) ? "" : all))
    .replace(/\s+[|｜].*$/, "")
    .replace(/\s+(?:official\s+(?:music\s+)?video|official\s+audio|lyric\s+video)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  let who = channelArtist(artist);
  const sep = title.match(DASH);
  if (sep?.index) {
    const left = title.slice(0, sep.index).trim();
    const right = title.slice(sep.index + sep[0].length).trim();
    if (uploaded || !who || same(left, who) || same(left, artist)) {
      who = left;
      title = right;
    } else title = spotifyTitle(`${left} - ${right}`);
  }
  title = title.replace(/^["«“]|["»”]$/g, "").trim() || name.trim();
  return { title, artist: who };
}
