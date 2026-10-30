import { useMemo } from "react";
import type { QueueSource } from "@shared/types";
import { useLikes } from "@/api/queries";
import ListFilter, { useListFilter } from "@/components/tracks/ListFilter";
import TrackList from "@/components/tracks/TrackList";
import { PaperButton } from "@/components/ui/Buttons";
import { Screen, ScreenTitle } from "@/components/ui/Screen";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { useT } from "@/i18n";
import { useAuth } from "@/state/auth";
import { useLikes as useLikedSet } from "@/state/likes";
import { useNav } from "@/state/nav";
import { useSettings } from "@/state/settings";
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
  // likes kept on this computer: the page works signed out too
  const local = useSettings((s) => s.prefs.localLikes);
  const count = useLikedSet((s) => (s.ready ? s.ids.size : 0));
  if (!status) return <Loading />;
  if (status.mode !== "session" && !local) return <Login />;
  const n = local ? count : status.user?.likesCount;
  return (
    <Screen label={t.likes}>
      <ScreenTitle meta={n ? t.tracks(n) : undefined}>{t.likes.toLowerCase()}</ScreenTitle>
      {status.mode !== "session" && (
        // signed out, the page still works (likes on this computer): the way to the account stays in sight
        <div className="mb-4 flex items-center gap-3 font-type text-sm text-muted">
          <span>{t.likesSignedOut}</span>
          <PaperButton onClick={() => useNav.getState().open("signin", { name: "signin" })}>{t.signIn}</PaperButton>
        </div>
      )}
      <LikesList userId="me" label={t.likes} />
    </Screen>
  );
}
