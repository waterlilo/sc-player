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

/** a made-up cover that looks like artwork: soft colour fields, light from one side, film grain (hues spread by the golden angle) */
function cover(seed: number) {
  const r = rand(seed * 7919 + 13);
  r();
  const hue = Math.round((seed * 137.508) % 360);
  const blob = (h: number, s: number, l: number) =>
    `<ellipse cx="${(20 + r() * 60).toFixed(1)}" cy="${(25 + r() * 55).toFixed(1)}" rx="${(16 + r() * 22).toFixed(1)}" ry="${(12 + r() * 18).toFixed(1)}" fill="hsl(${h} ${s}% ${l}%)" opacity="${(0.6 + r() * 0.35).toFixed(2)}"/>`;
  const kind = seed % 3;
  const extra =
    kind === 0
      ? `<rect y="68" width="100" height="32" fill="#000" opacity=".5"/><path d="M47 68a11 11 0 0 1 22 0z" fill="hsl(${(hue + 30) % 360} 70% 72%)"/>`
      : kind === 1
        ? Array.from({ length: 14 }, (_, i) => `<path d="M0 ${18 + i * 5} Q 50 ${12 + i * 5 + r() * 8} 100 ${18 + i * 5}" stroke="#fff" stroke-opacity=".14" fill="none" stroke-width=".5"/>`).join("")
        : `<rect x="20" y="20" width="60" height="60" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width=".6"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter><filter id="g"><feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .09 0"/></filter><radialGradient id="v" cx=".5" cy=".5" r=".75"><stop offset=".55" stop-opacity="0"/><stop offset="1" stop-opacity=".5"/></radialGradient><linearGradient id="d" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="hsl(${hue} 45% 14%)"/><stop offset="1" stop-color="hsl(${hue} 40% 5%)"/></linearGradient></defs><rect width="100" height="100" fill="url(#d)"/><g filter="url(#b)">${blob(hue, 60, 52)}${blob((hue + 25) % 360, 55, 38)}${blob((hue + 330) % 360, 65, 70)}</g>${extra}<rect width="100" height="100" fill="url(#v)"/><rect width="100" height="100" filter="url(#g)"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}#-large.jpg`;
}

const me: User = { id: 1, username: "sky", permalink: "skythemontage", permalinkUrl: "https://soundcloud.com/skythemontage", avatarUrl: null, city: "Moscow", followers: 1234, trackCount: 12, likesCount: 320, playlistCount: 9, followingsCount: artists.length };

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
  getFollowings = (_id: number | "me", cursor?: string | null) =>
    delay(page(artists.map((a, i): User => ({ id: 10 + i, username: a, permalink: "demo", permalinkUrl: "https://soundcloud.com/demo", avatarUrl: cover(40 + i), city: null, followers: 120 * (i + 3), trackCount: 8 + i, likesCount: null, playlistCount: null, followingsCount: null })), cursor));
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
  like = async () => undefined;
  unlike = async () => undefined;
}
