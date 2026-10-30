import type { ReactNode } from "react";
import { artwork } from "@shared/types";
import { useT } from "@/i18n";
import { shortVersion } from "@/lib/format";
import { unpin, unsaveProfile } from "@/lib/links";
import { useSystem } from "@/lib/system";
import { useAuth } from "@/state/auth";
import { useLikes } from "@/state/likes";
import { useNav, type Route, type Section } from "@/state/nav";
import { usePlayer } from "@/state/player";
import { useSettings } from "@/state/settings";
import { unreadTotal, useSocial } from "@/state/social";
import { useUi } from "@/state/ui";
import Icon, { type IconName } from "../ui/Icon";

function Nav({ section, route, icon, children, count, badge }: { section: Section; route: Route; icon: IconName; children: ReactNode; count?: number | null; badge?: number }) {
  const current = useNav((s) => s.section);
  const open = useNav((s) => s.open);
  const on = current === section;
  return (
    <button type="button" onClick={() => open(section, route)} aria-current={on ? "page" : undefined} className={`s-nav ${on ? "on" : ""}`}>
      <Icon name={icon} size={17} />
      <span className="truncate">{children}</span>
      {badge ? <span className="u">{badge > 99 ? "99+" : badge}</span> : count ? <span className="n">{count.toLocaleString("en-US")}</span> : null}
    </button>
  );
}

/** three bars that move while this list is the one playing */
function Playing({ paused }: { paused: boolean }) {
  return (
    <span className={`s-eq ${paused ? "paused" : ""}`} aria-hidden="true">
      <i style={{ height: "60%" }} />
      <i />
      <i style={{ height: "40%" }} />
    </span>
  );
}

function Pinned() {
  const t = useT();
  const section = useNav((s) => s.section);
  const route = useNav((s) => s.route);
  const open = useNav((s) => s.open);
  const go = useNav((s) => s.go);
  const playlists = useSettings((s) => s.pinnedPlaylists);
  const profiles = useSettings((s) => s.savedProfiles);
  const source = usePlayer((s) => s.source);
  const paused = usePlayer((s) => s.status !== "playing");

  if (!playlists.length && !profiles.length) return <p className="px-2.5 text-[11.5px] leading-relaxed text-[var(--s-dim)]">{t.pinnedEmpty}</p>;
  return (
    <div className="min-h-0 overflow-y-auto">
      {playlists.map((p) => {
        const on = route.name === "playlist" && route.id === p.id;
        const playing = source.kind === "playlist" && source.playlistId === p.id;
        return (
          <div key={p.id} className="group relative">
            <button type="button" onClick={() => go({ name: "playlist", id: p.id })} className={`s-pin ${on ? "on" : ""}`}>
              <span className="cv">{p.artworkUrl && <img src={artwork(p.artworkUrl, "large") ?? undefined} alt="" className="h-full w-full object-cover" draggable={false} />}</span>
              <span className="min-w-0 flex-1">
                <span className="t block">{p.title}</span>
                <span className="s block">{t.playlistCount(p.trackCount)}</span>
              </span>
              {playing && <Playing paused={paused} />}
            </button>
            <button
              type="button"
              aria-label={`${t.unpin}: ${p.title}`}
              title={t.unpin}
              onClick={() => unpin(p.id)}
              className="absolute right-1.5 top-1/2 hidden h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-[var(--s-dim)] hover:text-text group-hover:grid"
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        );
      })}
      {profiles.map((p) => {
        const s: Section = `profile:${p.id}`;
        const playing = (source.kind === "userTracks" || source.kind === "likes") && source.userId === p.id;
        return (
          <div key={p.id} className="group relative">
            <button type="button" onClick={() => open(s, { name: "profile", userId: p.id })} className={`s-pin ${section === s ? "on" : ""}`}>
              <span className="cv round">{p.avatarUrl && <img src={artwork(p.avatarUrl, "t67x67") ?? undefined} alt="" className="h-full w-full object-cover" draggable={false} />}</span>
              <span className="min-w-0 flex-1">
                <span className="t block">{p.username}</span>
                <span className="s block">{t.profile}</span>
              </span>
              {playing && <Playing paused={paused} />}
            </button>
            <button
              type="button"
              aria-label={`${t.removeProfile}: ${p.username}`}
              title={t.removeProfile}
              onClick={() => unsaveProfile(p.id)}
              className="absolute right-1.5 top-1/2 hidden h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-[var(--s-dim)] hover:text-text group-hover:grid"
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Me() {
  const t = useT();
  const status = useAuth((s) => s.status);
  const code = useSocial((s) => s.status?.profile?.code);
  const appearance = useUi((s) => s.appearance);
  const setAppearance = useUi((s) => s.setAppearance);
  const open = useNav((s) => s.open);
  const user = status?.mode === "session" ? status.user : null;
  return (
    <div className="s-me">
      <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full bg-[#cfc7e6] text-[11px] font-semibold text-[#0d0d10]">
        {user?.avatarUrl ? <img src={artwork(user.avatarUrl, "t67x67") ?? undefined} alt="" className="h-full w-full object-cover" draggable={false} /> : (user?.username ?? "?").charAt(0).toUpperCase()}
      </span>
      {user ? (
        <div className="min-w-0 flex-1">
          <div className="t truncate">{user.username}</div>
          <div className="s truncate">{code ?? "SoundCloud"}</div>
        </div>
      ) : (
        <button type="button" onClick={() => open("likes", { name: "likes" })} className="min-w-0 flex-1 text-left">
          <div className="t">{t.signIn}</div>
          <div className="s">SoundCloud</div>
        </button>
      )}
      <button
        type="button"
        className={`s-ib ${appearance === "side" ? "on" : ""}`}
        onClick={() => setAppearance(appearance === "side" ? null : "side")}
        aria-label={t.secAppearance}
        title={t.secAppearance}
        aria-expanded={appearance === "side"}
        data-appearance-toggle
      >
        <Icon name="settings" size={17} />
      </button>
    </div>
  );
}

/** Studio sidebar: places, the library with counts, pinned playlists and people, and who you are. */
export default function StudioSidebar() {
  const t = useT();
  const status = useAuth((s) => s.status);
  const user = status?.mode === "session" ? status.user : null;
  const localLikes = useSettings((s) => s.prefs.localLikes);
  const likedCount = useLikes((s) => (s.ready ? s.ids.size : null));
  const social = useSocial((s) => !!s.status?.available);
  const unread = useSocial((s) => unreadTotal(s.unread) + (s.friends?.incoming.length ?? 0));
  const update = useSystem((s) => s.update);
  const open = useNav((s) => s.open);

  return (
    <nav aria-label={t.appName} className="s-side s-glass">
      <Nav section="home" route={{ name: "home" }} icon="home">
        {t.home}
      </Nav>
      <Nav section="search" route={{ name: "search" }} icon="search">
        {t.search}
      </Nav>
      <Nav section="feed" route={{ name: "feed" }} icon="feed">
        {t.feed}
      </Nav>
      {social && (
        <>
          <Nav section="inbox" route={{ name: "inbox" }} icon="inbox" badge={unread}>
            {t.inbox}
          </Nav>
          <Nav section="workshop" route={{ name: "workshop" }} icon="brush">
            {t.workshop}
          </Nav>
        </>
      )}
      <div className="s-sect s-lbl">{t.library}</div>
      <Nav section="likes" route={{ name: "likes" }} icon="heart" count={localLikes ? likedCount : user?.likesCount}>
        {t.likedTracks}
      </Nav>
      <Nav section="playlists" route={{ name: "playlists" }} icon="list" count={user?.playlistCount}>
        {t.playlists}
      </Nav>
      <Nav section="albums" route={{ name: "albums" }} icon="disc">
        {t.albums}
      </Nav>
      <Nav section="stations" route={{ name: "stations" }} icon="radio">
        {t.stations}
      </Nav>
      <Nav section="following" route={{ name: "following" }} icon="users" count={user?.followingsCount}>
        {t.following}
      </Nav>
      <Nav section="history" route={{ name: "history" }} icon="history">
        {t.history}
      </Nav>
      <Nav section="local" route={{ name: "local" }} icon="device">
        {t.localMusic}
      </Nav>
      <div className="s-sect s-lbl">
        {t.pinned}
        <button type="button" onClick={() => open("playlists", { name: "playlists" })} aria-label={t.pinHint} title={t.pinHint}>
          <Icon name="plus" size={13} />
        </button>
      </div>
      <Pinned />
      {(update.state === "available" || update.state === "ready") && (
        <button type="button" onClick={() => open("settings", { name: "settings" })} className="s-btn pri mx-1 mt-3">
          {t.updateBanner(shortVersion(update.version))}
        </button>
      )}
      <Me />
    </nav>
  );
}
