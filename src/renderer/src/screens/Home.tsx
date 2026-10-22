import { useMemo, type ReactNode } from "react";
import { artwork, type Playlist, type Track } from "@shared/types";
import { useFeed, useLikes, usePlaylists } from "@/api/queries";
import TrackList from "@/components/tracks/TrackList";
import Icon, { type IconName } from "@/components/ui/Icon";
import { Screen } from "@/components/ui/Screen";
import { useT } from "@/i18n";
import { useVisibleTracks } from "@/lib/hidden";
import { useAuth } from "@/state/auth";
import { useNav } from "@/state/nav";
import { player, useCurrentTrack, usePlayer, usePosition } from "@/state/player";
import { useSettings } from "@/state/settings";
import { useUi } from "@/state/ui";
import StudioHome from "./StudioHome";

const STATIC = { kind: "static" } as const;

function Cover({ url, size, className = "" }: { url: string | null; size: number; className?: string }) {
  const src = artwork(url, size > 100 ? "t300x300" : "large");
  return (
    <span className={`block shrink-0 overflow-hidden rounded-[5px] bg-[var(--paper)] ${className}`} style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" /> : <span className="stipple-night block h-full w-full" />}
    </span>
  );
}

/** A thin line along the bottom of the "now" tile: how far the track has played. */
function Progress() {
  const position = usePosition((s) => s.position);
  const total = usePlayer((s) => s.duration);
  return (
    <span className="absolute inset-x-3 bottom-0 h-[2px] overflow-hidden rounded-full bg-white/10">
      <span className="block h-full rounded-full bg-glow" style={{ width: `${total ? Math.min(100, (position / total) * 100) : 0}%` }} />
    </span>
  );
}

function RoundPlay({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className="home-play grid h-9 w-9 shrink-0 place-items-center rounded-full"
    >
      <Icon name={active ? "pause" : "play"} size={16} />
    </span>
  );
}

function Tile({ cover, icon, title, sub, onClick, children }: { cover?: string | null; icon?: IconName; title: string; sub: string; onClick: () => void; children?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="home-tile paper-fill group relative flex min-w-0 items-center gap-3 rounded-md p-2.5 pr-3 text-left">
      <div className="card-frame" aria-hidden="true" />
      {icon ? (
        <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[5px] bg-white/[0.06] text-glow">
          <Icon name={icon} size={22} filled={icon === "heart"} />
        </span>
      ) : (
        <Cover url={cover ?? null} size={52} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.95rem] font-semibold text-text">{title}</span>
        <span className="mt-0.5 block truncate font-type text-xs text-muted">{sub}</span>
      </span>
      {children}
    </button>
  );
}

/** What is playing (or was last): a click opens the full screen player, the button plays / pauses. */
function NowTile() {
  const t = useT();
  const current = useCurrentTrack();
  const last = useSettings((s) => s.history[0]);
  const history = useSettings((s) => s.history);
  const status = usePlayer((s) => s.status);
  const index = usePlayer((s) => s.index);
  const total = usePlayer((s) => s.queue.length);
  const openFull = useUi((s) => s.openFull);
  const track = current ?? last;
  if (!track) return null;
  const active = !!current && (status === "playing" || status === "loading");
  return (
    <Tile cover={track.artworkUrl} title={track.title} sub={current ? `${active ? t.nowPlaying : t.paused} · ${t.ofCount(index + 1, total)}` : t.lastPlayed} onClick={() => (current ? openFull() : player.playFrom(history, 0, STATIC))}>
      <RoundPlay active={active} label={active ? t.pause : t.play} onClick={() => (current ? player.toggle() : player.playFrom(history, 0, STATIC))} />
      {current && <Progress />}
    </Tile>
  );
}

function LikesTile() {
  const t = useT();
  const open = useNav((s) => s.open);
  const count = useAuth((s) => s.status?.user?.likesCount ?? 0);
  const q = useLikes("me");
  const tracks = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const cursor = q.data?.pages[q.data.pages.length - 1]?.next ?? null;
  return (
    <Tile icon="heart" title={t.likes} sub={count ? t.tracks(count) : t.yourLikes} onClick={() => open("likes", { name: "likes" })}>
      {tracks.length > 0 && <RoundPlay active={false} label={t.playAll} onClick={() => player.playFrom(tracks, 0, { kind: "likes", userId: "me", cursor })} />}
    </Tile>
  );
}

function PlaylistTile({ playlist }: { playlist: Playlist }) {
  const t = useT();
  const go = useNav((s) => s.go);
  return <Tile cover={playlist.artworkUrl} title={playlist.title} sub={t.tracks(playlist.trackCount)} onClick={() => go({ name: "playlist", id: playlist.id })} />;
}

function Heading({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="mb-3 mt-9 flex items-baseline gap-4">
      <h2 className="home-heading text-xl font-semibold text-text">{title}</h2>
      {action && (
        <button type="button" onClick={onAction} className="ml-auto font-type text-xs text-muted hover:text-text">
          {action}
        </button>
      )}
    </div>
  );
}

/** Recently played, as covers, one row (as many as fit): a click plays from there on through the history. */
function Recent({ tracks }: { tracks: Track[] }) {
  const t = useT();
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playing = usePlayer((s) => s.status === "playing" || s.status === "loading");
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] grid-rows-[auto] gap-x-5 overflow-hidden [grid-auto-rows:0]">
      {tracks.map((track, i) => {
        const on = track.id === currentId;
        return (
          <button
            type="button"
            key={track.id}
            onClick={() => (on ? player.toggle() : player.playFrom(tracks, i, STATIC))}
            aria-label={`${on && playing ? t.pause : t.play}: ${track.title}`}
            className="group min-w-0 text-left"
          >
            <span className="relative block">
              <span className="home-card-cover block aspect-square w-full overflow-hidden rounded-md bg-[var(--paper)] shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
                {track.artworkUrl ? <img src={artwork(track.artworkUrl, "t300x300") ?? undefined} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" /> : <span className="stipple-night block h-full w-full" />}
              </span>
              <span className={`home-play absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full transition-opacity ${on ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}>
                <Icon name={on && playing ? "pause" : "play"} size={16} />
              </span>
            </span>
            <span className={`mt-2 block truncate text-sm font-medium ${on ? "text-glow" : "text-text"}`}>{track.title}</span>
            <span className="block truncate text-xs text-muted">{track.artist}</span>
          </button>
        );
      })}
    </div>
  );
}

function FeedPreview() {
  const t = useT();
  const q = useFeed(true);
  const all = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const tracks = useVisibleTracks(all).slice(0, 6);
  if (!tracks.length) return null;
  return <TrackList tracks={tracks} source={STATIC} label={t.feed} />;
}

function greeting(t: ReturnType<typeof useT>, name: string | undefined) {
  const h = new Date().getHours();
  const hello = h >= 5 && h < 12 ? t.goodMorning : h >= 12 && h < 17 ? t.goodAfternoon : h >= 17 && h < 23 ? t.goodEvening : t.lateNight;
  return name ? `${hello}, ${name}` : hello;
}

/**
 * Home: what is playing, the likes and a few playlists as tiles, then what was played recently, what is new in the
 * feed and the playlists. Signed out, only what this app keeps itself (the history) is there.
 */
function OgHome() {
  const t = useT();
  const open = useNav((s) => s.open);
  const status = useAuth((s) => s.status);
  const signedIn = status?.mode === "session";
  const history = useSettings((s) => s.history);
  const recent = useVisibleTracks(history).slice(0, 12);
  const pq = usePlaylists("me", signedIn);
  const playlists = useMemo(() => pq.data?.pages.flatMap((p) => p.items) ?? [], [pq.data]);
  const own = playlists.filter((p) => p.relation === "own");
  const pinned = (own.length >= 2 ? own : playlists).slice(0, 2);

  return (
    <Screen label={t.home}>
      <header className="mb-6">
        <h1 className="display-heading home-greeting text-4xl leading-tight text-text">{greeting(t, status?.user?.username)}</h1>
      </header>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3">
        <NowTile />
        {signedIn ? (
          <>
            <LikesTile />
            {pinned.map((p) => (
              <PlaylistTile key={p.id} playlist={p} />
            ))}
          </>
        ) : (
          <>
            <Tile icon="search" title={t.search} sub={t.searchHint} onClick={() => open("search", { name: "search" })} />
            <Tile icon="history" title={t.history} sub={t.tracks(history.length)} onClick={() => open("history", { name: "history" })} />
          </>
        )}
      </div>

      {recent.length > 0 && (
        <>
          <Heading title={t.jumpBackIn} action={t.showAll} onAction={() => open("history", { name: "history" })} />
          <Recent tracks={recent} />
        </>
      )}

      {signedIn && (
        <>
          <Heading title={t.newInFeed} action={t.showAll} onAction={() => open("feed", { name: "feed" })} />
          <FeedPreview />
        </>
      )}

      {!signedIn && !recent.length && <p className="mt-10 max-w-md text-sm text-muted">{t.homeEmpty}</p>}
    </Screen>
  );
}

export default function Home() {
  const studio = useSettings((s) => s.prefs.look.design === "studio");
  return studio ? <StudioHome /> : <OgHome />;
}
