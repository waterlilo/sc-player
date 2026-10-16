import { useMemo } from "react";
import type { QueueSource } from "@shared/types";
import { useLikes } from "@/api/queries";
import ListFilter, { useListFilter } from "@/components/tracks/ListFilter";
import TrackList from "@/components/tracks/TrackList";
import { Screen, ScreenTitle } from "@/components/ui/Screen";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { useT } from "@/i18n";
import { useAuth } from "@/state/auth";
import Login from "./Login";

/** Likes of a user ("me" = the signed-in account), as a track list that pages in while scrolling. */
export function LikesList({ userId, label }: { userId: number | "me"; label: string }) {
  const t = useT();
  const q = useLikes(userId);
  const tracks = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const cursor = q.data?.pages[q.data.pages.length - 1]?.next ?? null;
  const source = useMemo<QueueSource>(() => ({ kind: "likes", userId, cursor }), [userId, cursor]);
  const f = useListFilter(`likes:${userId}`, tracks, source, { hasMore: !!q.hasNextPage, loadingMore: q.isFetchingNextPage, loadMore: () => void q.fetchNextPage() });

  if (q.isPending) return <Loading />;
  if (q.isError && !tracks.length) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!tracks.length) return <EmptyState caption={t.emptyLikes} />;
  return (
    <>
      <ListFilter f={f} count={f.tracks.length} />
      {f.tracks.length ? (
        <TrackList tracks={f.tracks} source={f.source} hasMore={!f.active && q.hasNextPage} loadingMore={q.isFetchingNextPage} onLoadMore={() => void q.fetchNextPage()} label={label} />
      ) : (
        <EmptyState caption={f.loadingAll ? t.loadingAll : t.nothingFound} />
      )}
      {q.isFetchNextPageError && <ErrorState compact error={q.error} onRetry={() => void q.fetchNextPage()} />}
    </>
  );
}

export default function Likes() {
  const t = useT();
  const status = useAuth((s) => s.status);
  if (!status) return <Loading />;
  if (status.mode !== "session") return <Login />;
  return (
    <Screen label={t.likes}>
      <ScreenTitle meta={status.user?.likesCount ? t.tracks(status.user.likesCount) : undefined}>{t.likes.toLowerCase()}</ScreenTitle>
      <LikesList userId="me" label={t.likes} />
    </Screen>
  );
}
