import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Lyrics, LyricsHit, Track } from "@shared/types";
import { useT } from "@/i18n";
import { duration } from "@/lib/format";
import { call } from "@/lib/sky";
import { player, useCurrentTrack, usePosition } from "@/state/player";
import { useUi } from "@/state/ui";
import { IconButton } from "../ui/Buttons";
import MarkerEdge from "../deco/MarkerEdge";
import Icon from "../ui/Icon";

const key = (id: number) => ["lyrics", id] as const;

/** The words of a track (cached for the session; the panel and the full screen player share them). */
export function useLyrics(track: Track | null) {
  return useQuery({
    enabled: !!track,
    queryKey: key(track?.id ?? 0),
    queryFn: () => call("lyrics:get", { trackId: track!.id, artist: track!.artist, title: track!.title, durationMs: track!.durationMs }),
    staleTime: Infinity,
    retry: 1,
  });
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
function ManualSearch({ track, onDone }: { track: Track; onDone: () => void }) {
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
  const q = useLyrics(track);
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
          <p className="px-4 py-2 font-type text-[0.65rem] text-muted/70">{t.lyricsCredit}</p>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
