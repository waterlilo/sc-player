import { MAX_SOURCE_IDS, type MusicProvider, type SearchKind } from "@shared/provider";
import type { Page, Playlist, PlaylistRelation, QueueSource, Resolved, StreamInfo, Track, TrackDetails, User } from "@shared/types";
import { apiChanged, ScError } from "./errors";
import type { ScHttp } from "./http";
import { collection, mapPlaylist, mapTrack, mapTrackDetails, mapUser, type RawCollection, type RawPlaylist, type RawTrack, type RawTranscoding, type RawUser } from "./mappers";
import { scSession } from "./session";
import { prefs } from "../store";
import { pickTranscoding } from "./stream";
import { cachedAlternatives, rememberAlternatives } from "./alternatives";
import { consensusMatches, rankBySound, rankCandidates, searchQueries, shortlist, waveSimilarity, type Candidate, type Heard, type MatchInput } from "./match";

const PAGE = 50;
const TRACK_META_LIMIT = 4000;
const LIST_TTL = 60_000;
const ITEM_TTL = 5 * 60_000;
const KNOWN_LIMIT = 20_000;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

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
  /** every track seen recently, so a shuffled queue fills itself without asking SoundCloud again */
  private known = new Map<number, Track>();

  constructor(
    private readonly http: ScHttp,
    private readonly signedIn: () => boolean,
  ) {}

  /** Session changed: forget everything that belonged to it. */
  reset() {
    this.meId = null;
    this.liked = null;
    this.playlists.clear();
    this.http.clearCache();
  }

  // ---- tracks ---------------------------------------------------------------------------------------------------

  private track(raw: RawTrack | undefined): Track | null {
    const track = mapTrack(raw);
    if (track) {
      this.known.delete(track.id);
      this.known.set(track.id, track);
      if (this.known.size > KNOWN_LIMIT) this.known.delete(this.known.keys().next().value!);
    }
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
    for (const id of ids) {
      const t = this.known.get(id);
      if (t) found.set(id, t);
    }
    const missing = ids.filter((id) => !found.has(id));
    for (let i = 0; i < missing.length; i += PAGE) {
      const chunk = missing.slice(i, i + PAGE);
      const res = await this.http.json<RawTrack[]>("/tracks", { ids: chunk.join(",") }, { ttl: ITEM_TTL });
      if (!Array.isArray(res)) apiChanged("/tracks?ids is not a list");
      for (const t of this.tracks(res)) found.set(t.id, t);
    }
    return ids.map((id) => found.get(id)).filter((t): t is Track => !!t);
  }

  async getTracks(ids: number[]): Promise<Track[]> {
    return this.tracksById(ids.filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 200));
  }

  /** Every track id of a paged list, 200 per request (the tracks themselves are kept in `known`). */
  private async collectIds(path: string, pick: (item: LikeItem & RawTrack) => RawTrack | undefined): Promise<number[]> {
    const ids: number[] = [];
    let href: string | null = path;
    let first = true;
    while (href && ids.length < MAX_SOURCE_IDS) {
      const res: RawCollection<LikeItem & RawTrack> = await this.http.json<RawCollection<LikeItem & RawTrack>>(href, first ? { limit: 200, linked_partitioning: 1 } : {}, { ttl: LIST_TTL });
      first = false;
      for (const item of collection(res, "ids")) {
        const t = this.track(pick(item));
        if (t) ids.push(t.id);
      }
      href = res.next_href ?? null;
    }
    return ids;
  }

  async getSourceIds(source: QueueSource): Promise<number[]> {
    switch (source.kind) {
      case "playlist":
        return (await this.loadPlaylist(source.playlistId)).ids.slice(0, MAX_SOURCE_IDS);
      case "likes":
        return this.collectIds(`/users/${source.userId === "me" ? await this.myId() : source.userId}/track_likes`, (i) => i.track);
      case "userTracks":
        return this.collectIds(`/users/${source.userId}/tracks`, (i) => i);
      case "search": {
        const page = (await this.search(source.query, "tracks", null)) as Page<Track>;
        return page.items.map((t) => t.id);
      }
      default:
        return [];
    }
  }

  async getTrackDetails(trackId: number): Promise<TrackDetails> {
    const raw = await this.http.json<RawTrack>(`/tracks/${trackId}`, {}, { ttl: ITEM_TTL });
    const track = this.track(raw);
    if (!track) throw new ScError("not_found", "track not found");
    return mapTrackDetails(raw, track);
  }

  /**
   * Other uploads of the same recording that play in full (not DRM, not a preview), best first: searched by
   * "artist title" and by title, kept only if the length matches and no version words (slowed, remix…) were added.
   */
  async getAlternatives(trackId: number, deep = false): Promise<Track[]> {
    const tolerance = prefs().substituteTolerance;
    const remembered = deep ? null : cachedAlternatives(trackId, tolerance);
    if (remembered) return (await this.tracksById(remembered)).filter((t) => t.playability === "ok");
    const raw = await this.http.json<RawTrack>(`/tracks/${trackId}`, {}, { ttl: ITEM_TTL });
    if (!raw.title || !raw.user) return [];
    const original: MatchInput = {
      title: raw.title,
      artist: raw.publisher_metadata?.artist?.trim() || raw.user.username || "",
      uploader: raw.user.username ?? "",
      durationMs: raw.full_duration ?? raw.duration ?? 0,
    };
    // the original's loudness curve: with it the sound decides which upload is the same recording
    const originalWave = raw.waveform_url ? await this.getWaveform(raw.waveform_url).catch(() => null) : null;
    const seen = new Map<number, Candidate>();
    const waves = new Map<number, string>();
    // uploads already compared by sound (a waveform is fetched once per upload)
    const compared = new Map<number, Heard | null>();
    const rank = async (): Promise<Candidate[]> => {
      if (!originalWave) return rankCandidates(original, [...seen.values()], tolerance);
      // the closest-worded uploads, compared by sound
      const fresh = shortlist(original, [...seen.values()], tolerance, deep ? 24 : 16).filter((c) => !compared.has(c.id));
      await Promise.all(
        fresh.map(async (c) => {
          const url = waves.get(c.id);
          const wave = url ? await this.getWaveform(url).catch(() => null) : null;
          compared.set(c.id, wave ? { c, wave, fit: waveSimilarity(originalWave, original.durationMs, wave, c.durationMs) } : null);
        }),
      );
      const heard = [...compared.values()].filter((x): x is Heard => !!x);
      const bySound = rankBySound(original, heard, tolerance);
      // nothing like the original's curve: the same file uploaded by several people
      return bySound.length ? bySound : consensusMatches(original, heard, tolerance);
    };
    let ranked: Candidate[] = [];
    // fans' re-uploads often rank below the original, its remixes and covers: up to two pages of each query, until
    // three uploads are confirmed (a deep search, when the user wants another upload: five pages, no early stop)
    search: for (const q of searchQueries(original)) {
      let href: string | null = "/search/tracks";
      for (let page = 0; page < (deep ? 5 : 2) && href; page++) {
        const res: RawCollection<RawTrack> = await this.http.json<RawCollection<RawTrack>>(href, page ? {} : { q, limit: 50, linked_partitioning: 1 }, { ttl: LIST_TTL });
        for (const r of collection(res, "alternatives")) {
          const t = this.track(r);
          if (!t || t.id === trackId || t.playability !== "ok" || seen.has(t.id)) continue;
          seen.set(t.id, { id: t.id, title: t.title, artist: r.publisher_metadata?.artist ?? "", uploader: t.user.username, durationMs: t.durationMs, plays: r.playback_count ?? 0 });
          if (t.waveformUrl) waves.set(t.id, t.waveformUrl);
        }
        href = res.next_href ?? null;
        if (deep) continue;
        ranked = await rank();
        if (ranked.length >= 3) break search;
      }
    }
    if (deep || ranked.length < 3) ranked = await rank();
    const ids = ranked.slice(0, deep ? 10 : 5).map((c) => c.id);
    rememberAlternatives(trackId, tolerance, ids);
    return this.tracksById(ids);
  }

  async getRelated(trackId: number): Promise<Track[]> {
    const res = await this.http.json<RawCollection<RawTrack>>(`/tracks/${trackId}/related`, { limit: 20 }, { ttl: LIST_TTL });
    return this.tracks(collection(res, "related"));
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

  async getFeed(cursor?: string | null): Promise<Page<Track>> {
    const res = await this.http.json<RawCollection<{ type?: string; track?: RawTrack }>>(cursor ?? "/stream", cursor ? {} : { limit: PAGE, linked_partitioning: 1 }, { auth: "required", ttl: LIST_TTL });
    // tracks and track reposts; a track reposted by several people shows once per page
    const seen = new Set<number>();
    const raws = collection(res, "stream")
      .filter((i) => (i.type === "track" || i.type === "track-repost") && i.track && !seen.has(i.track.id) && seen.add(i.track.id))
      .map((i) => i.track);
    return { items: this.tracks(raws), next: res.next_href ?? null };
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

  async getUserTracks(userId: number, cursor?: string | null): Promise<Page<Track>> {
    const res = await this.http.json<RawCollection<RawTrack>>(cursor ?? `/users/${userId}/tracks`, cursor ? {} : { limit: PAGE, linked_partitioning: 1 }, { ttl: LIST_TTL });
    return { items: this.tracks(collection(res, "user tracks")), next: res.next_href ?? null };
  }

  async getFollowings(userId: number | "me", cursor?: string | null): Promise<Page<User>> {
    const id = userId === "me" ? await this.myId() : userId;
    const res = await this.http.json<RawCollection<RawUser>>(cursor ?? `/users/${id}/followings`, cursor ? {} : { limit: PAGE, linked_partitioning: 1 }, { ttl: LIST_TTL });
    return { items: collection(res, "followings").map(mapUser), next: res.next_href ?? null };
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
      const t = pickTranscoding(meta.transcodings, prefs().streamQuality);
      if (!t) throw new ScError("unavailable", "no stream this player can decode (DRM)");
      try {
        const res = await this.http.json<{ url?: string }>(t.url, { track_authorization: meta.auth });
        if (typeof res?.url !== "string") apiChanged("stream without url");
        // a 30 s preview is served from its own host even when the track's list entry promised the full stream
        const preview = /preview/i.test(hostOf(res.url));
        return { url: res.url, protocol: t.format?.protocol === "hls" ? "hls" : "progressive", mime: t.format?.mime_type ?? "", snipped: !!t.snipped || preview };
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

  /** what the user liked, read once per session and kept up to date by like / unlike */
  private liked: Set<number> | null = null;

  async getLikedIds(refresh = false): Promise<number[]> {
    if (refresh) {
      this.liked = null;
      this.http.clearCache();
    }
    this.liked ??= new Set(await this.getSourceIds({ kind: "likes", userId: "me", cursor: null }));
    return [...this.liked];
  }

  async getMyPlaylists(): Promise<Playlist[]> {
    const mine: Playlist[] = [];
    let cursor: string | null = null;
    // the library lists own playlists and liked ones together; a few pages are plenty
    for (let page = 0; page < 4; page++) {
      const res: Page<Playlist> = await this.getPlaylists(cursor);
      mine.push(...res.items.filter((p) => p.relation === "own" && !p.id.startsWith("soundcloud:")));
      cursor = res.next;
      if (!cursor) break;
    }
    return mine;
  }

  async like(trackId: number): Promise<void> {
    await this.http.json(`/users/${await this.myId()}/track_likes/${trackId}`, {}, { method: "PUT", auth: "required" });
    this.liked?.add(trackId);
    // the likes list was cached for a minute: show the new like right away
    this.http.clearCache();
  }

  async unlike(trackId: number): Promise<void> {
    await this.http.json(`/users/${await this.myId()}/track_likes/${trackId}`, {}, { method: "DELETE", auth: "required" });
    this.liked?.delete(trackId);
    this.http.clearCache();
  }

  /** A new private playlist of these tracks (a listening room's history). */
  async createPlaylist(title: string, trackIds: number[]): Promise<Playlist> {
    const raw = await this.http.json<RawPlaylist>("/playlists", {}, { method: "POST", auth: "required", body: { playlist: { title, sharing: "private", tracks: trackIds } } });
    // the library lists show it at once
    this.http.clearCache();
    return mapPlaylist(raw, "own");
  }

  private ownPlaylistPath(playlistId: string) {
    if (!/^\d+$/.test(playlistId)) throw new ScError("not_found", `bad playlist id ${playlistId}`);
    return `/playlists/${playlistId}`;
  }

  private changed(playlistId: string) {
    this.playlists.delete(playlistId);
    // the library lists and the playlist page show the change at once
    this.http.clearCache();
  }

  async setPlaylistTracks(playlistId: string, trackIds: number[]): Promise<void> {
    await this.http.json(this.ownPlaylistPath(playlistId), {}, { method: "PUT", auth: "required", body: { playlist: { tracks: trackIds } } });
    this.changed(playlistId);
  }

  async renamePlaylist(playlistId: string, title: string): Promise<void> {
    await this.http.json(this.ownPlaylistPath(playlistId), {}, { method: "PUT", auth: "required", body: { playlist: { title } } });
    this.changed(playlistId);
  }

  async deletePlaylist(playlistId: string): Promise<void> {
    await this.http.json(this.ownPlaylistPath(playlistId), {}, { method: "DELETE", auth: "required" });
    this.changed(playlistId);
  }

  async addToPlaylist(playlistId: string, trackId: number): Promise<void> {
    const { ids } = await this.loadPlaylist(playlistId);
    if (ids.includes(trackId)) return;
    await this.http.json(`/playlists/${playlistId}`, {}, { method: "PUT", auth: "required", body: { playlist: { tracks: [...ids, trackId] } } });
    this.playlists.delete(playlistId);
  }
}
