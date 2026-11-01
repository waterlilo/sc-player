/**
 * What a pasted text asks to import: links to Yandex Music and Spotify playlists, albums and tracks, or lines of
 * "Artist — Title". Pure functions (no imports) so they can be tested on their own (npm test).
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
  | { kind: "line"; artist: string; title: string; durationMs: number | null };

const YANDEX = /^https?:\/\/(?:www\.)?music\.yandex\.(?:ru|com|by|kz|uz|ua)(\/[^\s?#]*)/i;
const SPOTIFY = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(playlist|album|track)\/([A-Za-z0-9]{22})/i;
const SPOTIFY_URI = /^spotify:(playlist|album|track):([A-Za-z0-9]{22})$/i;
const SPOTIFY_SHORT = /^https?:\/\/spotify\.link\/[A-Za-z0-9]+$/i;

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
