import type { Playability, Playlist, PlaylistRelation, Track, User, UserRef } from "@shared/types";
import { apiChanged } from "./errors";

/**
 * api-v2 response shapes (only the fields we read; everything optional unless the app can't work without it) and
 * their mapping to the shared types. If SoundCloud renames something essential, mapping throws api_changed and the UI
 * shows "SoundCloud changed something" with a retry button instead of crashing.
 */

export interface RawUser {
  id: number;
  username?: string;
  permalink?: string;
  permalink_url?: string;
  avatar_url?: string | null;
  city?: string | null;
  followers_count?: number;
  track_count?: number;
  likes_count?: number;
  playlist_count?: number;
}

export interface RawTranscoding {
  url: string;
  preset?: string;
  snipped?: boolean;
  quality?: string;
  format?: { protocol?: string; mime_type?: string };
}

export interface RawTrack {
  id: number;
  kind?: string;
  title?: string;
  user?: RawUser;
  duration?: number;
  full_duration?: number;
  artwork_url?: string | null;
  waveform_url?: string | null;
  permalink_url?: string;
  policy?: string;
  media?: { transcodings?: RawTranscoding[] };
  track_authorization?: string;
  publisher_metadata?: { artist?: string | null } | null;
}

export interface RawPlaylist {
  id: number | string;
  urn?: string;
  kind?: string;
  title?: string;
  user?: RawUser;
  artwork_url?: string | null;
  calculated_artwork_url?: string | null;
  track_count?: number;
  duration?: number;
  permalink_url?: string;
  is_album?: boolean;
  set_type?: string;
  tracks?: RawTrack[];
}

export interface RawCollection<T> {
  collection?: T[];
  next_href?: string | null;
}

export function collection<T>(res: RawCollection<T> | undefined, what: string): T[] {
  if (!res || !Array.isArray(res.collection)) apiChanged(`${what}: no collection`);
  return res.collection;
}

export function mapUserRef(raw: RawUser | undefined): UserRef {
  if (!raw || typeof raw.id !== "number") apiChanged("user without id");
  return { id: raw.id, username: raw.username ?? "unknown", permalinkUrl: raw.permalink_url ?? `https://soundcloud.com/${raw.permalink ?? ""}` };
}

export function mapUser(raw: RawUser | undefined): User {
  const ref = mapUserRef(raw);
  return {
    ...ref,
    permalink: raw!.permalink ?? "",
    avatarUrl: raw!.avatar_url ?? null,
    city: raw!.city ?? null,
    followers: raw!.followers_count ?? null,
    trackCount: raw!.track_count ?? null,
    likesCount: raw!.likes_count ?? null,
    playlistCount: raw!.playlist_count ?? null,
  };
}

/** HLS (AAC / MP3) and progressive MP3 play in Chromium; encrypted HLS (DRM) and HLS Opus (Ogg segments) don't. */
export function isPlayable(t: RawTranscoding) {
  const protocol = t.format?.protocol ?? "";
  const mime = t.format?.mime_type ?? "";
  return (protocol === "hls" || protocol === "progressive") && !mime.includes("ogg");
}

function playability(raw: RawTrack): Playability {
  if (raw.policy === "BLOCK") return "blocked";
  const all = raw.media?.transcodings ?? [];
  const usable = all.filter(isPlayable);
  // SKY_DEBUG_STREAMS=1 prints what SoundCloud offers for each track (to see what changed when tracks stop playing)
  if (process.env.SKY_DEBUG_STREAMS) console.log("[streams]", raw.id, raw.policy, JSON.stringify(all.map((t) => [t.format?.protocol, t.format?.mime_type, t.preset, t.quality, t.snipped])));
  if (!usable.length) return all.length ? "drm" : "blocked";
  if (raw.policy === "SNIP" || usable.every((t) => t.snipped)) return "preview";
  return "ok";
}

/** Playlists list some tracks as stubs (only an id); those come back as null and are fetched by id later. */
export function mapTrack(raw: RawTrack | undefined): Track | null {
  if (!raw || typeof raw.id !== "number") apiChanged("track without id");
  if (typeof raw.title !== "string" || !raw.user) return null;
  const user = mapUserRef(raw.user);
  return {
    id: raw.id,
    title: raw.title,
    artist: raw.publisher_metadata?.artist?.trim() || user.username,
    user,
    durationMs: raw.full_duration ?? raw.duration ?? 0,
    artworkUrl: raw.artwork_url ?? raw.user.avatar_url ?? null,
    waveformUrl: raw.waveform_url ?? null,
    permalinkUrl: raw.permalink_url ?? "",
    playability: playability(raw),
  };
}

export function mapPlaylist(raw: RawPlaylist | undefined, relation: PlaylistRelation | null): Playlist {
  if (!raw || (typeof raw.id !== "number" && typeof raw.id !== "string")) apiChanged("playlist without id");
  const system = raw.kind === "system-playlist";
  return {
    id: system ? (raw.urn ?? String(raw.id)) : String(raw.id),
    title: raw.title ?? "",
    user: raw.user ? mapUserRef(raw.user) : { id: 0, username: "SoundCloud", permalinkUrl: "https://soundcloud.com" },
    artworkUrl: raw.artwork_url ?? raw.calculated_artwork_url ?? raw.tracks?.find((t) => t.artwork_url)?.artwork_url ?? null,
    trackCount: raw.track_count ?? raw.tracks?.length ?? 0,
    durationMs: raw.duration ?? 0,
    permalinkUrl: raw.permalink_url ?? "",
    isAlbum: raw.is_album ?? raw.set_type === "album",
    relation,
  };
}
