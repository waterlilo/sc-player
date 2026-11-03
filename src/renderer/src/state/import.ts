import { create } from "zustand";
import type { AppErrorInfo, ImportItem, ImportService, Playlist, Track } from "@shared/types";
import { tr as t } from "@/i18n";
import { createPlaylist } from "@/lib/playlists";
import { call, errorCode, SkyError } from "@/lib/sky";
import { askCheck } from "./check";

/**
 * Bringing a playlist over from Yandex Music, Spotify or a list of text: main reads it, then every track is looked
 * for on SoundCloud here, two at a time with a pause between searches (SoundCloud's bot protection notices bursts).
 * Lives outside the screen, so the search goes on while the person looks around the app.
 */

/** found — matched on its own; maybe — only uploads that might be it; none — nothing; failed — its link didn't open */
export type RowState = "waiting" | "found" | "maybe" | "none" | "failed";

export interface ImportRow {
  item: ImportItem;
  state: RowState;
  /** the upload that goes into the playlist (found, or picked by hand); null — left out */
  pick: Track | null;
  /** other uploads to choose from */
  options: Track[];
}

export type ImportPhase = "idle" | "reading" | "searching" | "paused" | "done";

interface ImportStore {
  phase: ImportPhase;
  service: ImportService | null;
  title: string | null;
  partial: boolean;
  rows: ImportRow[];
  /** why reading failed or the search stopped */
  error: AppErrorInfo | null;
}

const blank: ImportStore = { phase: "idle", service: null, title: null, partial: false, rows: [], error: null };

export const useImport = create<ImportStore>(() => blank);

const WORKERS = 2;
const GAP_MS = 350;
/** SoundCloud's own limit for a playlist (main's local-playlists) */
const PLAYLIST_MAX = 500;

/** bumped to stop the search that is running */
let run = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const info = (err: unknown): AppErrorInfo => ({ code: errorCode(err), message: err instanceof SkyError ? err.message : "" });

function setRow(i: number, patch: Partial<ImportRow>) {
  const rows = useImport.getState().rows.slice();
  rows[i] = { ...rows[i]!, ...patch };
  useImport.setState({ rows });
}

/** The search for every track still waiting; stops itself (paused) when SoundCloud or the connection stops it. */
async function search() {
  const me = ++run;
  useImport.setState({ phase: "searching", error: null });
  const claimed = new Set<number>();
  const worker = async () => {
    for (;;) {
      if (me !== run) return;
      const rows = useImport.getState().rows;
      const i = rows.findIndex((r, k) => r.state === "waiting" && !claimed.has(k));
      if (i < 0) return;
      claimed.add(i);
      try {
        const m = await call("import:match", rows[i]!.item);
        if (me !== run) return;
        setRow(i, { item: m.item, state: m.found ? "found" : m.options.length ? "maybe" : "none", pick: m.found, options: m.options });
      } catch (err) {
        if (me !== run) return;
        const code = errorCode(err);
        if (code === "verify" || code === "offline" || code === "rate_limited" || code === "unavailable") {
          // the whole search waits: this track is searched again on resume
          run++;
          useImport.setState({ phase: "paused", error: info(err) });
          if (code === "verify") {
            const q = rows[i]!.item;
            askCheck({ action: t.importAction, url: `https://soundcloud.com/search?q=${encodeURIComponent(`${q.artist} ${q.title}`.trim())}`, retry: async () => (resumeImport(), true) });
          }
          return;
        }
        setRow(i, { state: "failed", pick: null, options: [] });
      }
      await sleep(GAP_MS);
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  if (me === run) useImport.setState({ phase: "done" });
}

/** Read a pasted link, links or lines, then look for every track. */
export async function startImport(text: string) {
  run++;
  useImport.setState({ ...blank, phase: "reading" });
  try {
    const list = await call("import:read", text);
    useImport.setState({ service: list.service, title: list.title, partial: list.partial, rows: list.items.map((item) => ({ item, state: "waiting", pick: null, options: [] })) });
  } catch (err) {
    useImport.setState({ phase: "idle", error: info(err) });
    return;
  }
  void search();
}

export const pauseImport = () => {
  run++;
  useImport.setState({ phase: "paused", error: null });
};

export const resumeImport = () => {
  if (useImport.getState().phase === "paused") void search();
};

/** Back to the start (the search stops, what was found is dropped). */
export const resetImport = () => {
  run++;
  useImport.setState(blank);
};

/** This upload for the row (one of its options), or null to leave the track out. */
export function pickImport(i: number, track: Track | null) {
  const row = useImport.getState().rows[i];
  if (!row) return;
  // the upload put aside stays among the choices
  const options = row.pick && track?.id !== row.pick.id && !row.options.some((o) => o.id === row.pick!.id) ? [row.pick, ...row.options] : row.options;
  setRow(i, { pick: track, options: track ? options.filter((o) => o.id !== track.id) : options });
}

/** The tracks going into the playlist, in the original order, each once. */
export function pickedIds(rows: ImportRow[]): number[] {
  const seen = new Set<number>();
  return rows.flatMap((r) => (r.pick && !seen.has(r.pick.id) && seen.add(r.pick.id) ? [r.pick.id] : []));
}

/** The picked tracks as playlists on this computer: one, or several of 500 (SoundCloud's limit) for a longer list. */
export async function saveImport(name: string): Promise<Playlist> {
  const ids = pickedIds(useImport.getState().rows);
  const parts = Math.ceil(ids.length / PLAYLIST_MAX);
  let first: Playlist | null = null;
  for (let p = 0; p < parts; p++) {
    const made = await createPlaylist(parts > 1 ? `${name} ${p + 1}` : name, ids.slice(p * PLAYLIST_MAX, (p + 1) * PLAYLIST_MAX));
    first ??= made;
  }
  return first!;
}

/** A track link not read yet, as the link it came from. */
export function refLink(ref: string | undefined): string {
  const [service, id] = (ref ?? "").split(":");
  return service === "spotify" ? `https://open.spotify.com/track/${id}` : service === "yandex" ? `https://music.yandex.ru/track/${id}` : service === "youtube" ? `https://music.youtube.com/watch?v=${id}` : "";
}

/** The tracks left without an upload, as lines of "Artist — Title" (to look for elsewhere). */
export function missingText(rows: ImportRow[]): string {
  return rows
    .filter((r) => !r.pick && r.state !== "waiting")
    .map((r) => (r.item.title ? (r.item.artist ? `${r.item.artist} — ${r.item.title}` : r.item.title) : refLink(r.item.ref)))
    .filter(Boolean)
    .join("\n");
}
