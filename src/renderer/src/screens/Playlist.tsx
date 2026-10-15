import { useMemo } from "react";
import { artwork, type QueueSource } from "@shared/types";
import { usePlaylist, usePlaylistTracks } from "@/api/queries";
import TrackList from "@/components/tracks/TrackList";
import { MarkerButton, PaperButton } from "@/components/ui/Buttons";
import Icon from "@/components/ui/Icon";
import { Screen } from "@/components/ui/Screen";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { useT } from "@/i18n";
import { duration } from "@/lib/format";
import { call } from "@/lib/sky";
import { useNav } from "@/state/nav";
import { player } from "@/state/player";

export default function Playlist({ id }: { id: string }) {
  const t = useT();
  const go = useNav((s) => s.go);
  const meta = usePlaylist(id);
  const q = usePlaylistTracks(id);
  const tracks = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const cursor = q.data?.pages[q.data.pages.length - 1]?.next ?? null;
  const source = useMemo<QueueSource>(() => ({ kind: "playlist", playlistId: id, cursor }), [id, cursor]);
  const p = meta.data;
  const firstPlayable = Math.max(0, tracks.findIndex((x) => x.playability === "ok" || x.playability === "preview"));

  return (
    <Screen label={p?.title ?? t.playlist}>
      {meta.isError && !p ? (
        <ErrorState error={meta.error} onRetry={() => void meta.refetch()} />
      ) : (
        <header className="mb-6 flex items-end gap-6">
          <div className="paper-fill tape relative h-44 w-44 shrink-0 -rotate-2 rounded-md p-2">
            <div className="card-frame" aria-hidden="true" />
            <div className="h-full w-full overflow-hidden rounded-sm bg-[var(--sky)]">
              {p?.artworkUrl && <img src={artwork(p.artworkUrl, "t500x500") ?? undefined} alt="" className="h-full w-full object-cover" draggable={false} />}
            </div>
          </div>
          <div className="min-w-0 pb-1">
            <div className="font-type text-xs uppercase tracking-[0.2em] text-muted">
              {p?.isAlbum ? t.album : t.playlist}
              {p?.isAlbum && p.releaseDate && <span> · {new Date(p.releaseDate).getFullYear()}</span>}
              {p?.genre && <span> · {p.genre}</span>}
            </div>
            <h1 className="display-heading my-1 line-clamp-2 min-h-[2.5rem] text-4xl leading-tight text-text">{p?.title}</h1>
            {p && (
              <div className="flex flex-wrap items-center gap-x-2 font-type text-sm text-muted">
                <button type="button" className="hover:text-text hover:underline" onClick={() => go({ name: "profile", userId: p.user.id })}>
                  {p.user.username}
                </button>
                <span>·</span>
                <span>{t.tracks(p.trackCount)}</span>
                {p.durationMs > 0 && (
                  <>
                    <span>·</span>
                    <span>{duration(p.durationMs)}</span>
                  </>
                )}
              </div>
            )}
            <div className="mt-4 flex gap-3">
              <MarkerButton disabled={!tracks.length} onClick={() => player.playFrom(tracks, firstPlayable, source)}>
                <Icon name="play" size={18} /> {t.playAll}
              </MarkerButton>
              <PaperButton disabled={!tracks.length} onClick={() => player.shuffleFrom(tracks, source)}>
                <Icon name="shuffle" size={18} /> {t.shuffleAll}
              </PaperButton>
              {p?.permalinkUrl && (
                <PaperButton aria-label={t.openOnSoundCloud} title={t.openOnSoundCloud} onClick={() => void call("shell:open", p.permalinkUrl)}>
                  <Icon name="external" size={18} />
                </PaperButton>
              )}
            </div>
          </div>
        </header>
      )}
      {q.isPending ? (
        <Loading />
      ) : q.isError && !tracks.length ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !tracks.length ? (
        <EmptyState caption={t.emptyPlaylists} />
      ) : (
        <TrackList tracks={tracks} source={source} hasMore={q.hasNextPage} loadingMore={q.isFetchingNextPage} onLoadMore={() => void q.fetchNextPage()} label={p?.title ?? t.playlist} />
      )}
    </Screen>
  );
}
