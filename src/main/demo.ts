import type { MusicProvider, SearchKind } from "@shared/provider";
import type { Page, Playlist, QueueSource, Resolved, StreamInfo, Track, User } from "@shared/types";
import { ScError } from "./soundcloud/errors";

/**
 * Dev-only stand-in for SoundCloud (SKY_DEMO=1): made-up tracks with Cyrillic and Latin titles, generated waveforms
 * and a quiet local tone instead of a stream. For working on the UI without touching SoundCloud. Never used in a
 * packaged build.
 */
const words = ["ночной", "экспресс", "пыль", "на", "луне", "кислотный", "дождь", "звёзды", "над", "МКАДом", "midnight", "drive", "paper", "moon", "glass", "choir", "static", "bloom", "после", "полуночи", "серый", "шум", "low", "orbit"];
const artists = ["лунный кот", "серый шум", "Paper Moon", "skythemontage", "ночная смена", "Glass Choir", "Кислотный Двор"];

function rand(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function cover(seed: number) {
  const r = rand(seed + 3);
  const hue = Math.floor(r() * 360);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="hsl(${hue} 45% 22%)"/><circle cx="${30 + r() * 40}" cy="${30 + r() * 40}" r="${12 + r() * 20}" fill="hsl(${(hue + 60) % 360} 80% 60%)"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}#-large.jpg`;
}

const me: User = { id: 1, username: "sky", permalink: "skythemontage", permalinkUrl: "https://soundcloud.com/skythemontage", avatarUrl: null, city: "Moscow", followers: 1234, trackCount: 12, likesCount: 320, playlistCount: 9 };

function track(i: number): Track {
  const r = rand(i + 11);
  const n = 1 + Math.floor(r() * 4);
  let title = Array.from({ length: n }, () => words[Math.floor(r() * words.length)]).join(" ");
  if (i === 2) title = "Очень длинное название трека, которое точно не поместится в плеер (slowed + reverb remix)";
  const playability = i % 23 === 7 ? "drm" : i % 31 === 5 ? "preview" : "ok";
  const artist = artists[i % artists.length]!;
  return {
    id: 1000 + i,
    title: title.charAt(0).toUpperCase() + title.slice(1),
    artist,
    user: { id: 10 + (i % artists.length), username: artist, permalinkUrl: "https://soundcloud.com/demo" },
    durationMs: 95_000 + Math.floor(r() * 200_000),
    artworkUrl: i % 9 === 4 ? null : cover(i),
    waveformUrl: `https://wave.sndcdn.com/demo-${i}_m.json`,
    permalinkUrl: "https://soundcloud.com/demo",
    playability,
  };
}

const LIKES = Array.from({ length: 320 }, (_, i) => track(i));
const PLAYLISTS: Playlist[] = Array.from({ length: 9 }, (_, i) => ({
  id: String(500 + i),
  title: ["ночь в AE", "рендер-фон", "Midnight drive", "дождь", "glass choir", "пыль на луне", "slowed", "для монтажа", "утро"][i]!,
  user: { id: i % 3 ? 1 : 12, username: i % 3 ? "sky" : "Paper Moon", permalinkUrl: "https://soundcloud.com/demo" },
  artworkUrl: i === 5 ? null : cover(100 + i),
  trackCount: 20 + i * 7,
  durationMs: (20 + i * 7) * 180_000,
  permalinkUrl: "https://soundcloud.com/demo",
  isAlbum: i === 4,
  relation: i % 3 ? "own" : "liked",
  releaseDate: "2025-10-31T00:00:00Z",
  genre: null,
}));

/** demo protected tracks have one playable re-upload, id + REUPLOAD */
const REUPLOAD = 100_000;
function reupload(id: number): Track | null {
  const t = LIKES.find((x) => x.id === id - REUPLOAD);
  if (!t) return null;
  return { ...t, id, user: { id: 99, username: "reupload fan", permalinkUrl: "https://soundcloud.com/demo" }, playability: "ok", durationMs: t.durationMs + 800 };
}

function page<T>(list: T[], cursor: string | null | undefined, size = 50): Page<T> {
  const offset = cursor ? Number(cursor) : 0;
  const next = offset + size < list.length ? String(offset + size) : null;
  return { items: list.slice(offset, offset + size), next };
}

const delay = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 250));

/** A soft 220 Hz tone with a slow fade, as a WAV data URL. */
function tone(seconds: number) {
  const rate = 8000;
  const n = rate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 1800 * (0.6 + 0.4 * Math.sin(i / rate))), 44 + i * 2);
  return `data:audio/wav;base64,${buf.toString("base64")}`;
}

export class DemoProvider implements MusicProvider {
  private wav = tone(30);
  getMe = () => delay(me);
  getLikes = (cursor?: string | null) => delay(page(LIKES, cursor));
  getPlaylists = (cursor?: string | null) => delay(page(PLAYLISTS, cursor));
  getPlaylist = async (id: string) => PLAYLISTS.find((p) => p.id === id) ?? Promise.reject(new ScError("not_found", id));
  getPlaylistTracks = (id: string, cursor?: string | null) => {
    const p = PLAYLISTS.find((x) => x.id === id);
    return delay(page(LIKES.slice(Number(id) - 500, Number(id) - 500 + (p?.trackCount ?? 0)), cursor));
  };
  getUser = async (id: number) => ({ ...me, id, username: artists[id % artists.length] ?? "demo" });
  getUserLikes = (_id: number, cursor?: string | null) => delay(page(LIKES.slice(40), cursor));
  getTracks = async (ids: number[]) => ids.map((id) => LIKES.find((t) => t.id === id) ?? reupload(id)).filter((t): t is Track => !!t);
  getAlternatives = async (id: number) => {
    const t = LIKES.find((x) => x.id === id);
    const alt = t && t.playability !== "ok" ? reupload(id + REUPLOAD) : null;
    return alt ? [alt] : [];
  };
  getSourceIds = async (source: QueueSource) => {
    if (source.kind === "playlist") {
      const p = PLAYLISTS.find((x) => x.id === source.playlistId);
      const start = Number(source.playlistId) - 500;
      return LIKES.slice(start, start + (p?.trackCount ?? 0)).map((t) => t.id);
    }
    if (source.kind === "likes") return (source.userId === "me" ? LIKES : LIKES.slice(40)).map((t) => t.id);
    if (source.kind === "userTracks") return LIKES.slice(100, 160).map((t) => t.id);
    return [];
  };
  getTrackDetails = async (id: number) => {
    const track = LIKES.find((t) => t.id === id);
    if (!track) throw new ScError("not_found", "demo");
    return { track, plays: 12345, likes: 321, reposts: 12, comments: 4, genre: "Witch house", createdAt: "2025-10-31T00:00:00Z", releaseDate: null, label: null, description: "Демо-описание трека. Вторая строка.", tags: ["night", "ae", "slowed"] };
  };
  getRelated = async (id: number) => LIKES.filter((t) => t.id !== id).slice(200, 220);
  getUserTracks = (_id: number, cursor?: string | null) => delay(page(LIKES.slice(100, 160), cursor));
  getFeed = (cursor?: string | null) => delay(page(LIKES.slice(40, 140), cursor));
  getUserPlaylists = (_id: number, cursor?: string | null) => delay(page(PLAYLISTS.slice(2), cursor));
  resolve = async (): Promise<Resolved> => ({ kind: "user", user: { ...me, id: 12, username: "Paper Moon" } });
  search = (query: string, _kind: SearchKind, cursor?: string | null) => delay(page(LIKES.filter((t) => t.title.toLowerCase().includes(query.toLowerCase()) || t.artist.toLowerCase().includes(query.toLowerCase())), cursor, 30));
  searchSuggestions = async (q: string) => words.filter((w) => w.startsWith(q.toLowerCase())).slice(0, 8);
  getStreamUrl = async (id: number): Promise<StreamInfo> => {
    if (LIKES.find((t) => t.id === id)?.playability === "drm") throw new ScError("unavailable", "demo drm");
    return { url: this.wav, protocol: "progressive", mime: "audio/wav", snipped: false };
  };
  getWaveform = async (url: string) => {
    const r = rand(Number(url.match(/demo-(\d+)/)?.[1] ?? 1) + 5);
    return Array.from({ length: 1800 }, (_, i) => Math.min(1, 0.25 + 0.45 * Math.abs(Math.sin(i / 60)) * (0.6 + r() * 0.4) + (i > 900 && i < 1300 ? 0.2 : 0)));
  };
  getLikedIds = async () => LIKES.map((t) => t.id);
  getMyPlaylists = async () => PLAYLISTS.filter((p) => p.relation === "own");
  like = async () => undefined;
  unlike = async () => undefined;
  addToPlaylist = async () => undefined;
}
