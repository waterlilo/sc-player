import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Lyrics, LyricsDecided, LyricsForReview } from "@shared/types";
import { Screen } from "@/components/ui/Screen";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import Tabs from "@/components/ui/Tabs";
import { tryWithSong, useDecide, useLyricsQueue } from "@/components/settings/LyricsReview";
import { dateLocale, useT } from "@/i18n";
import { duration } from "@/lib/format";
import { useModRoles } from "@/lib/moderation";
import { call, errorCode } from "@/lib/sky";
import { useUi } from "@/state/ui";

type Tab = "queue" | "history";

/** a day and a time */
const at = (ms: number) => new Date(ms).toLocaleString(dateLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const stamp = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The words as sent, each line with its time: a first look before trying them with the song. */
function Words({ lyrics }: { lyrics: Lyrics }) {
  const lines = lyrics.synced ?? [];
  return (
    <ol className="mt-3 max-h-80 overflow-y-auto rounded-md bg-black/20 px-3 py-2 text-sm leading-relaxed">
      {lines.map((l, i) => (
        <li key={i} className="flex gap-3">
          <span className="w-10 shrink-0 text-right font-type text-xs tabular-nums leading-relaxed text-muted">{stamp(l.t)}</span>
          <span className={`min-w-0 break-words ${l.text.trim() ? "text-text/90" : "text-muted/60"}`}>{l.text.trim() || "♪"}</span>
        </li>
      ))}
    </ol>
  );
}

/** What both lists show of sent lyrics: the track, how long, how many lines, who sent them and when. */
function About({ r }: { r: LyricsForReview | LyricsDecided }) {
  const t = useT();
  return (
    <>
      <p className="mt-0.5 text-xs text-muted">
        {r.artist}
        {r.durationMs > 0 && ` · ${duration(r.durationMs)}`} · {t.lyricsLines(r.lyrics.synced?.length ?? 0)} · {at(r.created)}
      </p>
      <p className="mt-0.5 break-words text-xs text-text/80">{t.lyricsSentBy(r.by || t.someone, r.byCode)}</p>
    </>
  );
}

function useTry() {
  const t = useT();
  const client = useQueryClient();
  const toast = useUi((s) => s.showToast);
  return async (r: LyricsForReview) => {
    const ok = await tryWithSong(r, (l) => client.setQueryData(["lyrics", r.track], l)).catch(() => false);
    if (!ok) toast(t.trackGone);
  };
}

function Item({ r }: { r: LyricsForReview }) {
  const t = useT();
  const tryIt = useTry();
  const { busy, decide } = useDecide();
  const [open, setOpen] = useState(false);

  return (
    <li className={`rounded-md bg-white/[0.035] p-3 ${busy === r.id ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-text">{r.title}</span>
            {r.replaces && <span className="shrink-0 font-type text-xs text-glow">{t.lyricsReplaces}</span>}
          </div>
          <About r={r} />
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={() => setOpen((o) => !o)} className="s-btn">
            {open ? t.lyricsHide : t.lyricsShow}
          </button>
          <button type="button" onClick={() => void tryIt(r)} className="s-btn">
            {t.lyricsTry}
          </button>
          <button type="button" disabled={busy === r.id} onClick={() => void decide(r, false)} className="s-btn">
            {t.lyricsReject}
          </button>
          <button type="button" disabled={busy === r.id} onClick={() => void decide(r, true)} className="s-btn pri">
            {t.lyricsApprove}
          </button>
        </div>
      </div>
      {open && <Words lyrics={r.lyrics} />}
    </li>
  );
}

/** One decision in the history: what became of the lyrics, which moderator decided and when. */
function Decided({ r }: { r: LyricsDecided }) {
  const t = useT();
  const tryIt = useTry();
  const [open, setOpen] = useState(false);
  const words = !!r.lyrics.synced?.length;
  const who = r.moderator || r.moderatorCode ? t.reportedBy(r.moderator, r.moderatorCode) : t.keyKind(r.key);
  const tone = r.status === "rejected" ? "text-blood" : r.status === "approved" ? "text-glow" : "text-muted";

  return (
    <li className="rounded-md bg-white/[0.035] p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-text">{r.title}</span>
            <span className={`shrink-0 font-type text-xs ${tone}`}>{t.decided[r.status]}</span>
          </div>
          <About r={r} />
          <p className="mt-0.5 break-words text-xs text-muted">
            {t.decidedBy(who)} · {at(r.decided)}
          </p>
        </div>
        {words && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" onClick={() => setOpen((o) => !o)} className="s-btn">
              {open ? t.lyricsHide : t.lyricsShow}
            </button>
            <button type="button" onClick={() => void tryIt({ ...r, replaces: false })} className="s-btn">
              {t.lyricsTry}
            </button>
          </div>
        )}
      </div>
      {open && <Words lyrics={r.lyrics} />}
    </li>
  );
}

/** A list that may fail as a moderator's: a key the server no longer takes is "not found" there. */
function Failed({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useT();
  return ["unauthorized", "not_found"].includes(errorCode(error)) ? <EmptyState caption={t.moderatorWrong} /> : <ErrorState error={error} onRetry={retry} />;
}

function Queue() {
  const t = useT();
  const q = useLyricsQueue();
  if (q.isPending) return <Loading />;
  if (q.isError) return <Failed error={q.error} retry={() => void q.refetch()} />;
  if (!q.data.length) return <EmptyState caption={t.lyricsReviewEmpty} />;
  return (
    <ul className="flex flex-col gap-3">
      {q.data.map((r) => (
        <Item key={r.id} r={r} />
      ))}
    </ul>
  );
}

function History() {
  const t = useT();
  const q = useQuery({ queryKey: ["lyrics-history"], queryFn: () => call("lyrics:history"), staleTime: 30_000 });
  if (q.isPending) return <Loading />;
  if (q.isError) return <Failed error={q.error} retry={() => void q.refetch()} />;
  return (
    <div>
      <p className="mb-4 max-w-2xl text-sm leading-relaxed text-muted">{t.modHistoryHint}</p>
      {!q.data.length ? (
        <EmptyState caption={t.modHistoryEmpty} />
      ) : (
        <ul className="flex flex-col gap-3">
          {q.data.map((r) => (
            <Decided key={r.id} r={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The lyrics moderator's tab (only with a key that may review lyrics): what people timed and sent for everyone,
 * the oldest first — read the words, try them with the song, approve or reject; and the history of what moderators
 * decided over the last week.
 */
export default function Moderation() {
  const t = useT();
  const roles = useModRoles();
  const waiting = useLyricsQueue(roles.lyrics).data?.length ?? 0;
  const [tab, setTab] = useState<Tab>("queue");

  return (
    <Screen label={t.moderation} part={tab}>
      <header className="mb-5">
        <h1 className="display-heading text-5xl leading-none text-text">{t.moderation.toLowerCase()}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{t.moderationHint}</p>
      </header>
      {!roles.lyrics ? (
        <EmptyState caption={t.moderatorWrong} />
      ) : (
        <>
          <Tabs
            options={[
              ["queue", t.modQueue(waiting)],
              ["history", t.modHistory],
            ]}
            value={tab}
            onChange={setTab}
            label={t.moderation}
            className="mb-5"
          />
          {tab === "queue" ? <Queue /> : <History />}
        </>
      )}
    </Screen>
  );
}
