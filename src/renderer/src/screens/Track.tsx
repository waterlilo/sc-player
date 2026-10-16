import { useState } from "react";
import { artwork } from "@shared/types";
import { useAlternatives, useRelated, useTrackDetails } from "@/api/queries";
import TrackList from "@/components/tracks/TrackList";
import { MarkerButton, PaperButton } from "@/components/ui/Buttons";
import Icon from "@/components/ui/Icon";
import { Screen } from "@/components/ui/Screen";
import { ErrorState, Loading } from "@/components/ui/States";
import { useT } from "@/i18n";
import { compactNumber, duration } from "@/lib/format";
import { call } from "@/lib/sky";
import { useNav } from "@/state/nav";
import { canPlay, player, usePlayer } from "@/state/player";
import { useUi } from "@/state/ui";

const STATIC = { kind: "static" } as const;
const year = (iso: string | null) => (iso ? new Date(iso).getFullYear() : null);

/** One track: big clean artwork, title, artist, numbers, description and tags, and similar tracks below. */
export default function Track({ id }: { id: number }) {
  const t = useT();
  const go = useNav((s) => s.go);
  const toast = useUi((s) => s.showToast);
  const details = useTrackDetails(id);
  const related = useRelated(id);
  const [more, setMore] = useState(false);
  const current = usePlayer((s) => s.queue[s.index]?.id === id);
  const playing = usePlayer((s) => s.queue[s.index]?.id === id && (s.status === "playing" || s.status === "loading"));
  const d = details.data;
  const protectedTrack = !!d && d.track.playability !== "ok";
  const others = useAlternatives(id, protectedTrack);

  if (details.isPending) return <Loading />;
  if (!d) return <ErrorState error={details.error} onRetry={() => void details.refetch()} />;
  const tr = d.track;
  const stats = [
    d.plays !== null && t.plays(compactNumber(d.plays)),
    d.likes !== null && t.likesCount(compactNumber(d.likes)),
    d.reposts !== null && t.repostsCount(compactNumber(d.reposts)),
    d.comments !== null && t.commentsCount(compactNumber(d.comments)),
  ].filter(Boolean) as string[];
  const meta = [d.genre, year(d.releaseDate ?? d.createdAt), duration(tr.durationMs)].filter(Boolean).join(" · ");
  const unplayable = !canPlay(tr);

  return (
    <Screen label={tr.title}>
      <header className="mb-6 flex items-end gap-6">
        <div className="paper-fill tape relative h-52 w-52 shrink-0 -rotate-2 rounded-md p-2">
          <div className="card-frame" aria-hidden="true" />
          <div className="h-full w-full overflow-hidden rounded-sm bg-[var(--sky)]">
            {tr.artworkUrl && <img src={artwork(tr.artworkUrl, "t500x500") ?? undefined} alt="" className="h-full w-full object-cover" draggable={false} />}
          </div>
        </div>
        <div className="min-w-0 pb-1">
          <div className="font-type text-xs uppercase tracking-[0.2em] text-muted">
            {t.track}
            {tr.playability !== "ok" && <span className="ml-2 rounded-sm border border-current px-1">{t[tr.playability]}</span>}
          </div>
          <h1 className={`display-heading my-1 line-clamp-2 text-4xl leading-tight ${current ? "text-glow" : "text-text"}`}>{tr.title}</h1>
          <button type="button" className="text-lg text-muted hover:text-text hover:underline" onClick={() => go({ name: "profile", userId: tr.user.id })}>
            {tr.artist}
          </button>
          {meta && <div className="mt-1 font-type text-sm text-muted">{meta}</div>}
          {stats.length > 0 && <div className="mt-1 font-type text-xs text-muted">{stats.join(" · ")}</div>}
          <div className="mt-4 flex flex-wrap gap-3">
            <MarkerButton disabled={unplayable} onClick={() => (current ? player.toggle() : player.playFrom([tr], 0, STATIC))}>
              <Icon name={playing ? "pause" : "play"} size={18} /> {playing ? t.pause : t.play}
            </MarkerButton>
            <PaperButton disabled={unplayable} onClick={() => player.playNext(tr)}>
              <Icon name="playNext" size={18} /> {t.playNext}
            </PaperButton>
            <PaperButton disabled={unplayable} onClick={() => player.addToQueue(tr)} aria-label={t.addToQueue} title={t.addToQueue}>
              <Icon name="queue" size={18} />
            </PaperButton>
            <PaperButton aria-label={t.copyLink} title={t.copyLink} onClick={() => void call("clipboard:write", tr.permalinkUrl).then(() => toast(t.linkCopied))}>
              <Icon name="link" size={18} />
            </PaperButton>
            <PaperButton aria-label={t.openOnSoundCloud} title={t.openOnSoundCloud} onClick={() => void call("shell:open", tr.permalinkUrl)}>
              <Icon name="external" size={18} />
            </PaperButton>
          </div>
        </div>
      </header>

      {(d.description || d.tags.length > 0) && (
        <section className="mb-8 max-w-3xl">
          {d.description && (
            <>
              <p className={`whitespace-pre-line text-sm leading-relaxed text-muted ${more ? "" : "line-clamp-4"}`} style={{ userSelect: "text" }}>
                {d.description}
              </p>
              {d.description.length > 280 && (
                <button type="button" onClick={() => setMore((m) => !m)} className="mt-1 font-type text-xs text-muted underline-offset-2 hover:text-text hover:underline">
                  {more ? t.showLess : t.showMore}
                </button>
              )}
            </>
          )}
          {d.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {d.tags.map((tag) => (
                <span key={tag} className="paper-fill torn px-3 py-1 font-type text-xs text-muted">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {protectedTrack && (
        <section className="mb-8">
          <h2 className="display-heading mb-1 -rotate-1 text-3xl text-text">{t.otherUploads}</h2>
          <p className="mb-3 max-w-2xl text-sm text-muted">{t.otherUploadsHint}</p>
          {others.isPending ? (
            <Loading />
          ) : others.data?.length ? (
            <TrackList tracks={others.data} source={STATIC} label={t.otherUploads} />
          ) : (
            <p className="font-type text-sm text-muted">{t.noOtherUploads}</p>
          )}
        </section>
      )}

      <h2 className="display-heading mb-3 -rotate-1 text-3xl text-text">{t.similarTracks}</h2>
      {related.isPending ? (
        <Loading />
      ) : related.isError ? (
        <ErrorState compact error={related.error} onRetry={() => void related.refetch()} />
      ) : (
        <TrackList tracks={related.data} source={STATIC} label={t.similarTracks} />
      )}
    </Screen>
  );
}
