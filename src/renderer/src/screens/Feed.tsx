import { useMemo } from "react";
import type { QueueSource } from "@shared/types";
import { useFeed } from "@/api/queries";
import TrackList from "@/components/tracks/TrackList";
import { Screen, ScreenTitle } from "@/components/ui/Screen";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { useT } from "@/i18n";
import { useAuth } from "@/state/auth";
import Login from "./Login";

/** New tracks and reposts from the people the user follows, newest first; plays on into older ones. */
export default function Feed() {
  const t = useT();
  const status = useAuth((s) => s.status);
  const signedIn = status?.mode === "session";
  const q = useFeed(signedIn);
  const tracks = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const cursor = q.data?.pages[q.data.pages.length - 1]?.next ?? null;
  const source = useMemo<QueueSource>(() => ({ kind: "feed", cursor }), [cursor]);

  if (!status) return <Loading />;
  if (!signedIn) return <Login />;
  return (
    <Screen label={t.feed}>
      <ScreenTitle meta={t.feedHint}>{t.feed.toLowerCase()}</ScreenTitle>
      {q.isPending ? (
        <Loading />
      ) : q.isError && !tracks.length ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !tracks.length ? (
        <EmptyState caption={t.emptyFeed} />
      ) : (
        <>
          <TrackList tracks={tracks} source={source} hasMore={q.hasNextPage} loadingMore={q.isFetchingNextPage} onLoadMore={() => void q.fetchNextPage()} label={t.feed} />
          {q.isFetchNextPageError && <ErrorState compact error={q.error} onRetry={() => void q.fetchNextPage()} />}
        </>
      )}
    </Screen>
  );
}
