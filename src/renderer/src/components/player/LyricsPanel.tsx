import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { largestMove } from "@shared/fitTiming";
import type { Lyrics, LyricsHit, SyncRequest, Track } from "@shared/types";
import { useT } from "@/i18n";
import { duration } from "@/lib/format";
import { currentTime } from "@/audio/engine";
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
  own: { name: "", url: "" },
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
      {src.url ? (
        <button type="button" className="underline-offset-2 hover:text-text hover:underline" onClick={() => void call("shell:open", src.url)}>
          {src.name}
        </button>
      ) : (
        t.lyricsOwnSource
      )}
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
  // one's own words timed by hand are kept as they are
  if (l.source === "own" && l.synced?.length) return null;
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

/** A time as LRC writes it: "[01:23.45]". */
const lrcTime = (t: number) => `[${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(2).padStart(5, "0")}]`;

/** Words as the user would type them back: timed lines in LRC form ("[01:23.45] …"), else plain lines. */
function asText(l: Lyrics): string {
  return l.synced?.length && !l.aligned ? l.synced.map((x) => `${lrcTime(x.t)} ${x.text}`).join("\n") : (l.plain ?? "");
}

/** The lines of pasted words, without any times they carry. */
const linesOf = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.replace(/\[[^\]]*\]/g, "").trim())
    .filter(Boolean);

// a tap comes a little after the voice: the line is put this much earlier
const TAP_LEAD = 0.15;

/**
 * Timing one's own words by tapping: the song plays from the start and Space (or the button) marks where each line
 * begins; Backspace takes the last mark back and goes a few seconds back. The result is the words in LRC form.
 */
function TapSync({ lines, onCancel, onDone }: { lines: string[]; onCancel: () => void; onDone: (lrc: string) => void }) {
  const t = useT();
  const [times, setTimes] = useState<number[]>([]);
  const [started, setStarted] = useState(false);
  const box = useRef<HTMLOListElement>(null);
  const done = times.length >= lines.length;

  const start = () => {
    setTimes([]);
    setStarted(true);
    player.seek(0);
    void player.play();
  };
  const tap = () => {
    if (!started) return start();
    // never before the line above: the lines keep their order
    setTimes((x) => (x.length >= lines.length ? x : [...x, Math.max(0, x[x.length - 1] ?? 0, currentTime() - TAP_LEAD)]));
  };
  const undo = () => {
    setTimes((x) => {
      const last = x[x.length - 1];
      if (last !== undefined) player.seek(Math.max(0, x[x.length - 2] ?? 0, last - 3));
      return x.slice(0, -1);
    });
  };

  // the window's own keys (Space pauses) wait while tapping
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.code === "Space" || e.code === "Enter" ? "tap" : e.code === "Backspace" ? "undo" : e.code === "Escape" ? "cancel" : null;
      if (!k) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (k === "tap") tap();
      else if (k === "undo") undo();
      else onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  useEffect(() => {
    const row = box.current?.children[Math.min(times.length, lines.length - 1)] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [times.length, lines.length]);

  return (
    <div className="mt-4" data-keys-own>
      <p className="font-type text-xs text-muted">{t.tapSyncHint}</p>
      <ol ref={box} className="mt-3 max-h-[42vh] space-y-0.5 overflow-y-auto rounded-md bg-white/[0.03] p-2">
        {lines.map((l, i) => (
          <li key={i} className={`flex gap-3 rounded px-2 py-1 text-sm ${i === times.length && started ? "bg-white/[0.08] font-semibold text-text" : i < times.length ? "text-muted" : "text-text/70"}`}>
            <span className="w-12 shrink-0 font-type text-xs tabular-nums leading-5 text-muted">{times[i] !== undefined ? lrcTime(times[i]).slice(1, -1) : ""}</span>
            <span className="min-w-0">{l}</span>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="mr-auto font-type text-xs text-muted">{done ? t.tapDone(lines.length) : started ? t.tapProgress(times.length + 1, lines.length) : ""}</span>
        <button type="button" onClick={onCancel} className="s-btn">
          {t.cancel}
        </button>
        {started && (
          <button type="button" disabled={!times.length} onClick={undo} className="s-btn">
            {t.tapUndo}
          </button>
        )}
        {done ? (
          <>
            <button type="button" onClick={start} className="s-btn">
              {t.tapRestart}
            </button>
            <button type="button" onClick={() => onDone(lines.map((l, i) => `${lrcTime(times[i]!)} ${l}`).join("\n"))} className="s-btn pri">
              {t.lyricsOwnSave}
            </button>
          </>
        ) : (
          <button type="button" onPointerDown={(e) => (e.preventDefault(), tap())} className="s-btn pri min-w-24">
            {started ? t.tap : t.tapStart}
          </button>
        )}
      </div>
    </div>
  );
}

/** The user's own words for a track: pasted here, kept on this computer, shown instead of anything found. */
function OwnWords({ track, onDone }: { track: Track; onDone: () => void }) {
  const t = useT();
  const client = useQueryClient();
  const current = useLyrics(track).data;
  const mine = current?.source === "own";
  const [open, setOpen] = useState(mine);
  const [text, setText] = useState(() => (mine && current ? asText(current) : ""));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tapping, setTapping] = useState(false);

  const save = async (words: string | null) => {
    setBusy(true);
    setFailed(false);
    try {
      const l = await call("lyrics:setOwn", { trackId: track.id, artist: track.artist, title: track.title }, words);
      if (l) client.setQueryData(key(track.id), l);
      else await client.invalidateQueries({ queryKey: key(track.id) });
      onDone();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (tapping)
    return (
      <TapSync
        lines={linesOf(text)}
        onCancel={() => setTapping(false)}
        onDone={(lrc) => {
          setText(lrc);
          setTapping(false);
          void save(lrc);
        }}
      />
    );
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-4 font-type text-xs text-muted underline-offset-2 hover:text-text hover:underline">
        {t.lyricsOwn}
      </button>
    );
  return (
    <div className="mt-4" data-keys-own>
      <p className="font-type text-xs text-muted">{t.lyricsOwnHint}</p>
      <label className="field sketch sketch-thin paper-fill mt-2 flex rounded-md">
        <textarea
          autoFocus={!mine}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={30_000}
          rows={10}
          aria-label={t.lyricsOwn}
          className="min-w-0 flex-1 resize-y bg-transparent px-2.5 py-2 text-sm leading-relaxed text-text"
        />
      </label>
      {failed && <p className="mt-2 text-sm text-muted">{t.lyricsOffline}</p>}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        <button type="button" disabled={busy || linesOf(text).length < 2} onClick={() => setTapping(true)} className="s-btn mr-auto" title={t.tapSyncTitle}>
          {t.tapSync}
        </button>
        {mine && (
          <button type="button" disabled={busy} onClick={() => void save(null)} className="s-btn">
            {t.lyricsOwnBack}
          </button>
        )}
        <button type="button" disabled={busy || !text.trim()} onClick={() => void save(text)} className="s-btn pri disabled:opacity-50">
          {t.lyricsOwnSave}
        </button>
      </div>
    </div>
  );
}

/** Looking for the words by hand when none (or the wrong ones) were found, or pasting one's own. */
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
      <OwnWords track={track} onDone={onDone} />
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
