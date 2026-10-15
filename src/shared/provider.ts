import type { Page, Playlist, QueueSource, Resolved, StreamInfo, Track, TrackDetails, User } from "./types";

export type SearchKind = "tracks" | "playlists" | "users";

export interface SearchResult {
  tracks: Page<Track>;
  playlists: Page<Playlist>;
  users: Page<User>;
}

/**
 * The data layer the UI talks to. Implementations: WebSessionProvider (the SoundCloud website's own api-v2 with the
 * signed-in web session, also used without a session for public profiles) and OfficialApiProvider (api.soundcloud.com
 * with the user's own app credentials). Cursors are opaque to callers.
 */
export interface MusicProvider {
  getMe(): Promise<User | null>;
  getLikes(cursor?: string | null): Promise<Page<Track>>;
  /** the signed-in user's playlists and albums: own and liked */
  getPlaylists(cursor?: string | null): Promise<Page<Playlist>>;
  getPlaylist(id: string): Promise<Playlist>;
  getPlaylistTracks(id: string, cursor?: string | null): Promise<Page<Track>>;
  getUser(id: number): Promise<User>;
  getUserLikes(userId: number, cursor?: string | null): Promise<Page<Track>>;
  /** tracks the user uploaded, newest first */
  getUserTracks(userId: number, cursor?: string | null): Promise<Page<Track>>;
  getUserPlaylists(userId: number, cursor?: string | null): Promise<Page<Playlist>>;
  resolve(url: string): Promise<Resolved>;
  /** full tracks by id, in the given order (unavailable ones left out); up to 200 ids */
  getTracks(ids: number[]): Promise<Track[]>;
  /** every track id of a list (a whole playlist, all likes, all uploads), for a true shuffle; capped at MAX_SOURCE_IDS */
  getSourceIds(source: QueueSource): Promise<number[]>;
  getTrackDetails(trackId: number): Promise<TrackDetails>;
  /** tracks similar to this one (the queue autopilot) */
  getRelated(trackId: number): Promise<Track[]>;
  search(query: string, kind: SearchKind, cursor?: string | null): Promise<Page<Track> | Page<Playlist> | Page<User>>;
  searchSuggestions(query: string): Promise<string[]>;
  getStreamUrl(trackId: number): Promise<StreamInfo>;
  getWaveform(url: string): Promise<number[]>;
  like(trackId: number): Promise<void>;
  unlike(trackId: number): Promise<void>;
  addToPlaylist(playlistId: string, trackId: number): Promise<void>;
}

export const MAX_SOURCE_IDS = 10_000;
