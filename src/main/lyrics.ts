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

// at most 3 requests to LRCLIB at a time: a song's lookups start together, but LRCLIB is free and often busy
let lrclibActive = 0;
const lrclibWaiting: (() => void)[] = [];
async function lrclibSlot<T>(run: () => Promise<T>): Promise<T> {
  if (lrclibActive >= 3) await new Promise<void>((r) => lrclibWaiting.push(r));
  lrclibActive++;
  try {
    return await run();
  } finally {
    lrclibActive--;
    lrclibWaiting.shift()?.();
  }
}

/**
 * One LRCLIB request. Busy (503 / 429) or a dropped connection is tried twice more after a pause (LRCLIB sits behind
 * Cloudflare, which is slow and flaky from some networks) before the step gives up. `signal`: the answer is no longer
 * needed (another source already had the words).
 */
async function get<T>(path: string, params: Record<string, string | number>, signal?: AbortSignal): Promise<T | null> {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    const last = attempt === 2;
    let res: Response;
    try {
      const timeout = AbortSignal.timeout(15_000);
      res = await lrclibSlot(() => {
        signal?.throwIfAborted();
        return net.fetch(url.href, { headers: { "User-Agent": UA(), Accept: "application/json" }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      });
    } catch (err) {
      if (last || signal?.aborted) throw err;
      await wait(1500 * (attempt + 1));
      continue;
    }
    if (res.status === 404) return null;
    // a miss by artist and title makes LRCLIB ask other sources, and it answers 503 when they don't come through in
    // time: a miss all the same (only the free-text search's 503 means LRCLIB itself is busy)
    if (res.status === 503 && (path === "/get" || "artist_name" in params)) return null;
    if (res.status === 503 || res.status === 429) {
      if (last) throw new Busy(`LRCLIB is busy (${res.status})`);
      await wait(700 * (attempt + 1));
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

/** The title without SoundCloud's noise: bracketed "official video", "prod.", featurings ("feat. x", "w/ lil tracy"). */
export function cleanTitle(title: string) {
  return title
    .replace(/[([{][^)\]}]*\b(official|video|audio|lyrics?|visuali[sz]er|prod|free|download|out now|premiere|explicit|clean|hq|hd)\b[^)\]}]*[)\]}]/gi, " ")
    .replace(/[([{]\s*(w\/|\/w|with\s)[^)\]}]*[)\]}]/gi, " ")
    .replace(/\s(feat|ft|featuring)\.?\s.*$/i, "")
    .replace(/\s(w\/|\/w)\s?.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Without anything in brackets, as written: what to search by (a normalized name has lost its й and ё). */
const unbracketed = (s: string) =>
  s
    .replace(/[([{][^)\]}]*[)\]}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
/** Without anything in brackets, for comparing: "Судно (Борис Рыжий)" and "Судно (Sudno)" are both "судно". */
const bare = (s: string) => normalize(unbracketed(s));

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

/**
 * Last resort: the same song by the same artist at another length — a remix, a sped-up or slowed upload, a longer
 * intro. Its timing would be wrong, so only its words come along, as plain text (the player follows them roughly and
 * the listener can align them by a click).
 */
function otherVersion(list: Raw[], want: { artist: string; title: string }): Raw | null {
  const title = bare(want.title);
  const artist = normalize(primaryArtist(want.artist));
  if (!title || !artist) return null;
  const ok = list.filter((r) => {
    const t = bare(r.trackName);
    const a = normalize(r.artistName);
    return !r.instrumental && !!(r.plainLyrics?.trim() || r.syncedLyrics) && !!t && (t === title || t.includes(title) || title.includes(t)) && !!a && (a.includes(artist) || artist.includes(a));
  });
  return ok.sort((a, b) => (b.plainLyrics?.length ?? 0) - (a.plainLyrics?.length ?? 0))[0] ?? null;
}

/** A record's words without their times. */
function wordsOnly(r: Raw): Lyrics {
  const l = toLyrics(r);
  return { ...l, synced: null, plain: l.plain ?? l.synced?.map((x) => x.text).join("\n") ?? null };
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
    search.searchParams.set("q", `${v.artist} ${unbracketed(v.title)}`);
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

// ---- words of one's own ------------------------------------------------------------------------------------------

/** Words the user pasted for a track (lyrics-own.json): shown before anything found. */
let own: JsonFile<{ byTrack: Record<string, { text: string; at: number }> }> | null = null;
const ownFile = () => (own ??= new JsonFile<{ byTrack: Record<string, { text: string; at: number }> }>(join(app.getPath("userData"), "lyrics-own.json"), { byTrack: {} }, 1000));

/** Pasted words as lyrics: timed lines when they carry LRC times ("[01:23.45] …"), else plain lines. */
function ownLyrics(q: { artist: string; title: string }, text: string): Lyrics {
  const timed = parseLrc(text).filter((l) => l.text);
  const plain = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\[[^\]]*\]/g, "").trim())
    .filter(Boolean)
    .join("\n");
  return { id: 0, artist: q.artist, title: q.title, synced: timed.length >= 2 ? timed : null, plain: plain || null, instrumental: false, source: "own" };
}

/** The user's own words for a track (`text` null: back to what's found). The words now shown, or null to look again. */
export function setOwnLyrics(q: { trackId: number; artist: string; title: string }, text: string | null): Lyrics | null {
  const byTrack = { ...ownFile().get().byTrack };
  if (text?.trim()) byTrack[String(q.trackId)] = { text: text.trim(), at: Date.now() };
  else delete byTrack[String(q.trackId)];
  ownFile().patch({ byTrack });
  found.delete(q.trackId);
  return text?.trim() ? ownLyrics(q, text.trim()) : null;
}

/**
 * Every source is asked at once and the answers are taken in order of preference (a pick by hand, Better Lyrics,
 * Unison, then LRCLIB's lookups): one after another a slow or busy LRCLIB made some songs wait 30 s. The user's own
 * words come before all of them.
 */
export async function lyricsFor(q: LyricsQuery): Promise<Lyrics | null> {
  const mine = ownFile().get().byTrack[String(q.trackId)];
  if (mine) return ownLyrics(q, mine.text);
  if (found.has(q.trackId)) return found.get(q.trackId)!;
  // once the words are chosen, the lookups still running are dropped
  const stop = new AbortController();
  try {
    return await lookUp(q, stop.signal);
  } finally {
    stop.abort();
  }
}

async function lookUp(q: LyricsQuery, signal: AbortSignal): Promise<Lyrics | null> {
  let busy = false;
  let failed: Error | null = null;
  /** one lookup, started now; "busy" or a network error is a miss here (noted for the end) */
  const start = <T>(run: () => Promise<T | null>): Promise<T | null> =>
    run().catch((err: Error) => {
      if (err instanceof Busy) busy = true;
      else failed = err;
      return null;
    });
  const seconds = Math.round(q.durationMs / 1000);
  const all = variants(q);
  const first = all[0]!;
  const picked = pickFile().get().byTrack[String(q.trackId)];

  // Better Lyrics (word timing when it has the song) and the community catalog, unless the user picked a record by hand
  const better = picked ? [] : all.slice(0, 2).map((v) => betterLyrics(v, seconds));
  const fromUnison = picked ? Promise.resolve(null) : unison(first, q.durationMs);

  // LRCLIB; every record its searches saw stays for the last resort (another version of the song)
  const pool: Raw[] = [];
  const search = async (params: Record<string, string>, want: { artist: string; title: string }) => {
    const list = (await get<Raw[]>("/search", params, signal)) ?? [];
    pool.push(...list);
    return closest(list, q.durationMs, want);
  };
  const lookups: Promise<Raw | null>[] = [];
  if (picked) lookups.push(start(() => get<Raw>(`/get/${picked}`, {}, signal)));
  for (const v of all) {
    if (seconds) lookups.push(start(() => get<Raw>("/get", { artist_name: v.artist, track_name: v.title, duration: seconds }, signal)));
    lookups.push(start(() => search({ track_name: v.title, artist_name: v.artist }, v)));
  }
  lookups.push(start(() => search({ q: `${first.artist} ${unbracketed(first.title)}` }, first)));
  // the title alone, for artists written in another alphabet (the length has to agree closely then)
  lookups.push(start(() => search({ track_name: unbracketed(first.title) }, first)));

  const done = (result: Lyrics) => {
    found.set(q.trackId, result);
    return result;
  };
  if (picked) {
    const raw = await lookups[0]!;
    if (raw) return done(toLyrics(raw));
  }
  for (const b of better) {
    const l = await b;
    if (l) return done(l);
  }
  const u = await fromUnison;
  if (u) return done(u);
  // the first hit in order, but a timed record of the song from a later lookup beats plain words (they are all running)
  let plainHit: Raw | null = null;
  for (const lookup of lookups) {
    const raw = await lookup;
    if (raw?.syncedLyrics) return done(toLyrics(raw));
    plainHit ??= raw;
  }
  if (plainHit) return done(toLyrics(plainHit));
  for (const v of all) {
    const other = otherVersion(pool, v);
    if (other) return done(wordsOnly(other));
  }
  if (failed) {
    // offline: not remembered, so the next look tries again
    log("main", `lyrics: ${(failed as Error).message}`);
    throw failed;
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
  // a pick replaces one's own words
  const mine = { ...ownFile().get().byTrack };
  if (String(trackId) in mine && delete mine[String(trackId)]) ownFile().patch({ byTrack: mine });
  return result;
}

export function flushLyrics() {
  picks?.flush();
  own?.flush();
}
