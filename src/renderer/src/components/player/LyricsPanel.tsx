import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { largestMove } from "@shared/fitTiming";
import type { Lyrics, LyricsHit, SyncRequest, Track } from "@shared/types";
import { useT } from "@/i18n";
import { duration } from "@/lib/format";
import { syncLyrics, useLyricsSync } from "@/lib/lyricsSync";
import { call } from "@/lib/sky";
import { player, useCurrentTrack, usePlayer, usePosition, useStreamTrack } from "@/state/player";
import { useSettings } from "@/state/settings";
import { useUi } from "@/state/ui";
import { IconButton } from "../ui/Buttons";
import MarkerEdge from "../deco/MarkerEdge";
import Icon from "../ui/Icon";

const key = (id: number) => ["lyrics", id] as const;

const SOURCES = {
  lrclib: { name: "LRCLIB", url: "https://lrclib.net" },
  betterlyrics: { name: "Better Lyrics", url: "https://betterlyrics.org" },
  unison: { name: "Unison · Better Lyrics", url: "https://betterlyrics.org" },
} as const;

/** Where the words came from, with a link to it (Better Lyrics asked for one), and how they are timed. */
export function LyricsSource({ lyrics, syncing = false }: { lyrics: Lyrics | null | undefined; syncing?: boolean }) {
  const t = useT();
  const src = SOURCES[lyrics?.source ?? "lrclib"];
  const byWord = !!lyrics?.synced?.some((l) => (l.words?.length ?? 0) > 1);
  return (
    <>
      {syncing ? (lyrics?.synced?.length ? t.lyricsChecking : t.lyricsSyncing) : lyrics?.aligned ? t.lyricsAligned : lyrics?.synced?.length ? (byWord ? t.syncedByWord : t.syncedByLine) : t.lyricsWord}
      {!syncing && lyrics?.fitted && `, ${Math.abs(lyrics.fitted.scale - 1) < 0.005 ? t.lyricsShifted(lyrics.fitted.shift) : t.lyricsStretched(lyrics.fitted.scale)}`}
      {" · "}
      <button type="button" className="underline-offset-2 hover:text-text hover:underline" onClick={() => void call("shell:open", src.url)}>
        {src.name}
      </button>
    </>
  );
}

/** The panel's footer: the source of the words on show. */
function PanelCredit({ track }: { track: Track }) {
  const q = useShownLyrics(track);
  if (!q.data) return null;
  return (
    <p className="px-4 py-2 font-type text-[0.65rem] text-muted/70">
      <LyricsSource lyrics={q.data} syncing={q.syncing} />
    </p>
  );
}

const lyricsOf = (track: Track) => call("lyrics:get", { trackId: track.id, artist: track.artist, title: track.title, durationMs: track.durationMs });

/** The words of a track (cached for the session; the panel and the full screen player share them). */
export function useLyrics(track: Track | null) {
  return useQuery({
    enabled: !!track,
    queryKey: key(track?.id ?? 0),
    queryFn: () => lyricsOf(track!),
    staleTime: Infinity,
    retry: 1,
  });
}

/** What Auto-sync is asked for these words in this upload: plain words to place, or a source's lines to check. */
function syncRequest(l: Lyrics | null | undefined, soundId: number): SyncRequest | null {
  if (!l) return null;
  const timed = l.synced?.filter((x) => x.text.trim()) ?? [];
  const words = timed.length ? timed.map((x) => x.text).join("\n") : l.plain;
  if (!words) return null;
  return { trackId: soundId, source: l.source ?? "lrclib", lyricsId: l.id, plain: words, ...(timed.length ? { times: timed.map((x) => x.t) } : {}) };
}
const syncKey = (q: SyncRequest | null, model: string | undefined) => ["lyricsSync", model, q?.trackId, q?.source, q?.lyricsId, q?.plain] as const;

/**
 * The words as shown, with Auto-sync on (Settings → Lyrics; lib/lyricsSync), matched against the track that is streamed
 * — a replacement upload when there is one: plain words become synced lines, and a source's synced lines made for
 * another upload (a longer intro) are moved to fit this one when they all run early or late by the same amount.
 */
export function useShownLyrics(track: Track | null) {
  const q = useLyrics(track);
  const sound = useStreamTrack(track);
  const on = useSettings((s) => s.prefs.autoSyncLyrics);
  const ready = useLyricsSync((s) => s.status?.model === "ready");
  const model = useLyricsSync((s) => s.status?.name);
  const l = q.data;
  const req = on && ready && sound ? syncRequest(l, sound.id) : null;
  const sync = useQuery({
    enabled: !!req,
    queryKey: syncKey(req, model),
    queryFn: ({ signal }) => syncLyrics(req!, signal),
    staleTime: Infinity,
    retry: false,
  });
  useSyncNext(on && ready && !!req && !sync.isFetching, model);
  let data = l;
  const r = req ? sync.data : null;
  if (l && r && "lines" in r) data = { ...l, synced: r.lines, aligned: true };
  // moving lines by under a second is how exactly the sound is measured, not a different upload
  else if (l?.synced && r && "shift" in r && largestMove(r, (sound?.durationMs ?? 0) / 1000) >= 1) {
    const at = (t: number) => r.scale * t + r.shift;
    data = { ...l, fitted: r, synced: l.synced.map((x) => ({ ...x, t: at(x.t), ...(x.words ? { words: x.words.map((w) => ({ ...w, t: at(w.t), end: at(w.end) })) } : {}) })) };
  }
  return { ...q, data, syncing: !!req && sync.isFetching };
}

/**
 * While the words are on screen and this track is done, the next one in the queue is prepared: its words fetched and
 * synced, so they are ready when it starts. Not for a replacement upload (which one plays is decided when it starts).
 */
function useSyncNext(go: boolean, model: string | undefined) {
  const qc = useQueryClient();
  const next = usePlayer((s) => s.queue[s.index + 1] ?? null);
  useEffect(() => {
    if (!go || !next || next.playability !== "ok") return;
    const stop = new AbortController();
    void (async () => {
      const l = await qc.fetchQuery({ queryKey: key(next.id), queryFn: () => lyricsOf(next), staleTime: Infinity });
      const req = syncRequest(l, next.id);
      if (req && !stop.signal.aborted) await qc.prefetchQuery({ queryKey: syncKey(req, model), queryFn: ({ signal }) => syncLyrics(req, signal), staleTime: Infinity });
    })().catch(() => undefined);
    return () => stop.abort();
  }, [go, next, qc, model]);
}

/** Synced words: the line being sung is lit and kept in view; a click on a line jumps there. */
function SyncedLines({ lines }: { lines: NonNullable<Lyrics["synced"]> }) {
  const position = usePosition((s) => s.position);
  const box = useRef<HTMLOListElement>(null);
  const userScroll = useRef(0);
  // the last line that has started (a small lead so the light comes with the voice, not after it)
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i]!.t <= position + 0.25) at = i;
  else break;

  useEffect(() => {
    if (at < 0 || Date.now() - userScroll.current < 4000) return;
    const row = box.current?.children[at] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [at]);

  return (
    <ol ref={box} onWheel={() => (userScroll.current = Date.now())} className="space-y-1 px-4 pb-24 pt-2">
      {lines.map((l, i) => (
        <li key={`${l.t}-${i}`}>
          <button
            type="button"
            onClick={() => player.seek(l.t)}
            className={`w-full rounded-md px-2 py-1 text-left text-[1.05rem] leading-snug transition-colors hover:bg-[var(--row-hover)] ${i === at ? "font-semibold text-glow" : i < at ? "text-muted/70" : "text-text/85"}`}
          >
            {l.text || "♪"}
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Looking for the words by hand when none (or the wrong ones) were found. */
export function ManualSearch({ track, onDone }: { track: Track; onDone: () => void }) {
  const t = useT();
  const client = useQueryClient();
  const [text, setText] = useState(`${track.artist} ${track.title}`.replace(/[([{].*?[)\]}]/g, " ").replace(/\s+/g, " ").trim());
  const [hits, setHits] = useState<LyricsHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setFailed(false);
    try {
      setHits(await call("lyrics:search", text.trim()));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (h: LyricsHit) => {
    setBusy(true);
    try {
      client.setQueryData(key(track.id), await call("lyrics:pick", track.id, h.id));
      onDone();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 pb-6">
      <form onSubmit={search} className="flex gap-2" data-keys-own>
        <label className="field sketch sketch-thin paper-fill flex min-w-0 flex-1 rounded-md">
          <input value={text} onChange={(e) => setText(e.target.value)} aria-label={t.lyricsSearch} placeholder={t.lyricsSearchHint} className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-sm text-text placeholder:text-muted/70" />
        </label>
        <button type="submit" disabled={busy} className="rounded-md px-2 text-muted hover:text-text" aria-label={t.lyricsSearch}>
          <Icon name="search" size={18} />
        </button>
      </form>
      {failed && <p className="mt-3 text-sm text-muted">{t.lyricsOffline}</p>}
      {hits?.length === 0 && <p className="mt-3 text-sm text-muted">{t.nothingFound}</p>}
      <ul className="mt-2">
        {hits?.map((h) => (
          <li key={h.id}>
            <button type="button" disabled={busy} onClick={() => void pick(h)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--row-hover)] disabled:opacity-60">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-text">{h.title}</span>
                <span className="block truncate text-xs text-muted">
                  {h.artist}
                  {h.album && ` · ${h.album}`}
                </span>
              </span>
              {h.synced && <span className="rounded-sm border border-glow/50 px-1 font-type text-[0.6rem] text-glow">{t.lyricsSyncedBadge}</span>}
              <span className="font-type text-xs tabular-nums text-muted">{duration(h.durationMs)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Body({ track }: { track: Track }) {
  const t = useT();
  const [searching, setSearching] = useState(false);
  const q = useShownLyrics(track);
  const l = q.data;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-center justify-between gap-2 px-4 pb-2">
        <p className="min-w-0 truncate font-type text-xs text-muted">{l ? t.lyricsFrom(l.artist, l.title) : track.title}</p>
        {!q.isPending && (
          <button type="button" onClick={() => setSearching((s) => !s)} className="shrink-0 font-type text-xs text-muted underline-offset-2 hover:text-text hover:underline">
            {searching ? t.cancel : l ? t.lyricsWrong : t.lyricsSearch}
          </button>
        )}
      </div>
      {searching ? (
        <ManualSearch track={track} onDone={() => setSearching(false)} />
      ) : q.isPending ? (
        <p className="px-4 font-type text-sm text-muted">{t.loadingMore}</p>
      ) : q.isError ? (
        <div className="px-4 text-sm text-muted">
          <p>{t.lyricsOffline}</p>
          <button type="button" onClick={() => void q.refetch()} className="mt-2 font-type text-xs text-text underline underline-offset-2 hover:text-glow">
            {t.tryAgain}
          </button>
        </div>
      ) : !l ? (
        <p className="px-4 text-sm text-muted">{t.lyricsNone}</p>
      ) : l.instrumental && !l.synced?.length && !l.plain ? (
        <p className="px-4 text-sm text-muted">{t.lyricsInstrumental}</p>
      ) : l.synced?.length ? (
        <SyncedLines lines={l.synced} />
      ) : (
        <p className="whitespace-pre-line px-6 pb-24 text-[1.02rem] leading-relaxed text-text/90">{l.plain}</p>
      )}
    </div>
  );
}

/** The words of the current track, in a panel on the right (where the queue opens). */
export default function LyricsPanel() {
  const t = useT();
  const open = useUi((s) => s.lyricsOpen);
  const close = useUi((s) => s.closeLyrics);
  const track = useCurrentTrack();

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          aria-label={t.lyrics}
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 24, opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onKeyDown={(e) => e.key === "Escape" && close()}
          className="panel absolute bottom-0 right-0 top-0 z-40 flex w-[380px] flex-col shadow-[-8px_0_24px_rgba(0,0,0,0.45)]"
        >
          <MarkerEdge side="left" seed="d" />
          <div className="flex items-center justify-between px-4 pb-1 pt-4">
            <h2 className="display-heading -rotate-1 text-3xl text-text">{t.lyrics.toLowerCase()}</h2>
            <IconButton icon="close" label={t.close} onClick={close} size={16} />
          </div>
          {track ? <Body key={track.id} track={track} /> : <p className="px-4 font-type text-sm text-muted">{t.nothingPlaying}</p>}
          {track && <PanelCredit track={track} />}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
