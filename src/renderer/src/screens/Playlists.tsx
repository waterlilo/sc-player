import { useMemo, useState } from "react";
import { usePlaylists } from "@/api/queries";
import NewPlaylist from "@/components/playlists/NewPlaylist";
import PlaylistGrid from "@/components/playlists/PlaylistGrid";
import { PaperButton } from "@/components/ui/Buttons";
import Icon from "@/components/ui/Icon";
import Tabs from "@/components/ui/Tabs";
import { Screen, ScreenTitle } from "@/components/ui/Screen";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { useT } from "@/i18n";
import { useAuth } from "@/state/auth";
import { useNav } from "@/state/nav";
import { useViewState } from "@/state/viewState";

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
      <Tabs options={filters} value={filter} onChange={setFilter} className="mb-4" />
      <PlaylistGrid playlists={shown} hasMore={q.hasNextPage} loadingMore={q.isFetchingNextPage} onLoadMore={() => void q.fetchNextPage()} />
      {q.isFetchNextPageError && <ErrorState compact error={q.error} onRetry={() => void q.fetchNextPage()} />}
    </>
  );
}

/** Your playlists: SoundCloud's when signed in (and any kept on this computer), only this computer's otherwise. */
export default function Playlists() {
  const t = useT();
  const go = useNav((s) => s.go);
  const status = useAuth((s) => s.status);
  const [making, setMaking] = useState(false);
  if (!status) return <Loading />;
  return (
    <Screen label={t.playlists}>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <ScreenTitle>{t.playlists.toLowerCase()}</ScreenTitle>
        <PaperButton className="ml-auto" aria-expanded={making} onClick={() => setMaking((v) => !v)}>
          <Icon name="plus" size={16} /> {t.newPlaylist}
        </PaperButton>
      </div>
      {making && <NewPlaylist className="mb-4 max-w-md" onMade={(p) => go({ name: "playlist", id: p.id })} />}
      <p className="mb-4 max-w-xl text-sm text-muted">{t.localPlaylistsHint}</p>
      <PlaylistsView userId="me" />
    </Screen>
  );
}
