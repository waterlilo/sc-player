import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { queryClient } from "@/api/queries";
import { useT } from "@/i18n";
import { canEdit, removeFromPlaylist } from "@/lib/playlists";
import { call } from "@/lib/sky";
import { useNav } from "@/state/nav";
import { isLocalTrack, type Playlist, type Track } from "@shared/types";
import { useAuth } from "@/state/auth";
import { toggleLike, useLikes } from "@/state/likes";
import { player, substituteFor, useSubs } from "@/state/player";
import { useRoom } from "@/state/room";
import { useSettings } from "@/state/settings";
import { useSocial } from "@/state/social";
import { useUi } from "@/state/ui";
import Icon, { type IconName } from "../ui/Icon";

/**
 * The track context menu: right click (or the menu key / Shift+F10) on a track. A paper card at the pointer, kept
 * inside the window; ↑/↓ move, Enter picks, Esc or a click elsewhere closes.
 */
export default function TrackMenu() {
  const t = useT();
  const menu = useUi((s) => s.menu);
  const close = useUi((s) => s.closeMenu);
  const toast = useUi((s) => s.showToast);
  const go = useNav((s) => s.go);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  // keep it inside the window
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.min(menu.x, window.innerWidth - r.width - 8), top: Math.min(menu.y, window.innerHeight - r.height - 8) });
    ref.current.querySelector<HTMLButtonElement>("button")?.focus();
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onBlur = () => close();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onBlur);
    };
  }, [menu, close]);

  const track = menu?.track;
  const signedIn = useAuth((s) => s.status?.mode === "session");
  const localLikes = useSettings((s) => s.prefs.localLikes);
  // the menu opened on a page of a playlist of your own: it can take the track out
  const route = useNav((s) => s.route);
  const shown = route.name === "playlist" ? queryClient.getQueryData<Playlist>(["playlist", route.id]) : undefined;
  const ownList = shown && canEdit(shown) ? shown : null;
  const likes = useLikes((s) => s.ids);
  const openPicker = useUi((s) => s.openPicker);
  const canSend = useSocial((s) => !!s.status?.profile);
  const openSend = useSocial((s) => s.openSend);
  /** null out of a room; in one, whether this app is its host */
  const roomHost = useRoom((s) => (s.room ? s.room.host === s.me : null));

  /** For a protected track: try another found upload, open the one that plays, or switch substitution for it. */
  const substituteItems = (tr: Track): { icon: IconName; label: string; run: () => void }[] => {
    if (tr.playability === "ok") return [];
    const { prefs } = useSettings.getState();
    if (!prefs.substitute) return [];
    if (prefs.noSubstitute.includes(tr.id)) return [{ icon: "shuffle", label: t.doSubstitute, run: () => player.setSubstitute(tr, true) }];
    const s = useSubs.getState().byTrack[tr.id];
    const alt = substituteFor(tr);
    return [
      ...(s?.state === "found"
        ? [{ icon: "shuffle" as IconName, label: t.tryAnother, run: () => void player.tryAnotherVersion(tr).then((r) => toast(r ? t.nowFromUpload(r.upload.user.username, r.at, r.of) : t.noOtherUpload)) }]
        : []),
      ...(alt ? [{ icon: "link" as IconName, label: t.openSubstitute, run: () => void call("shell:open", alt.permalinkUrl) }] : []),
      { icon: "block", label: t.dontSubstitute, run: () => player.setSubstitute(tr, false) },
    ];
  };
  // in a listening room the queue is the room's: the host adds to it, the others suggest
  const queueItems: { icon: IconName; label: string; run: () => void }[] = !track
    ? []
    : roomHost === null
      ? [
          { icon: "playNext", label: t.playNext, run: () => player.playNext(track) },
          { icon: "queue", label: t.addToQueue, run: () => player.addToQueue(track) },
        ]
      : roomHost
        ? [
            { icon: "playNext", label: t.roomPlayNext, run: () => player.playNext(track) },
            { icon: "queue", label: t.roomAddToQueue, run: () => player.addToQueue(track) },
          ]
        : [{ icon: "users", label: t.roomSuggest, run: () => player.addToQueue(track) }];
  const fromOwnList: { icon: IconName; label: string; run: () => void }[] =
    track && ownList
      ? [
          {
            icon: "close",
            label: t.removeFromPlaylist,
            run: () =>
              void removeFromPlaylist(ownList.id, track.id).then(
                () => toast(t.removedFrom(ownList.title)),
                () => toast(t.playlistFailed),
              ),
          },
        ]
      : [];
  const localItems: { icon: IconName; label: string; run: () => void; danger?: boolean }[] = !track
    ? []
    : [
        // a room can't play it (nobody else has the file)
        ...(roomHost === null ? queueItems : []),
        ...(localLikes ? [{ icon: "heart" as IconName, label: likes.has(track.id) ? t.unlike : t.like, run: () => void toggleLike(track) }] : []),
        { icon: "plus", label: t.addToPlaylist, run: () => openPicker(track) },
        ...fromOwnList,
        { icon: "external", label: t.localShowInFolder, run: () => void call("local:show", track.id) },
        {
          icon: "close",
          label: t.localRemove,
          danger: true,
          run: () => void call("local:remove", track.id).then(() => queryClient.invalidateQueries({ queryKey: ["local-tracks"] })),
        },
      ];
  const items: { icon: IconName; label: string; run: () => void; danger?: boolean }[] = !track
    ? []
    : isLocalTrack(track.id)
      ? localItems
      : [
        ...queueItems,
        ...(signedIn || localLikes ? [{ icon: "heart" as IconName, label: likes.has(track.id) ? t.unlike : t.like, run: () => void toggleLike(track) }] : []),
        // playlists of your own: on SoundCloud signed in, on this computer otherwise
        { icon: "plus" as IconName, label: t.addToPlaylist, run: () => openPicker(track) },
        ...fromOwnList,
        ...(canSend ? [{ icon: "send" as IconName, label: t.sendToFriends, run: () => openSend(track) }] : []),
        { icon: "play", label: t.goToTrack, run: () => go({ name: "track", id: track.id }) },
        { icon: "user", label: t.goToArtist, run: () => go({ name: "profile", userId: track.user.id }) },
        {
          icon: "link",
          label: t.copyLink,
          run: () => {
            void call("clipboard:write", track.permalinkUrl).then(() => toast(t.linkCopied));
          },
        },
        { icon: "external", label: t.openOnSoundCloud, run: () => void call("shell:open", track.permalinkUrl) },
        ...substituteItems(track),
        {
          icon: "block",
          label: t.blockArtist(track.user.username),
          danger: true,
          run: () => {
            const { prefs, setPref } = useSettings.getState();
            if (!prefs.blockedArtists.some((a) => a.id === track.user.id)) setPref("blockedArtists", [...prefs.blockedArtists, { id: track.user.id, username: track.user.username }]);
          },
        },
      ];

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") return close();
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = [...(ref.current?.querySelectorAll("button") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };

  return (
    <AnimatePresence>
      {menu && (
        <motion.div
          ref={ref}
          role="menu"
          aria-label={track?.title}
          onKeyDown={onKey}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ duration: 0.12 }}
          className="float-card paper-fill sketch sketch-thin fixed z-[60] min-w-56 max-w-80 rounded-md py-1.5 shadow-[4px_6px_0_rgba(0,0,0,0.5)]"
          style={{ ...pos, transformOrigin: "top left" }}
        >
          <div className="truncate px-3 pb-1.5 pt-0.5 font-type text-xs text-muted">{track?.title}</div>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                item.run();
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm outline-none hover:bg-[var(--row-hover)] focus-visible:bg-[var(--row-hover)] focus-visible:shadow-none ${item.danger ? "text-muted hover:text-blood" : "text-text"}`}
            >
              <Icon name={item.icon} size={16} />
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
