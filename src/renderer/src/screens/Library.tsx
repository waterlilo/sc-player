import { useMemo, useState } from "react";
import { artwork, type Track } from "@shared/types";
import { useFollowings, usePlaylists } from "@/api/queries";
import PlaylistGrid from "@/components/playlists/PlaylistGrid";
import Icon from "@/components/ui/Icon";
import { Screen, ScreenTitle } from "@/components/ui/Screen";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { useT } from "@/i18n";
import { useVisibleTracks } from "@/lib/hidden";
import { call } from "@/lib/sky";
import { useAuth } from "@/state/auth";
import { useNav } from "@/state/nav";
import { player, useCurrentTrack } from "@/state/player";
import { useSettings } from "@/state/settings";
import { useUi } from "@/state/ui";
import Login from "./Login";

/** Albums from the library (own and liked). */
export function Albums() {
  const t = useT();
  const status = useAuth((s) => s.status);
  const q = usePlaylists("me", status?.mode === "session");
  const albums = useMemo(() => (q.data?.pages.flatMap((p) => p.items) ?? []).filter((p) => p.isAlbum), [q.data]);
  if (!status) return <Loading />;
  if (status.mode !== "session") return <Login />;
  return (
    <Screen label={t.albums}>
      <ScreenTitle meta={albums.length ? String(albums.length) : undefined}>{t.albums.toLowerCase()}</ScreenTitle>
      {q.isPending ? (
        <Loading />
      ) : q.isError && !albums.length ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : albums.length ? (
        <PlaylistGrid playlists={albums} hasMore={q.hasNextPage} loadingMore={q.isFetchingNextPage} onLoadMore={() => void q.fetchNextPage()} />
      ) : (
        <EmptyState caption={q.hasNextPage ? t.loadingMore : t.noAlbums} />
      )}
    </Screen>
  );
}

/** Start a station: the seed track, then tracks like it; the autopilot keeps it going after that. */
export async function startStation(seed: Track) {
  const related = await call("data:related", seed.id);
  player.playFrom([seed, ...related.filter((r) => r.id !== seed.id)], 0, { kind: "static" });
}

/** Stations: endless music from a track — the one playing, or one played lately. */
export function Stations() {
  const t = useT();
  const current = useCurrentTrack();
  const history = useSettings((s) => s.history);
  const toast = useUi((s) => s.showToast);
  const [busy, setBusy] = useState<number | null>(null);
  const seeds = useVisibleTracks(useMemo(() => {
    const seen = new Set<number>();
    return [...(current ? [current] : []), ...history].filter((s) => !seen.has(s.id) && seen.add(s.id)).slice(0, 18);
  }, [current, history]));

  const start = (s: Track) => {
    setBusy(s.id);
    startStation(s)
      .catch(() => toast(t.stationFailed))
      .finally(() => setBusy(null));
  };

  return (
    <Screen label={t.stations}>
      <ScreenTitle>{t.stations.toLowerCase()}</ScreenTitle>
      <p className="-mt-2 mb-6 max-w-xl text-sm text-muted">{t.stationsHint}</p>
      {seeds.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-5 gap-y-7">
          {seeds.map((s) => (
            <button key={s.id} type="button" onClick={() => start(s)} disabled={busy !== null} className="group min-w-0 text-left disabled:opacity-70">
              <span className="relative block aspect-square overflow-hidden rounded-md bg-[var(--paper)] shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
                {s.artworkUrl ? <img src={artwork(s.artworkUrl, "t300x300") ?? undefined} alt="" loading="lazy" className="h-full w-full scale-110 object-cover blur-[2px] brightness-75" draggable={false} /> : <span className="stipple-night block h-full w-full" />}
                <span className="absolute inset-0 grid place-items-center">
                  <span className="grid h-12 w-12 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm">
                    <Icon name="radio" size={22} />
                  </span>
                </span>
                {busy === s.id && <span className="absolute inset-x-0 bottom-0 bg-black/60 py-1 text-center font-type text-[0.7rem] text-white">{t.loadingMore}</span>}
              </span>
              <span className="mt-2 block truncate text-sm font-semibold text-text">{t.stationOf(s.title)}</span>
              <span className="block truncate text-xs text-muted">{t.basedOn(s.artist)}</span>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState caption={t.stationsEmpty} />
      )}
    </Screen>
  );
}

/** The people the account follows. */
export function Following() {
  const t = useT();
  const go = useNav((s) => s.go);
  const status = useAuth((s) => s.status);
  const q = useFollowings("me", status?.mode === "session");
  const users = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  if (!status) return <Loading />;
  if (status.mode !== "session") return <Login />;
  return (
    <Screen label={t.following}>
      <ScreenTitle meta={status.user?.followingsCount ? String(status.user.followingsCount) : undefined}>{t.following.toLowerCase()}</ScreenTitle>
      {q.isPending ? (
        <Loading />
      ) : q.isError && !users.length ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : users.length ? (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-5 gap-y-7">
            {users.map((u) => (
              <button key={u.id} type="button" onClick={() => go({ name: "profile", userId: u.id })} className="group min-w-0 text-center">
                <span className="mx-auto block aspect-square w-full overflow-hidden rounded-full bg-[var(--paper)] shadow-[0_10px_24px_rgba(0,0,0,0.35)] transition-transform group-hover:-translate-y-0.5">
                  {u.avatarUrl ? <img src={artwork(u.avatarUrl, "t300x300") ?? undefined} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false} /> : <span className="stipple-night block h-full w-full" />}
                </span>
                <span className="mt-2 block truncate text-sm font-semibold text-text">{u.username}</span>
                {u.followers !== null && <span className="block truncate text-xs text-muted">{t.followers(u.followers.toLocaleString("en-US"))}</span>}
              </button>
            ))}
          </div>
          {q.hasNextPage && (
            <div className="mt-8 text-center">
              <button type="button" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} className="sketch sketch-thin rounded-md px-4 py-1.5 text-sm text-text">
                {q.isFetchingNextPage ? t.loadingMore : t.showMore}
              </button>
            </div>
          )}
        </>
      ) : (
        <EmptyState caption={t.noFollowing} />
      )}
    </Screen>
  );
}
