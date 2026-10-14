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

export type ErrorCode = "offline" | "unauthorized" | "rate_limited" | "api_changed" | "not_found" | "unavailable" | "unknown";

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
