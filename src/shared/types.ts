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

export type LyricsSource = "lrclib" | "betterlyrics" | "unison";

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
  /** the plain words were matched to the song on this computer (Settings → Lyrics → Auto-sync) */
  aligned?: boolean;
}

export type SyncedLine = NonNullable<Lyrics["synced"]>[number];

/** Plain words to match to a track's sound: the track that is streamed (a replacement upload, when there is one). */
export interface SyncRequest {
  trackId: number;
  source: LyricsSource;
  lyricsId: number;
  plain: string;
}

/** Auto-sync: the model on disk and whether a song is being worked out. */
export interface LyricsSyncStatus {
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
