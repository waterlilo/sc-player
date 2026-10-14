import type { Page, Playlist, Resolved, StreamInfo, Track, User } from "./types";

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
  getUserPlaylists(userId: number, cursor?: string | null): Promise<Page<Playlist>>;
  resolve(url: string): Promise<Resolved>;
  search(query: string, kind: SearchKind, cursor?: string | null): Promise<Page<Track> | Page<Playlist> | Page<User>>;
  searchSuggestions(query: string): Promise<string[]>;
  getStreamUrl(trackId: number): Promise<StreamInfo>;
  getWaveform(url: string): Promise<number[]>;
  like(trackId: number): Promise<void>;
  unlike(trackId: number): Promise<void>;
  addToPlaylist(playlistId: string, trackId: number): Promise<void>;
}
