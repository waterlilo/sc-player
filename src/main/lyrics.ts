import { join } from "node:path";
import { app, net } from "electron";
import type { Lyrics, LyricsHit } from "@shared/types";
import { parseTtml } from "./ttml";
import { normalize, primaryArtist } from "./soundcloud/match";
import { JsonFile } from "./store/json-file";
import { log } from "./system/log";

/**
 * Song words, from three open sources tried in turn:
 * 1. Better Lyrics (betterlyrics.org, used with its author's permission): often timed word by word. Without a key it
 *    answers only songs already in its cache, so a miss is quick and normal;
 * 2. Unison (Better Lyrics' community catalog), searched by name: small, mostly timed word by word;
 * 3. LRCLIB (lrclib.net: free, open, no key), synced line by line when available.
 * Looked up by artist, title and length; SoundCloud titles are noisy ("Artist - Title (Official Video) [prod. X]"),
 * so a few cleaned-up variants are tried. What the user picks by hand is remembered per track.
 */
const API = "https://lrclib.net/api";
const UA = () => `sc player/${app.getVersion()} (https://github.com/waterlilo/sc-player)`;

interface Raw {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface LyricsQuery {
  trackId: number;
  artist: string;
  title: string;
  durationMs: number;
}

/** LRCLIB said "busy" (503): that step is skipped, and a search that found nothing is not remembered. */
class Busy extends Error {}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One LRCLIB request. Busy (503 / 429) or a dropped connection is tried twice more after a pause (LRCLIB sits behind
 * Cloudflare, which is slow and flaky from some networks) before the step gives up.
 */
async function get<T>(path: string, params: Record<string, string | number>): Promise<T | null> {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  for (let attempt = 0; ; attempt++) {
    const last = attempt === 2;
    let res: Response;
    try {
      res = await net.fetch(url.href, { headers: { "User-Agent": UA(), Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      if (last) throw err;
      await wait(1500 * (attempt + 1));
      continue;
    }
    if (res.status === 404) return null;
    // a miss by artist and title makes LRCLIB ask other sources, and it answers 503 when they don't come through in
    // time: a miss all the same (only the free-text search's 503 means LRCLIB itself is busy)
    if (res.status === 503 && (path === "/get" || "artist_name" in params)) return null;
    if (res.status === 503 || res.status === 429) {
      if (last) throw new Busy(`LRCLIB is busy (${res.status})`);
      await wait(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`LRCLIB answered ${res.status}`);
    return (await res.json()) as T;
  }
}

/** "[01:02.34] words" lines; a line may carry several times. */
export function parseLrc(lrc: string): { t: number; text: string }[] {
  const lines: { t: number; text: string }[] = [];
  for (const row of lrc.split(/\r?\n/)) {
    const times = [...row.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!times.length) continue;
    const text = row.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of times) {
      const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0;
      lines.push({ t: Number(m[1]) * 60 + Number(m[2]) + frac, text });
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

const toLyrics = (r: Raw): Lyrics => ({
  id: r.id,
  artist: r.artistName,
  title: r.trackName,
  synced: r.syncedLyrics ? parseLrc(r.syncedLyrics) : null,
  plain: r.plainLyrics?.trim() || null,
  instrumental: r.instrumental,
  source: "lrclib",
});

const toHit = (r: Raw): LyricsHit => ({ id: r.id, artist: r.artistName, title: r.trackName, album: r.albumName ?? "", durationMs: Math.round(r.duration * 1000), synced: !!r.syncedLyrics });

/** The title without SoundCloud's noise: bracketed "official video", "prod.", featurings. */
function cleanTitle(title: string) {
  return title
    .replace(/[([{][^)\]}]*\b(official|video|audio|lyrics?|visuali[sz]er|prod|free|download|out now|premiere|explicit|clean|hq|hd)\b[^)\]}]*[)\]}]/gi, " ")
    .replace(/\s(feat|ft|featuring)\.?\s.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Without anything in brackets: "Судно (Борис Рыжий)" and "Судно (Sudno)" are both "судно". */
const bare = (s: string) => normalize(s.replace(/[([{][^)\]}]*[)\]}]/g, " "));

/** Name pairs to try, most likely first: "Artist - Title" read from the title, then the credits as they are. */
function variants(q: LyricsQuery): { artist: string; title: string }[] {
  const title = cleanTitle(q.title);
  const out: { artist: string; title: string }[] = [];
  // fans' uploads put "Artist - Title" in the title and the credited artist is just the uploader
  const dash = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) out.push({ artist: dash[1]!.trim(), title: cleanTitle(dash[2]!) });
  out.push({ artist: q.artist, title }, { artist: primaryArtist(q.artist), title });
  if (dash) out.push({ artist: q.artist, title: cleanTitle(dash[2]!) });
  // "Title - Artist" (the uploader's own name last): "pls dont die. - overtonight"
  if (dash && normalize(dash[2]!).includes(normalize(primaryArtist(q.artist)))) out.push({ artist: dash[2]!.trim(), title: cleanTitle(dash[1]!) });
  const seen = new Set<string>();
  return out.filter((v) => v.artist && v.title && !seen.has(`${v.artist}|${v.title}`) && seen.add(`${v.artist}|${v.title}`));
}

/**
 * The best record of the same song: the title must match (brackets aside) and the length be within 4 s — within 2 s
 * when the artist doesn't match by name (another alphabet: "молчат дома" / "Molchat Doma"). Synced words first.
 */
function closest(list: Raw[], durationMs: number, want: { artist: string; title: string }): Raw | null {
  const title = bare(want.title);
  const artist = normalize(primaryArtist(want.artist));
  const ok = list.filter((r) => {
    const t = bare(r.trackName);
    if (!title || !t || !(t === title || t.includes(title) || title.includes(t))) return false;
    const a = normalize(r.artistName);
    const sameArtist = !!artist && (a.includes(artist) || artist.includes(a));
    const off = durationMs ? Math.abs(r.duration * 1000 - durationMs) : 0;
    return off <= (sameArtist ? 4000 : 2000) && (sameArtist || durationMs > 0);
  });
  const rank = (r: Raw) => (r.syncedLyrics ? 0 : r.plainLyrics ? 1 : 2) * 1e6 + Math.abs(r.duration * 1000 - durationMs);
  return ok.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

// ---- Better Lyrics and Unison --------------------------------------------------------------------------------------

const BETTER = "https://api.betterlyrics.org/getLyrics";
const UNISON = "https://unison.boidu.dev";
/** after a 429, Better Lyrics is left alone until then (its Retry-After) */
let betterQuietUntil = 0;

/** TTML into our shape; null when it holds no lines. */
function fromTtml(ttml: string, artist: string, title: string, source: "betterlyrics" | "unison", id = 0): Lyrics | null {
  const lines = parseTtml(ttml);
  if (!lines.length) return null;
  return {
    id,
    artist,
    title,
    synced: lines.map((l) => ({ t: l.t, text: l.text, ...(l.words?.length ? { words: l.words } : {}) })),
    plain: lines.map((l) => l.text).join("\n"),
    instrumental: false,
    source,
  };
}

/** Better Lyrics by artist, title and length (whole seconds, as its cache is keyed); null on a miss or any trouble. */
async function betterLyrics(v: { artist: string; title: string }, seconds: number): Promise<Lyrics | null> {
  if (!seconds || Date.now() < betterQuietUntil) return null;
  const url = new URL(BETTER);
  url.searchParams.set("s", v.title);
  url.searchParams.set("a", v.artist);
  url.searchParams.set("d", String(seconds));
  try {
    const res = await net.fetch(url.href, { headers: { "User-Agent": UA(), Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 429) {
      betterQuietUntil = Date.now() + Math.max(1, Number(res.headers.get("retry-after")) || 30) * 1000;
      return null;
    }
    // 401: not in its cache (keys aren't handed out), 404 / 422: nothing
    if (!res.ok) return null;
    const body = (await res.json()) as { ttml?: unknown };
    return typeof body.ttml === "string" ? fromTtml(body.ttml, v.artist, v.title, "betterlyrics") : null;
  } catch {
    return null;
  }
}

interface UnisonHit {
  id: number;
  song: string;
  artist: string;
  duration: number;
  matchScore?: number;
  effectiveScore?: number;
}

/** Unison, the community catalog: searched by name, then the best record of the same song (title and length agree). */
async function unison(v: { artist: string; title: string }, durationMs: number): Promise<Lyrics | null> {
  const headers = { "User-Agent": UA(), Accept: "application/json" };
  try {
    const search = new URL(`${UNISON}/lyrics/search`);
    search.searchParams.set("q", `${v.artist} ${bare(v.title)}`);
    const res = await net.fetch(search.href, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const hits = ((await res.json()) as { data?: UnisonHit[] }).data ?? [];
    const title = bare(v.title);
    const artist = normalize(primaryArtist(v.artist));
    const ok = hits.filter((h) => {
      const t = bare(h.song);
      if (!t || !(t === title || t.includes(title) || title.includes(t))) return false;
      const a = normalize(h.artist);
      const sameArtist = !!artist && (a.includes(artist) || artist.includes(a));
      const off = durationMs ? Math.abs(h.duration * 1000 - durationMs) : 0;
      return sameArtist && off <= 3000;
    });
    const best = ok.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))[0];
    if (!best) return null;
    const one = await net.fetch(`${UNISON}/lyrics/${best.id}`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!one.ok) return null;
    const data = ((await one.json()) as { data?: { lyrics?: unknown } }).data;
    return typeof data?.lyrics === "string" ? fromTtml(data.lyrics, best.artist, best.song, "unison", best.id) : null;
  } catch {
    return null;
  }
}

// ---- remembered answers ------------------------------------------------------------------------------------------

const found = new Map<number, Lyrics | null>();
let picks: JsonFile<{ byTrack: Record<string, number> }> | null = null;
const pickFile = () => (picks ??= new JsonFile<{ byTrack: Record<string, number> }>(join(app.getPath("userData"), "lyrics-picks.json"), { byTrack: {} }, 1000));

export async function lyricsFor(q: LyricsQuery): Promise<Lyrics | null> {
  if (found.has(q.trackId)) return found.get(q.trackId)!;
  let busy = false;
  /** one step of the search; "busy" skips it */
  const step = async <T>(run: () => Promise<T | null>): Promise<T | null> => {
    try {
      return await run();
    } catch (err) {
      if (!(err instanceof Busy)) throw err;
      busy = true;
      return null;
    }
  };
  const seconds = Math.round(q.durationMs / 1000);
  const tries: (() => Promise<Raw | null>)[] = [];
  const picked = pickFile().get().byTrack[String(q.trackId)];
  if (picked) tries.push(() => get<Raw>(`/get/${picked}`, {}));
  // Better Lyrics first (word timing when it has the song), unless the user picked an LRCLIB record by hand
  if (!picked)
    for (const v of variants(q).slice(0, 2)) {
      const better = await betterLyrics(v, seconds);
      if (better) {
        found.set(q.trackId, better);
        return better;
      }
    }
  // then the community catalog (small, so a miss is quick; its records are usually timed word by word)
  if (!picked) {
    const fromUnison = await unison(variants(q)[0]!, q.durationMs);
    if (fromUnison) {
      found.set(q.trackId, fromUnison);
      return fromUnison;
    }
  }
  for (const v of variants(q)) {
    if (seconds) tries.push(() => get<Raw>("/get", { artist_name: v.artist, track_name: v.title, duration: seconds }));
    tries.push(async () => closest((await get<Raw[]>("/search", { track_name: v.title, artist_name: v.artist })) ?? [], q.durationMs, v));
  }
  const first = variants(q)[0]!;
  tries.push(async () => closest((await get<Raw[]>("/search", { q: `${first.artist} ${bare(first.title)}` })) ?? [], q.durationMs, first));
  // the title alone, for artists written in another alphabet (the length has to agree closely then)
  tries.push(async () => closest((await get<Raw[]>("/search", { track_name: bare(first.title) })) ?? [], q.durationMs, first));

  try {
    for (const run of tries) {
      const raw = await step(run);
      if (!raw) continue;
      const result = toLyrics(raw);
      found.set(q.trackId, result);
      return result;
    }
  } catch (err) {
    // offline: not remembered, so the next look tries again
    log("main", `lyrics: ${(err as Error).message}`);
    throw err;
  }
  if (busy) throw new Error("LRCLIB is busy, try again in a moment");
  found.set(q.trackId, null);
  return null;
}

/** Looking by hand: any words ("artist title"). */
export async function searchLyrics(text: string): Promise<LyricsHit[]> {
  const list = (await get<Raw[]>("/search", { q: text.slice(0, 200) })) ?? [];
  return list.filter((r) => r.plainLyrics || r.syncedLyrics || r.instrumental).slice(0, 30).map(toHit);
}

/** The user picked this record for the track: shown now and remembered. */
export async function pickLyrics(trackId: number, lyricsId: number): Promise<Lyrics | null> {
  const raw = await get<Raw>(`/get/${lyricsId}`, {});
  const result = raw ? toLyrics(raw) : null;
  found.set(trackId, result);
  pickFile().patch({ byTrack: { ...pickFile().get().byTrack, [String(trackId)]: lyricsId } });
  return result;
}

export function flushLyrics() {
  picks?.flush();
}
