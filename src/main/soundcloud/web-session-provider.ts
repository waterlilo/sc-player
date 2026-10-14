import type { MusicProvider, SearchKind } from "@shared/provider";
import type { Page, Playlist, PlaylistRelation, Resolved, StreamInfo, Track, User } from "@shared/types";
import { apiChanged, ScError } from "./errors";
import type { ScHttp } from "./http";
import { collection, mapPlaylist, mapTrack, mapUser, type RawCollection, type RawPlaylist, type RawTrack, type RawTranscoding, type RawUser } from "./mappers";
import { scSession } from "./session";
import { pickTranscoding } from "./stream";

const PAGE = 50;
const TRACK_META_LIMIT = 4000;
const LIST_TTL = 60_000;
const ITEM_TTL = 5 * 60_000;

type LibraryItem = { type?: string; playlist?: RawPlaylist; system_playlist?: RawPlaylist };
type LikeItem = { track?: RawTrack; playlist?: RawPlaylist };

/** Cursor for lists made of two api-v2 lists in a row (a user's own playlists, then the playlists they liked). */
interface TwoPhaseCursor {
  phase: "own" | "liked";
  href: string | null;
}

/**
 * MusicProvider over api-v2 — the internal API soundcloud.com itself uses — as the signed-in web session (token from
 * the login window), or without a session for public profiles. Unofficial: every request and every response shape
 * lives in this folder.
 */
export class WebSessionProvider implements MusicProvider {
  /** what's needed to ask for a stream later, by track id (raw tracks are big; only this is kept) */
  private streamMeta = new Map<number, { transcodings: RawTranscoding[]; auth: string }>();
  /** a playlist's track ids, and the tracks api-v2 already sent in full */
  private playlists = new Map<string, { at: number; ids: number[]; full: Map<number, Track> }>();
  private meId: number | null = null;

  constructor(
    private readonly http: ScHttp,
    private readonly signedIn: () => boolean,
  ) {}

  /** Session changed: forget everything that belonged to it. */
  reset() {
    this.meId = null;
    this.playlists.clear();
    this.http.clearCache();
  }

  // ---- tracks ---------------------------------------------------------------------------------------------------

  private track(raw: RawTrack | undefined): Track | null {
    const track = mapTrack(raw);
    if (track && raw?.media?.transcodings && raw.track_authorization) {
      if (this.streamMeta.size > TRACK_META_LIMIT) this.streamMeta.delete(this.streamMeta.keys().next().value!);
      this.streamMeta.set(track.id, { transcodings: raw.media.transcodings, auth: raw.track_authorization });
    }
    return track;
  }

  private tracks(raws: (RawTrack | undefined)[]): Track[] {
    return raws.map((r) => this.track(r)).filter((t): t is Track => t !== null);
  }

  /** Full tracks by id, in the given order (deleted or private ones are left out). api-v2 takes 50 ids at a time. */
  private async tracksById(ids: number[]): Promise<Track[]> {
    const found = new Map<number, Track>();
    for (let i = 0; i < ids.length; i += PAGE) {
      const chunk = ids.slice(i, i + PAGE);
      const res = await this.http.json<RawTrack[]>("/tracks", { ids: chunk.join(",") }, { ttl: ITEM_TTL });
      if (!Array.isArray(res)) apiChanged("/tracks?ids is not a list");
      for (const t of this.tracks(res)) found.set(t.id, t);
    }
    return ids.map((id) => found.get(id)).filter((t): t is Track => !!t);
  }

  // ---- me ---------------------------------------------------------------------------------------------------------

  async getMe(): Promise<User | null> {
    if (!this.signedIn()) return null;
    const me = mapUser(await this.http.json<RawUser>("/me", {}, { auth: "required", ttl: LIST_TTL }));
    this.meId = me.id;
    return me;
  }

  private async myId(): Promise<number> {
    if (this.meId === null) {
      const me = await this.getMe();
      if (!me) throw new ScError("unauthorized", "not signed in");
    }
    return this.meId!;
  }

  async getLikes(cursor?: string | null): Promise<Page<Track>> {
    return this.getUserLikes(await this.myId(), cursor);
  }

  async getPlaylists(cursor?: string | null): Promise<Page<Playlist>> {
    const id = await this.myId();
    if (cursor?.startsWith("{")) return this.getUserPlaylists(id, cursor);
    try {
      const res = await this.http.json<RawCollection<LibraryItem>>(cursor ?? "/me/library/all", cursor ? {} : { limit: PAGE, linked_partitioning: 1 }, { auth: "required", ttl: LIST_TTL });
      const items = collection(res, "library").flatMap((item) => {
        const raw = item.playlist ?? item.system_playlist;
        if (!raw) return [];
        const relation: PlaylistRelation = item.type?.includes("like") ? "liked" : "own";
        return [mapPlaylist(raw, relation)];
      });
      return { items, next: res.next_href ?? null };
    } catch (err) {
      // the library endpoint is the least stable one: fall back to "own playlists, then liked ones" on the first page
      if (!cursor && err instanceof ScError && (err.code === "api_changed" || err.code === "not_found")) return this.getUserPlaylists(id, null);
      throw err;
    }
  }

  // ---- playlists --------------------------------------------------------------------------------------------------

  private async loadPlaylist(id: string): Promise<{ playlist: Playlist; at: number; ids: number[]; full: Map<number, Track> }> {
    const system = id.startsWith("soundcloud:system-playlists:");
    if (!system && !/^\d+$/.test(id)) throw new ScError("not_found", `bad playlist id ${id}`);
    const raw = await this.http.json<RawPlaylist>(system ? `/system-playlists/${encodeURIComponent(id)}` : `/playlists/${id}`, system ? {} : { representation: "full" }, { ttl: LIST_TTL });
    const playlist = mapPlaylist(raw, null);
    const rawTracks = raw.tracks ?? [];
    const ids = rawTracks.map((t) => t.id).filter((n): n is number => typeof n === "number");
    const full = new Map(this.tracks(rawTracks).map((t) => [t.id, t]));
    const entry = { at: Date.now(), ids, full };
    this.playlists.set(id, entry);
    return { playlist, ...entry };
  }

  async getPlaylist(id: string): Promise<Playlist> {
    return (await this.loadPlaylist(id)).playlist;
  }

  /** A page of a playlist's tracks: api-v2 sends only the first few in full, the rest are fetched by id per page. */
  async getPlaylistTracks(id: string, cursor?: string | null): Promise<Page<Track>> {
    const offset = cursor ? Number(cursor) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw new ScError("unknown", "bad cursor");
    const cached = this.playlists.get(id);
    const entry = cached && !(offset === 0 && Date.now() - cached.at > LIST_TTL) ? cached : await this.loadPlaylist(id);
    const ids = entry.ids.slice(offset, offset + PAGE);
    const missing = ids.filter((t) => !entry.full.has(t));
    for (const t of await this.tracksById(missing)) entry.full.set(t.id, t);
    const items = ids.map((t) => entry.full.get(t)).filter((t): t is Track => !!t);
    return { items, next: offset + PAGE < entry.ids.length ? String(offset + PAGE) : null };
  }

  // ---- users ------------------------------------------------------------------------------------------------------

  async getUser(id: number): Promise<User> {
    return mapUser(await this.http.json<RawUser>(`/users/${id}`, {}, { ttl: ITEM_TTL }));
  }

  async getUserLikes(userId: number, cursor?: string | null): Promise<Page<Track>> {
    const res = await this.http.json<RawCollection<LikeItem>>(cursor ?? `/users/${userId}/track_likes`, cursor ? {} : { limit: PAGE, linked_partitioning: 1 }, { ttl: LIST_TTL });
    return { items: this.tracks(collection(res, "track likes").map((i) => i.track)), next: res.next_href ?? null };
  }

  /** A user's own playlists and albums, then the ones they liked. Pages without any playlist are skipped. */
  async getUserPlaylists(userId: number, cursor?: string | null): Promise<Page<Playlist>> {
    let state: TwoPhaseCursor = cursor ? (JSON.parse(cursor) as TwoPhaseCursor) : { phase: "own", href: null };
    for (let hops = 0; hops < 6; hops++) {
      if (state.phase === "own") {
        const res = await this.http.json<RawCollection<RawPlaylist>>(state.href ?? `/users/${userId}/playlists`, state.href ? {} : { limit: PAGE, linked_partitioning: 1 }, { ttl: LIST_TTL });
        const items = collection(res, "user playlists").map((p) => mapPlaylist(p, "own"));
        state = res.next_href ? { phase: "own", href: res.next_href } : { phase: "liked", href: null };
        if (items.length) return { items, next: JSON.stringify(state) };
      } else {
        const res = await this.http.json<RawCollection<LikeItem>>(state.href ?? `/users/${userId}/likes`, state.href ? {} : { limit: PAGE, linked_partitioning: 1 }, { ttl: LIST_TTL });
        const items = collection(res, "user likes").flatMap((i) => (i.playlist ? [mapPlaylist(i.playlist, "liked")] : []));
        const next = res.next_href ? JSON.stringify({ phase: "liked", href: res.next_href } satisfies TwoPhaseCursor) : null;
        if (items.length || !next) return { items, next };
        state = JSON.parse(next) as TwoPhaseCursor;
      }
    }
    return { items: [], next: JSON.stringify(state) };
  }

  async resolve(url: string): Promise<Resolved> {
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      throw new ScError("not_found", "not a link");
    }
    if (!/(^|\.)soundcloud\.com$/.test(parsed.hostname)) throw new ScError("not_found", "not a SoundCloud link");
    parsed.search = "";
    parsed.hash = "";
    const raw = await this.http.json<{ kind?: string } & RawUser & RawTrack & RawPlaylist>("/resolve", { url: parsed.href.replace(/\/$/, "") }, { ttl: ITEM_TTL });
    if (raw.kind === "user") return { kind: "user", user: mapUser(raw) };
    if (raw.kind === "track") {
      const track = this.track(raw);
      if (track) return { kind: "track", track };
    }
    if (raw.kind === "playlist" || raw.kind === "system-playlist") return { kind: "playlist", playlist: mapPlaylist(raw, null) };
    throw new ScError("not_found", `unsupported link (${raw.kind ?? "unknown"})`);
  }

  // ---- search -----------------------------------------------------------------------------------------------------

  async search(query: string, kind: SearchKind, cursor?: string | null): Promise<Page<Track> | Page<Playlist> | Page<User>> {
    const path = { tracks: "/search/tracks", playlists: "/search/playlists", users: "/search/users" }[kind];
    const res = await this.http.json<RawCollection<RawTrack & RawPlaylist & RawUser>>(cursor ?? path, cursor ? {} : { q: query, limit: 30, linked_partitioning: 1 }, { ttl: LIST_TTL });
    const list = collection(res, "search");
    const next = res.next_href ?? null;
    if (kind === "tracks") return { items: this.tracks(list), next };
    if (kind === "playlists") return { items: list.map((p) => mapPlaylist(p, null)), next };
    return { items: list.map((u) => mapUser(u)), next };
  }

  async searchSuggestions(query: string): Promise<string[]> {
    const res = await this.http.json<RawCollection<{ output?: string; query?: string }>>("/search/queries", { q: query, limit: 8 }, { ttl: LIST_TTL });
    return collection(res, "suggestions").map((s) => s.output ?? s.query ?? "").filter(Boolean);
  }

  // ---- playback ---------------------------------------------------------------------------------------------------

  private async freshMeta(trackId: number) {
    this.streamMeta.delete(trackId);
    const [raw] = await this.http.json<RawTrack[]>("/tracks", { ids: String(trackId) });
    const track = this.track(raw);
    const meta = this.streamMeta.get(trackId);
    if (!track || !meta) throw new ScError("unavailable", "track has no streams");
    return meta;
  }

  /** A signed, short-lived stream URL. Asked for right before playing; on a refusal the track is re-read once. */
  async getStreamUrl(trackId: number): Promise<StreamInfo> {
    let meta = this.streamMeta.get(trackId) ?? (await this.freshMeta(trackId));
    for (let attempt = 0; ; attempt++) {
      const t = pickTranscoding(meta.transcodings);
      if (!t) throw new ScError("unavailable", "no stream this player can decode (DRM)");
      try {
        const res = await this.http.json<{ url?: string }>(t.url, { track_authorization: meta.auth });
        if (typeof res?.url !== "string") apiChanged("stream without url");
        return { url: res.url, protocol: t.format?.protocol === "hls" ? "hls" : "progressive", mime: t.format?.mime_type ?? "", snipped: !!t.snipped };
      } catch (err) {
        // track_authorization expires; a fresh copy of the track carries a new one
        if (attempt === 0 && err instanceof ScError && ["unauthorized", "unavailable", "not_found"].includes(err.code)) {
          meta = await this.freshMeta(trackId);
          continue;
        }
        throw err;
      }
    }
  }

  /** Waveform peaks scaled to 0..1. Newer tracks have JSON; old ones point at a PNG with a JSON twin. */
  async getWaveform(url: string): Promise<number[]> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".sndcdn.com")) throw new ScError("not_found", "not a waveform URL");
    const candidates = parsed.pathname.endsWith(".png") ? [url.replace(/\.png(\?.*)?$/, ".json"), url] : [url];
    for (const candidate of candidates) {
      if (!candidate.endsWith(".json")) continue;
      try {
        const res = await scSession().fetch(candidate);
        if (!res.ok) continue;
        const data = (await res.json()) as { height?: number; samples?: number[] };
        if (!Array.isArray(data.samples) || !data.samples.length) continue;
        const max = data.height || Math.max(...data.samples) || 1;
        return data.samples.map((s) => Math.max(0, Math.min(1, s / max)));
      } catch {
        /* try the next candidate */
      }
    }
    throw new ScError("unavailable", "no waveform");
  }

  // ---- library changes --------------------------------------------------------------------------------------------

  async like(trackId: number): Promise<void> {
    await this.http.json(`/users/${await this.myId()}/track_likes/${trackId}`, {}, { method: "PUT", auth: "required" });
  }

  async unlike(trackId: number): Promise<void> {
    await this.http.json(`/users/${await this.myId()}/track_likes/${trackId}`, {}, { method: "DELETE", auth: "required" });
  }

  async addToPlaylist(playlistId: string, trackId: number): Promise<void> {
    const { ids } = await this.loadPlaylist(playlistId);
    if (ids.includes(trackId)) return;
    await this.http.json(`/playlists/${playlistId}`, {}, { method: "PUT", auth: "required", body: { playlist: { tracks: [...ids, trackId] } } });
    this.playlists.delete(playlistId);
  }
}
