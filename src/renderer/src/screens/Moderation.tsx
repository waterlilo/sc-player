import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { LyricsForReview } from "@shared/types";
import { Screen } from "@/components/ui/Screen";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { tryWithSong, useDecide, useLyricsQueue } from "@/components/settings/LyricsReview";
import { dateLocale, useT } from "@/i18n";
import { duration } from "@/lib/format";
import { useModRoles } from "@/lib/moderation";
import { errorCode } from "@/lib/sky";
import { useUi } from "@/state/ui";

/** when it was sent: a day and a time */
const sentAt = (ms: number) => new Date(ms).toLocaleString(dateLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const stamp = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The words as sent, each line with its time: a first look before trying them with the song. */
function Words({ r }: { r: LyricsForReview }) {
  const lines = r.lyrics.synced ?? [];
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

function Item({ r }: { r: LyricsForReview }) {
  const t = useT();
  const client = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const { busy, decide } = useDecide();
  const [open, setOpen] = useState(false);

  const tryIt = async () => {
    const ok = await tryWithSong(r, (l) => client.setQueryData(["lyrics", r.track], l)).catch(() => false);
    if (!ok) toast(t.trackGone);
  };

  return (
    <li className={`rounded-md bg-white/[0.035] p-3 ${busy === r.id ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-text">{r.title}</span>
            {r.replaces && <span className="shrink-0 font-type text-xs text-glow">{t.lyricsReplaces}</span>}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {r.artist}
            {r.durationMs > 0 && ` · ${duration(r.durationMs)}`} · {t.lyricsLines(r.lyrics.synced?.length ?? 0)} · {sentAt(r.created)}
          </p>
          <p className="mt-0.5 break-words text-xs text-text/80">{t.lyricsSentBy(r.by || t.someone, r.byCode)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={() => setOpen((o) => !o)} className="s-btn">
            {open ? t.lyricsHide : t.lyricsShow}
          </button>
          <button type="button" onClick={() => void tryIt()} className="s-btn">
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
      {open && <Words r={r} />}
    </li>
  );
}

/**
 * The lyrics moderator's tab (only with a key that may review lyrics): what people timed and sent for everyone,
 * the oldest first. Each can be read here, tried with its song in the full screen player, approved or rejected.
 */
export default function Moderation() {
  const t = useT();
  const roles = useModRoles();
  const q = useLyricsQueue(roles.lyrics);

  return (
    <Screen label={t.moderation}>
      <header className="mb-5">
        <h1 className="display-heading text-5xl leading-none text-text">{t.moderation.toLowerCase()}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{t.moderationHint}</p>
      </header>
      <h2 className="mb-3 text-sm font-semibold text-text">
        {t.lyricsReview}
        {!!q.data?.length && <span className="ml-2 font-type text-xs text-muted">{q.data.length}</span>}
      </h2>
      {!roles.lyrics ? (
        <EmptyState caption={t.moderatorWrong} />
      ) : q.isPending ? (
        <Loading />
      ) : q.isError ? (
        // a key the server no longer takes is "not found" there
        ["unauthorized", "not_found"].includes(errorCode(q.error)) ? (
          <EmptyState caption={t.moderatorWrong} />
        ) : (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        )
      ) : !q.data.length ? (
        <EmptyState caption={t.lyricsReviewEmpty} />
      ) : (
        <ul className="flex flex-col gap-3">
          {q.data.map((r) => (
            <Item key={r.id} r={r} />
          ))}
        </ul>
      )}
    </Screen>
  );
}
