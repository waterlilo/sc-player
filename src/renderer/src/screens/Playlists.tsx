import { useMemo } from "react";
import { usePlaylists } from "@/api/queries";
import PlaylistGrid from "@/components/playlists/PlaylistGrid";
import Chip from "@/components/ui/Chip";
import { Screen, ScreenTitle } from "@/components/ui/Screen";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { useT } from "@/i18n";
import { useAuth } from "@/state/auth";
import { useViewState } from "@/state/viewState";
import Login from "./Login";

type Filter = "all" | "mine" | "liked" | "albums";

/** Playlists and albums of a user, own and liked, filtered by torn-paper chips. */
export function PlaylistsView({ userId }: { userId: number | "me" }) {
  const t = useT();
  const q = usePlaylists(userId);
  const [filter, setFilter] = useViewState<Filter>(`filter:${userId}`, "all");
  const all = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const shown = useMemo(
    () => all.filter((p) => (filter === "all" ? true : filter === "mine" ? p.relation === "own" : filter === "liked" ? p.relation === "liked" : p.isAlbum)),
    [all, filter],
  );

  if (q.isPending) return <Loading />;
  if (q.isError && !all.length) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!all.length) return <EmptyState caption={t.emptyPlaylists} />;
  const filters: [Filter, string][] = [
    ["all", t.all],
    ["mine", t.mine],
    ["liked", t.liked],
    ["albums", t.albums],
  ];
  return (
    <>
      <div role="tablist" className="mb-4 flex flex-wrap gap-2">
        {filters.map(([key, label], i) => (
          <Chip key={key} index={i} active={filter === key} onClick={() => setFilter(key)}>
            {label}
          </Chip>
        ))}
      </div>
      <PlaylistGrid playlists={shown} hasMore={q.hasNextPage} loadingMore={q.isFetchingNextPage} onLoadMore={() => void q.fetchNextPage()} />
      {q.isFetchNextPageError && <ErrorState compact error={q.error} onRetry={() => void q.fetchNextPage()} />}
    </>
  );
}

export default function Playlists() {
  const t = useT();
  const status = useAuth((s) => s.status);
  if (!status) return <Loading />;
  if (status.mode !== "session") return <Login />;
  return (
    <Screen label={t.playlists}>
      <ScreenTitle>{t.playlists.toLowerCase()}</ScreenTitle>
      <PlaylistsView userId="me" />
    </Screen>
  );
}
