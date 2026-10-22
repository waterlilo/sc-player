import { join } from "node:path";
import { app, net } from "electron";
import type { Lyrics, LyricsHit } from "@shared/types";
import { normalize, primaryArtist } from "./soundcloud/match";
import { JsonFile } from "./store/json-file";
import { log } from "./system/log";

/**
 * Song words from LRCLIB (lrclib.net: free, open, no key), synced line by line when available. Looked up by artist,
 * title and length; SoundCloud titles are noisy ("Artist - Title (Official Video) [prod. X]"), so a few cleaned-up
 * variants are tried. What the user picks by hand is remembered per track.
 */
const API = "https://lrclib.net/api";
const UA = () => `sc player/${app.getVersion()} (https://github.com/waterlilo/sky-player)`;

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
