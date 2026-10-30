/** Data shapes shared by main and renderer. Providers map whatever their API returns into these. */

export interface UserRef {
  id: number;
  username: string;
  permalinkUrl: string;
}

export interface User extends UserRef {
  permalink: string;
  avatarUrl: string | null;
  city: string | null;
  followers: number | null;
  trackCount: number | null;
  likesCount: number | null;
  playlistCount: number | null;
  /** how many people this user follows */
  followingsCount: number | null;
}

/**
 * ok — full stream; preview — only a 30 s snippet (SoundCloud Go+ track);
 * blocked — not available in this region; drm — only encrypted streams, which this player can't decode.
 */
export type Playability = "ok" | "preview" | "blocked" | "drm";

export interface Track {
  id: number;
  title: string;
  artist: string;
  user: UserRef;
  durationMs: number;
  /** "-large" (100×100) SoundCloud artwork URL; see artwork() for other sizes */
  artworkUrl: string | null;
  waveformUrl: string | null;
  permalinkUrl: string;
  playability: Playability;
}

export type PlaylistRelation = "own" | "liked";

/**
 * Music from this computer (main/local-tracks) has ids from here up — far above SoundCloud's, still safe integers —
 * so lists take it like any track, and whatever goes to SoundCloud, friends or rooms can leave it out.
 */
export const LOCAL_TRACK_BASE = 9_000_000_000_000_000;
export const isLocalTrack = (id: number) => id >= LOCAL_TRACK_BASE;

export interface Playlist {
  /** numeric id as a string, or a system playlist URN ("soundcloud:system-playlists:…") */
  id: string;
  title: string;
  user: UserRef;
  artworkUrl: string | null;
  trackCount: number;
  durationMs: number;
  permalinkUrl: string;
  isAlbum: boolean;
  relation: PlaylistRelation | null;
  /** release date (albums) or creation date, ISO */
  releaseDate: string | null;
  genre: string | null;
}

/** Everything the track page shows beyond the list row. */
export interface TrackDetails {
  track: Track;
  plays: number | null;
  likes: number | null;
  reposts: number | null;
  comments: number | null;
  genre: string | null;
  createdAt: string | null;
  releaseDate: string | null;
  label: string | null;
  description: string | null;
  tags: string[];
}

export interface Page<T> {
  items: T[];
  /** opaque cursor for the next page, null when this was the last one */
  next: string | null;
}

export interface StreamInfo {
  url: string;
  protocol: "hls" | "progressive";
  mime: string;
  /** true when only a preview snippet is available */
  snipped: boolean;
}

export type Resolved = { kind: "user"; user: User } | { kind: "track"; track: Track } | { kind: "playlist"; playlist: Playlist };

/** verify: SoundCloud's bot protection (DataDome) wants the person checked before an action (like, add to playlist) */
export type ErrorCode = "offline" | "unauthorized" | "rate_limited" | "api_changed" | "not_found" | "unavailable" | "verify" | "unknown";

export interface AppErrorInfo {
  code: ErrorCode;
  message: string;
}

/** Where a queue came from, so the player can load the next page when it reaches the end. */
export type QueueSource =
  | { kind: "likes"; userId: number | "me"; cursor: string | null }
  | { kind: "userTracks"; userId: number; cursor: string | null }
  | { kind: "playlist"; playlistId: string; cursor: string | null }
  | { kind: "search"; query: string; cursor: string | null }
  | { kind: "feed"; cursor: string | null }
  | { kind: "static" };

export interface SavedProfile {
  id: number;
  username: string;
  permalinkUrl: string;
  avatarUrl: string | null;
}

/** SoundCloud artwork in another size: t500x500, t300x300, large (100), t67x67, small (32). */
export function artwork(url: string | null, size: "t500x500" | "t300x300" | "large" | "t67x67"): string | null {
  if (!url) return null;
  return url.replace(/-(large|t\d+x\d+|crop|original|small|badge|tiny|mini)\.(jpg|png|webp)/, `-${size}.$2`);
}

/** Words of a song from LRCLIB: time-synced lines when there are some, otherwise plain text. */
/** One sung word (or syllable) with its own timing, seconds; the text keeps its trailing space when one follows. */
export interface LyricWord {
  t: number;
  end: number;
  text: string;
  /** a background vocal (an echo, an ad-lib) */
  bg?: boolean;
}

/**
 * "own": words the user typed or pasted for this track (kept on this computer); "community": someone's timed words,
 * approved by the moderator on sc player's server
 */
export type LyricsSource = "lrclib" | "betterlyrics" | "unison" | "own" | "community";

/** A Wallpaper Engine wallpaper from the Steam Workshop, looked for on this computer (main/system/steam-wallpaper). */
export type SteamWallpaper =
  | { found: true; id: string; title: string; sizeMb: number; /** scbg://import/… for the page to read it */ url: string }
  | { found: false; id: string; reason: "link" | "missing" | "not-video" };

/** The backup of what lives only on this computer (main/backup): its transfer key, when it last went out. */
export interface BackupStatus {
  /** this build knows a server */
  available: boolean;
  /** made on the first backup; shown in Settings to type in on another computer */
  key: string | null;
  /** the last upload this run (null: none yet) */
  at: number | null;
  error: string | null;
}

/** What a restore added. `code`: the friend code — none in the copy, the same as here, taken, or a different one here (asked first). */
export interface RestoreResult {
  likes: number;
  playlists: number;
  lyrics: number;
  code: "none" | "same" | "restored" | "differs";
}

/** What became of my lyrics sent for review ("" — none sent). */
export type LyricsSuggestionState = "" | "pending" | "approved" | "rejected" | "replaced";

/** Lyrics someone sent, waiting for the moderator. */
export interface LyricsForReview {
  id: number;
  /** SoundCloud track id */
  track: number;
  title: string;
  artist: string;
  durationMs: number;
  created: number;
  /** the sender's name in the messenger, and code */
  by: string;
  byCode: string;
  /** the track has approved lyrics already: these would take their place */
  replaces: boolean;
  lyrics: Lyrics;
}

export interface Lyrics {
  /** the record's id at its source (LRCLIB's for picks by hand; 0 when the source has none) */
  id: number;
  artist: string;
  title: string;
  /** lines with their start time in seconds, in order; with words when the source times each word */
  synced: { t: number; text: string; words?: LyricWord[] }[] | null;
  plain: string | null;
  instrumental: boolean;
  /** where the words came from (shown with them); LRCLIB when missing (older answers) */
  source?: LyricsSource;
  /** "community": the name of who made them */
  by?: string;
  /** the plain words were matched to the song on this computer (Settings → Lyrics → Auto-sync) */
  aligned?: boolean;
  /** the source's times were made for another upload: moved (and stretched, `scale` ≠ 1) to fit this one (Auto-sync) */
  fitted?: { scale: number; shift: number };
}

export type SyncedLine = NonNullable<Lyrics["synced"]>[number];

/** Plain words to match to a track's sound: the track that is streamed (a replacement upload, when there is one). */
export interface SyncRequest {
  trackId: number;
  source: LyricsSource;
  lyricsId: number;
  /** the words, one line per line */
  plain: string;
  /** the source's own line times, when it has them: only checked against the sound (one per line of `plain`) */
  times?: number[];
}

/** Plain words placed in the song, or how a source's synced lines fit this upload: `scale × time + shift`. */
export type SyncResult = { lines: SyncedLine[] } | { scale: number; shift: number };

/** Auto-sync: the model on disk and whether a song is being worked out. */
export interface LyricsSyncStatus {
  /** which model the settings ask for (base; small in the accurate mode) and whether it is on disk */
  name: "base" | "small";
  model: "missing" | "downloading" | "ready" | "error";
  /** of the download, 0..1 */
  progress: number;
  error: string;
  sizeMb: number;
  busy: boolean;
}

/** A search result when looking for the words by hand. */
export interface LyricsHit {
  id: number;
  artist: string;
  title: string;
  album: string;
  durationMs: number;
  synced: boolean;
}
