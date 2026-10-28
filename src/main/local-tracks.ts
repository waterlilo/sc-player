import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { app, dialog, protocol, shell, type BrowserWindow } from "electron";
import { parseFile } from "music-metadata";
import type { MusicProvider } from "@shared/provider";
import { isLocalTrack, LOCAL_TRACK_BASE, type StreamInfo, type Track, type TrackDetails } from "@shared/types";
import { ScError } from "./soundcloud";
import { JsonFile } from "./store/json-file";
import { serveFile } from "./system/background";
import { log } from "./system/log";

/**
 * Music from this computer (mp3, m4a, flac, ogg, wav), for oneself only: the files stay where they are, their tags give
 * the title, artist and cover, and they play from sclocal://file/<id>. Their ids sit far above SoundCloud's
 * (LOCAL_BASE + n, still plain safe integers), so the queue, history, playlists and lyrics take them as they are, while
 * whatever goes to SoundCloud, friends or rooms leaves them out — nobody else has the file.
 */
export const LOCAL_SCHEME = "sclocal";
const LOCAL_BASE = LOCAL_TRACK_BASE;
export { isLocalTrack };

const AUDIO: Record<string, string> = { ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".wav": "audio/wav" };
const MAX_FILES = 5000;

interface LocalFile {
  id: number;
  path: string;
  title: string;
  artist: string;
  durationMs: number;
  /** a cover was found in the tags (kept as local-covers/<id>.jpg) */
  cover: boolean;
  added: number;
}

let file: JsonFile<{ next: number; files: LocalFile[] }> | null = null;
const store = () => (file ??= new JsonFile<{ next: number; files: LocalFile[] }>(join(app.getPath("userData"), "local-tracks.json"), { next: 1, files: [] }, 500));
const covers = () => join(app.getPath("userData"), "local-covers");
const byId = (id: number) => store().get().files.find((f) => f.id === id) ?? null;

function toTrack(f: LocalFile): Track {
  return {
    id: f.id,
    title: f.title,
    artist: f.artist,
    user: { id: 0, username: f.artist, permalinkUrl: "" },
    durationMs: f.durationMs,
    artworkUrl: f.cover ? `${LOCAL_SCHEME}://cover/${f.id}` : null,
    waveformUrl: null,
    permalinkUrl: "",
    // a file moved or deleted since: shown, but it can't play
    playability: existsSync(f.path) ? "ok" : "blocked",
  };
}

/** Every file added, newest first. */
export const localLibrary = (): Track[] => [...store().get().files].sort((a, b) => b.added - a.added).map(toTrack);

/** The files' tags read and kept; ones added before are skipped. How many were added. */
async function addPaths(paths: string[]): Promise<number> {
  const s = store().get();
  const have = new Set(s.files.map((f) => f.path.toLowerCase()));
  const added: LocalFile[] = [];
  let next = s.next;
  for (const path of paths) {
    if (!AUDIO[extname(path).toLowerCase()] || have.has(path.toLowerCase())) continue;
    if (s.files.length + added.length >= MAX_FILES) break;
    const id = LOCAL_BASE + next++;
    const name = basename(path, extname(path));
    let title = name;
    let artist = "";
    let durationMs = 0;
    let cover = false;
    try {
      const meta = await parseFile(path, { duration: true });
      title = meta.common.title?.trim() || name;
      artist = meta.common.artist?.trim() || meta.common.albumartist?.trim() || "";
      durationMs = Math.round((meta.format.duration ?? 0) * 1000);
      const pic = meta.common.picture?.[0];
      if (pic && pic.data.length < 8 * 1024 * 1024) {
        mkdirSync(covers(), { recursive: true });
        writeFileSync(join(covers(), `${id}.jpg`), pic.data);
        cover = true;
      }
    } catch (e) {
      log("main", `local file: tags not read (${extname(path)}): ${e instanceof Error ? e.message : String(e)}`);
    }
    // "Artist - Title" file names, when the tags say nothing
    if (!artist && / - /.test(title)) [artist, title] = [title.slice(0, title.indexOf(" - ")).trim(), title.slice(title.indexOf(" - ") + 3).trim()];
    added.push({ id, path, title: title.slice(0, 300), artist: (artist || "Unknown artist").slice(0, 200), durationMs, cover, added: Date.now() });
    have.add(path.toLowerCase());
  }
  if (added.length) store().patch({ next, files: [...s.files, ...added] });
  return added.length;
}

/** Audio files under a folder (and its folders), up to the limit. */
function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 8 || out.length >= MAX_FILES) return out;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    const p = join(dir, n);
    try {
      if (statSync(p).isDirectory()) walk(p, out, depth + 1);
      else if (AUDIO[extname(n).toLowerCase()]) out.push(p);
    } catch {
      /* unreadable: skipped */
    }
  }
  return out;
}

/** Files (or a whole folder) picked in a dialog; how many were added. */
export async function addLocalFiles(win: BrowserWindow | null, folder: boolean): Promise<number> {
  const options: Electron.OpenDialogOptions = folder
    ? { title: "Add a music folder", properties: ["openDirectory"] }
    : { title: "Add music", properties: ["openFile", "multiSelections"], filters: [{ name: "Music", extensions: Object.keys(AUDIO).map((e) => e.slice(1)) }] };
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  if (res.canceled || !res.filePaths.length) return 0;
  return addPaths(folder ? walk(res.filePaths[0]!) : res.filePaths);
}

/** Files dropped onto the window (paths from the page, checked here: audio files and folders only). */
export const addDroppedFiles = (paths: string[]) => addPaths(paths.flatMap((p) => (existsSync(p) && statSync(p).isDirectory() ? walk(p) : [p])));

export function removeLocalTrack(id: number) {
  const f = byId(id);
  if (!f) return;
  rmSync(join(covers(), `${id}.jpg`), { force: true });
  store().patch({ files: store().get().files.filter((x) => x.id !== id) });
}

export function showLocalTrack(id: number) {
  const f = byId(id);
  if (f && existsSync(f.path)) shell.showItemInFolder(f.path);
}

export const flushLocalTracks = () => file?.flush();

/** sclocal://file/<id> (the music, in pieces as asked) and sclocal://cover/<id>; only files added here. */
export function serveLocalTracks() {
  protocol.handle(LOCAL_SCHEME, (req) => {
    const u = new URL(req.url);
    const id = Number(basename(u.pathname));
    const f = Number.isSafeInteger(id) ? byId(id) : null;
    if (!f) return new Response("not found", { status: 404 });
    if (u.host === "cover") return f.cover ? serveFile(join(covers(), `${id}.jpg`), null) : new Response("not found", { status: 404 });
    return serveFile(f.path, req.headers.get("range"));
  });
}

/**
 * The provider with this computer's music in it: local ids are answered here (their tracks, streams, details), and
 * SoundCloud is asked only about its own.
 */
export function withLocalTracks(p: MusicProvider): MusicProvider {
  const local = (id: number) => {
    const f = byId(id);
    if (!f) throw new ScError("not_found", "This file isn't in sc player any more");
    return f;
  };
  const own: Partial<MusicProvider> = {
    async getTracks(ids: number[]): Promise<Track[]> {
      const sc = ids.filter((id) => !isLocalTrack(id));
      const found = new Map((sc.length ? await p.getTracks(sc) : []).map((t) => [t.id, t]));
      for (const id of ids) if (isLocalTrack(id)) {
        const f = byId(id);
        if (f) found.set(id, toTrack(f));
      }
      return ids.map((id) => found.get(id)).filter((t): t is Track => !!t);
    },
    async getStreamUrl(id: number): Promise<StreamInfo> {
      if (!isLocalTrack(id)) return p.getStreamUrl(id);
      const f = local(id);
      if (!existsSync(f.path)) throw new ScError("not_found", "The file isn't where it was — moved or deleted");
      return { url: `${LOCAL_SCHEME}://file/${id}`, protocol: "progressive", mime: AUDIO[extname(f.path).toLowerCase()] ?? "audio/mpeg", snipped: false };
    },
    async getTrackDetails(id: number): Promise<TrackDetails> {
      if (!isLocalTrack(id)) return p.getTrackDetails(id);
      const f = local(id);
      return { track: toTrack(f), plays: null, likes: null, reposts: null, comments: null, genre: null, createdAt: new Date(f.added).toISOString(), releaseDate: null, label: null, description: null, tags: [] };
    },
    async getAlternatives(id: number, deep?: boolean): Promise<Track[]> {
      return isLocalTrack(id) ? [] : p.getAlternatives(id, deep);
    },
    async getRelated(id: number): Promise<Track[]> {
      return isLocalTrack(id) ? [] : p.getRelated(id);
    },
    async like(id: number) {
      if (isLocalTrack(id)) throw new ScError("unknown", "A file from this computer can't be liked on SoundCloud");
      return p.like(id);
    },
    async unlike(id: number) {
      if (!isLocalTrack(id)) return p.unlike(id);
    },
  };
  // everything else goes to SoundCloud's provider itself (bound: its methods keep their own `this`)
  return new Proxy(p, {
    get(target, key, receiver) {
      if (typeof key === "string" && key in own) return own[key as keyof MusicProvider];
      const v: unknown = Reflect.get(target, key, receiver);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

