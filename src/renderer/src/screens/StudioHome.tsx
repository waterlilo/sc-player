import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { artwork, type Playlist, type Track } from "@shared/types";
import { useFeed, useLikes, usePlaylists } from "@/api/queries";
import { Avatar, when } from "@/components/social/bits";
import Icon from "@/components/ui/Icon";
import { Screen } from "@/components/ui/Screen";
import { useT } from "@/i18n";
import { duration } from "@/lib/format";
import { useVisibleTracks } from "@/lib/hidden";
import { call } from "@/lib/sky";
import { useAuth } from "@/state/auth";
import { useNav } from "@/state/nav";
import { player, useCurrentTrack, usePlayer, usePosition } from "@/state/player";
import { useSettings } from "@/state/settings";
import { playShared, useSocial } from "@/state/social";
import { useUi } from "@/state/ui";
import { useSourceLabel } from "@/components/studio/Queue";
import { startStation } from "./Library";

type Filter = "all" | "tracks" | "playlists" | "stations";
const STATIC = { kind: "static" } as const;

function Cover({ url, size, round = false }: { url: string | null; size: number | string; round?: boolean }) {
  const src = artwork(url, typeof size === "number" && size <= 60 ? "large" : "t300x300");
  return (
    <span className={`block shrink-0 overflow-hidden bg-white/[0.06] ${round ? "rounded-full" : ""}`} style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" /> : <span className="stipple-night block h-full w-full" />}
    </span>
  );
}

function Pp({ playing, onClick, label, size = 28 }: { playing: boolean; onClick: () => void; label: string; size?: number }) {
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
      className="s-pp shrink-0"
      style={{ width: size, height: size }}
    >
      <Icon name={playing ? "pause" : "play"} size={size * 0.46} />
    </span>
  );
}

function Tile({ cover, title, sub, onClick, children }: { cover: ReactNode; title: string; sub: string; onClick: () => void; children?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="relative flex h-[52px] min-w-0 items-center gap-3 overflow-hidden rounded-[var(--r2)] border border-[var(--s-line)] bg-white/[0.035] pr-3 text-left transition-colors hover:bg-white/[0.06]">
      {cover}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-text">{title}</span>
        <span className="mt-px block truncate text-[11.5px] text-[var(--s-dim)]">{sub}</span>
      </span>
      {children}
    </button>
  );
}

function Bar() {
  const position = usePosition((s) => s.position);
  const total = usePlayer((s) => s.duration);
  return (
    <span className="absolute bottom-0 left-[52px] right-0 h-[2px] bg-white/[0.06]">
      <i className="block h-full bg-[var(--accent)]" style={{ width: `${total ? Math.min(100, (position / total) * 100) : 0}%` }} />
    </span>
  );
}

function NowTile() {
  const t = useT();
  const current = useCurrentTrack();
  const history = useSettings((s) => s.history);
  const status = usePlayer((s) => s.status);
  const index = usePlayer((s) => s.index);
  const total = usePlayer((s) => s.queue.length);
  const from = useSourceLabel();
  const openFull = useUi((s) => s.openFull);
  const track = current ?? history[0];
  if (!track) return null;
  const playing = !!current && (status === "playing" || status === "loading");
  const replay = () => player.playFrom(history, 0, STATIC);
  return (
    <Tile cover={<Cover url={track.artworkUrl} size={52} />} title={current ? (from ?? track.title) : track.title} sub={current ? `${playing ? t.playingShort : t.paused} · ${t.ofCount(index + 1, total)}` : t.lastPlayed} onClick={() => (current ? openFull() : replay())}>
      <Pp playing={playing} label={playing ? t.pause : t.play} onClick={() => (current ? player.toggle() : replay())} />
      {current && <Bar />}
    </Tile>
  );
}

function LikesTile() {
  const t = useT();
  const open = useNav((s) => s.open);
  const count = useAuth((s) => s.status?.user?.likesCount ?? 0);
  const q = useLikes("me");
  const tracks = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  return <Tile cover={<Cover url={tracks[0]?.artworkUrl ?? null} size={52} />} title={t.likedTracks} sub={t.tracks(count || tracks.length)} onClick={() => open("likes", { name: "likes" })} />;
}

function PlaylistTile({ p }: { p: Playlist }) {
  const t = useT();
  const go = useNav((s) => s.go);
  return <Tile cover={<Cover url={p.artworkUrl} size={52} />} title={p.title} sub={t.tracks(p.trackCount)} onClick={() => go({ name: "playlist", id: p.id })} />;
}

function StationTile({ seed }: { seed: Track }) {
  const t = useT();
  const toast = useUi((s) => s.showToast);
  return <Tile cover={<Cover url={seed.artworkUrl} size={52} />} title={t.stationOf(seed.title)} sub={t.basedOnTrack} onClick={() => void startStation(seed).catch(() => toast(t.stationFailed))} />;
}

function Heading({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="mb-2.5 flex items-baseline">
      <h2 className="text-[14px] font-semibold text-text">{title}</h2>
      {action && (
        <button type="button" onClick={onAction} className="ml-auto text-[11.5px] text-[var(--s-dim)] hover:text-text">
          {action}
        </button>
      )}
    </div>
  );
}

function Card({ cover, title, sub, on, playing, onClick, round = false }: { cover: string | null; title: string; sub: string; on?: boolean; playing?: boolean; onClick: () => void; round?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="group min-w-0 text-left">
      <span className={`relative block aspect-square overflow-hidden bg-white/[0.06] ${round ? "rounded-full" : "rounded-[var(--r2)]"}`}>
        {cover ? <img src={artwork(cover, "t300x300") ?? undefined} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" /> : <span className="stipple-night block h-full w-full" />}
        {!round && (
          <span className={`s-pp absolute bottom-2 right-2 h-8 w-8 transition-opacity ${on ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
            <Icon name={on && playing ? "pause" : "play"} size={14} />
          </span>
        )}
      </span>
      <span className={`mt-2 block truncate text-[12.5px] font-semibold ${on ? "text-[var(--accent)]" : "text-text"}`}>{title}</span>
      <span className="mt-px block truncate text-[11.5px] text-[var(--s-dim)]">{sub}</span>
    </button>
  );
}

/** a grid that keeps one row: as many as fit */
const ONE_ROW = "grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] grid-rows-[auto] [grid-auto-rows:0] gap-x-3.5 overflow-hidden";

function Recent({ tracks }: { tracks: Track[] }) {
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playing = usePlayer((s) => s.status === "playing" || s.status === "loading");
  return (
    <div className={ONE_ROW}>
      {tracks.map((tr, i) => (
        <Card key={tr.id} cover={tr.artworkUrl} title={tr.title} sub={tr.artist} on={tr.id === currentId} playing={playing} onClick={() => (tr.id === currentId ? player.toggle() : player.playFrom(tracks, i, STATIC))} />
      ))}
    </div>
  );
}

/** What friends are playing right now (those who share it): a click plays it here too. */
function FriendsListening() {
  const t = useT();
  const toast = useUi((s) => s.showToast);
  const now = useSocial((s) => s.now);
  const friends = useSocial((s) => s.friends?.friends);
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playing = usePlayer((s) => s.status === "playing" || s.status === "loading");
  const list = Object.entries(now);
  if (!list.length) return null;
  const name = (code: string) => friends?.find((f) => f.code === code)?.name || code;
  return (
    <section className="mb-6">
      <Heading title={t.friendsListening} />
      <div className={ONE_ROW}>
        {list.map(([code, tr], i) => (
          <Card
            key={code}
            cover={tr.artworkUrl}
            title={tr.title}
            sub={name(code)}
            on={tr.id === currentId}
            playing={playing}
            onClick={() =>
              tr.id === currentId
                ? player.toggle()
                : void playShared(
                    list.map((x) => x[1]),
                    i,
                  ).catch(() => toast(t.trackGone))
            }
          />
        ))}
      </div>
    </section>
  );
}

/**
 * What was played in sc player lately, by anyone who shares it anonymously: the server keeps only SoundCloud ids, so
 * titles and covers come from SoundCloud (and hidden artists and words stay hidden).
 */
function ScListening() {
  const t = useT();
  const available = useSocial((s) => !!s.status?.available);
  const q = useQuery({ queryKey: ["sc-listening"], queryFn: () => call("social:listening"), enabled: available, staleTime: 30_000, refetchInterval: 60_000 });
  const ids = (q.data ?? []).map((x) => x.id);
  const tq = useQuery({ queryKey: ["sc-listening-tracks", ids.join(",")], queryFn: () => call("data:tracks", ids), enabled: ids.length > 0, staleTime: 5 * 60_000 });
  const ordered = useMemo(() => {
    const byId = new Map((tq.data ?? []).map((tr) => [tr.id, tr]));
    // newest first, as the server sends them
    return (q.data ?? []).map((x) => byId.get(x.id)).filter((tr): tr is Track => !!tr);
  }, [tq.data, q.data]);
  const tracks = useVisibleTracks(ordered).slice(0, 12);
  if (!tracks.length) return null;
  return (
    <section className="mb-6">
      <Heading title={t.scListening} />
      <Recent tracks={tracks} />
    </section>
  );
}

/** Tracks friends sent lately: a click plays from there on. */
function FromFriends() {
  const t = useT();
  const open = useNav((s) => s.open);
  const toast = useUi((s) => s.showToast);
  const joined = useSocial((s) => !!s.status?.profile);
  const arrived = useSocial((s) => s.arrived.length);
  const friends = useSocial((s) => s.friends?.friends);
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const q = useQuery({ queryKey: ["social-recent", arrived], queryFn: () => call("social:recent"), enabled: joined, staleTime: 30_000 });
  const list = (q.data ?? []).slice(0, 5);
  if (!joined || !list.length) return null;
  const name = (code?: string) => friends?.find((f) => f.code === code)?.name || code || "";
  return (
    <section className="mb-6">
      <Heading title={t.fromFriends} action={t.openInbox} onAction={() => open("inbox", { name: "inbox" })} />
      <div>
        {list.map((m, i) => (
          <button
            key={m.id}
            type="button"
            onClick={() =>
              void playShared(
                list.slice(i).map((x) => x.track),
                0,
                [m.id],
              ).catch(() => toast(t.trackGone))
            }
            className="flex h-11 w-full items-center gap-3 border-b border-[var(--s-line)] text-left text-[12.5px] hover:bg-[var(--s-hover)]"
          >
            <Cover url={m.track.artworkUrl} size={32} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate font-semibold ${m.track.id === currentId ? "text-[var(--accent)]" : "text-text"}`}>{m.track.title}</span>
              <span className="block truncate text-[11.5px] text-[var(--s-dim)]">{m.track.artist}</span>
            </span>
            <span className="flex w-44 items-center gap-2 text-muted">
              <Avatar name={name(m.from)} code={m.from ?? ""} size={22} />
              <span className="truncate">{t.fromName(name(m.from))}</span>
            </span>
            <span className="w-14 pr-1 text-right text-[11.5px] tabular-nums text-[var(--s-dim)]">{when(m.sent)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function FeedRows() {
  const t = useT();
  const q = useFeed(true);
  const all = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const tracks = useVisibleTracks(all).slice(0, 8);
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  if (!tracks.length) return null;
  return (
    <div>
      {tracks.map((tr, i) => (
        <button
          key={tr.id}
          type="button"
          onDoubleClick={() => player.playFrom(tracks, i, STATIC)}
          onKeyDown={(e) => e.key === "Enter" && player.playFrom(tracks, i, STATIC)}
          onContextMenu={(e) => {
            e.preventDefault();
            useUi.getState().openMenu(e.clientX, e.clientY, tr);
          }}
          className="flex h-11 w-full items-center gap-3 border-b border-[var(--s-line)] text-left text-[12.5px] hover:bg-[var(--s-hover)]"
        >
          <span className="w-6 text-[11.5px] tabular-nums text-[var(--s-dim)]">{i + 1}</span>
          <Cover url={tr.artworkUrl} size={32} />
          <span className="min-w-0 flex-1">
            <span className={`block truncate font-semibold ${tr.id === currentId ? "text-[var(--accent)]" : "text-text"}`}>{tr.title}</span>
            <span className="block truncate text-[11.5px] text-[var(--s-dim)]">{tr.artist}</span>
          </span>
          <span className="w-12 pr-1 text-right text-[11.5px] tabular-nums text-[var(--s-dim)]">{duration(tr.durationMs)}</span>
        </button>
      ))}
      <p className="sr-only">{t.feed}</p>
    </div>
  );
}

function greeting(t: ReturnType<typeof useT>, name: string | undefined) {
  const h = new Date().getHours();
  const hello = h >= 5 && h < 12 ? t.goodMorning : h >= 12 && h < 17 ? t.goodAfternoon : h >= 17 && h < 23 ? t.goodEvening : t.lateNight;
  return name ? `${hello}, ${name}` : hello;
}

/** Studio home: a greeting with a filter, a dial of four, what you played, what friends sent, what is new. */
export default function StudioHome() {
  const t = useT();
  const open = useNav((s) => s.open);
  const go = useNav((s) => s.go);
  const status = useAuth((s) => s.status);
  const signedIn = status?.mode === "session";
  const [filter, setFilter] = useState<Filter>("all");
  const history = useSettings((s) => s.history);
  const current = useCurrentTrack();
  const recent = useVisibleTracks(history).slice(0, 12);
  const pq = usePlaylists("me", signedIn);
  const playlists = useMemo(() => pq.data?.pages.flatMap((p) => p.items) ?? [], [pq.data]);
  const own = playlists.filter((p) => p.relation === "own");
  const firstList = (own.length ? own : playlists)[0];
  const seed = current ?? history[0];
  const seeds = useMemo(() => {
    const seen = new Set<number>();
    return [...(current ? [current] : []), ...history].filter((s) => !seen.has(s.id) && seen.add(s.id)).slice(0, 12);
  }, [current, history]);
  const toast = useUi((s) => s.showToast);

  const filters: [Filter, string][] = [
    ["all", t.all],
    ["tracks", t.tracksTab],
    ["playlists", t.playlists],
    ["stations", t.stations],
  ];

  return (
    <Screen label={t.home}>
      <div className="mb-4 mt-2.5 flex items-end gap-3">
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-text">{greeting(t, status?.user?.username)}</h1>
        <div className="s-seg ml-auto" role="tablist">
          {filters.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {filter === "all" && (
        <div className="mb-6 grid grid-cols-2 gap-1.5">
          <NowTile />
          {signedIn && <LikesTile />}
          {firstList && <PlaylistTile p={firstList} />}
          {seed && <StationTile seed={seed} />}
        </div>
      )}

      {(filter === "all" || filter === "tracks") && recent.length > 0 && (
        <section className="mb-6">
          <Heading title={t.jumpBackIn} action={t.showAll} onAction={() => open("history", { name: "history" })} />
          <Recent tracks={recent} />
        </section>
      )}

      {(filter === "all" || filter === "tracks") && (
        <>
          <FriendsListening />
          <ScListening />
        </>
      )}

      {filter === "all" && <FromFriends />}

      {(filter === "all" || filter === "tracks") && signedIn && (
        <section className="mb-6">
          <Heading title={t.newInFeed} action={t.showAll} onAction={() => open("feed", { name: "feed" })} />
          <FeedRows />
        </section>
      )}

      {filter === "playlists" && (
        <section className="mb-6">
          <Heading title={t.playlists} action={t.showAll} onAction={() => open("playlists", { name: "playlists" })} />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-3.5 gap-y-5">
            {playlists.slice(0, 24).map((p) => (
              <Card key={`${p.id}-${p.relation}`} cover={p.artworkUrl} title={p.title} sub={t.tracks(p.trackCount)} onClick={() => go({ name: "playlist", id: p.id })} />
            ))}
          </div>
        </section>
      )}

      {filter === "stations" && (
        <section className="mb-6">
          <Heading title={t.stations} action={t.showAll} onAction={() => open("stations", { name: "stations" })} />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-3.5 gap-y-5">
            {seeds.map((s) => (
              <Card key={s.id} cover={s.artworkUrl} title={t.stationOf(s.title)} sub={t.basedOnTrack} onClick={() => void startStation(s).catch(() => toast(t.stationFailed))} />
            ))}
          </div>
        </section>
      )}

      {!signedIn && !recent.length && <p className="mt-10 max-w-md text-sm text-muted">{t.homeEmpty}</p>}
    </Screen>
  );
}
