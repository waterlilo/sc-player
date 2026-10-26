import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { Friend } from "@shared/social";
import { useT } from "@/i18n";
import { call } from "@/lib/sky";
import { useNav } from "@/state/nav";
import { useSocial } from "@/state/social";
import { useUi } from "@/state/ui";
import Icon from "../ui/Icon";
import { Avatar, Cover, Eq } from "./bits";

const NONE: Friend[] = [];

/** "Send to friends": tick friends, send. Esc or a click outside closes. */
export default function SendSheet() {
  const t = useT();
  const single = useSocial((s) => s.sending);
  const list = useSocial((s) => s.sendingPlaylist);
  const close = useSocial((s) => s.closeSend);
  // what the sheet is for: a track, or one of my own playlists
  const track = single ?? list;
  const friends = useSocial((s) => s.friends?.friends ?? NONE);
  const now = useSocial((s) => s.now);
  const toast = useUi((s) => s.showToast);
  const open = useNav((s) => s.open);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!track) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [track, close]);

  const shut = () => {
    setPicked([]);
    close();
  };

  const go = async () => {
    if (!track || !picked.length) return;
    setBusy(true);
    try {
      const r = list ? await call("social:sendPlaylist", picked, list.id) : { ids: await call("social:send", picked, single!), track: single!, playlist: undefined };
      // an open conversation shows what I just sent
      const sent = Date.now();
      useSocial.setState((s) => ({
        arrived: [...s.arrived, ...r.ids.map((id, i) => ({ id, from: picked[i], mine: true, track: r.track, ...(r.playlist ? { playlist: r.playlist } : {}), sent, seen: false, state: "" as const }))],
      }));
      toast(picked.length === 1 ? t.sentTo(friends.find((f) => f.code === picked[0])?.name || picked[0]!) : t.sentToMany(picked.length));
      shut();
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : t.sendFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {track && (
        <motion.div
          className="fixed inset-0 z-[70] grid place-items-center bg-black/40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          onPointerDown={(e) => !ref.current?.contains(e.target as Node) && shut()}
        >
          <div ref={ref} role="dialog" aria-label={t.sendToFriends} className="float-card paper-fill sketch sketch-thin flex w-[23rem] max-w-[90vw] flex-col rounded-md py-2 shadow-[0_24px_60px_rgba(0,0,0,0.5)]">
            <div className="px-4 pb-2 pt-1 font-type text-xs uppercase tracking-wider text-muted">{t.sendToFriends}</div>
            <div className="mx-3 mb-2 flex items-center gap-3 rounded-md bg-white/[0.04] p-2">
              <Cover url={track.artworkUrl} size={40} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-text">{track.title}</div>
                <div className="truncate text-xs text-muted">{list ? t.sharedPlaylist(list.trackCount) : single?.artist}</div>
              </div>
            </div>
            <div className="max-h-[44vh] overflow-y-auto px-1.5">
              {friends.length === 0 && (
                <div className="px-3 py-3 text-sm text-muted">
                  {t.noFriendsYet}{" "}
                  <button
                    type="button"
                    className="text-text underline underline-offset-2"
                    onClick={() => {
                      shut();
                      open("inbox", { name: "inbox" });
                    }}
                  >
                    {t.addFriend}
                  </button>
                </div>
              )}
              {friends.map((f) => {
                const on = picked.includes(f.code);
                return (
                  <button
                    key={f.code}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => setPicked((p) => (on ? p.filter((c) => c !== f.code) : [...p, f.code]))}
                    className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left outline-none hover:bg-[var(--row-hover)] focus-visible:bg-[var(--row-hover)] ${on ? "bg-[var(--row-hover)]" : ""}`}
                  >
                    <Avatar name={f.name} code={f.code} size={30} live={!!now[f.code]} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-text">{f.name || f.code}</span>
                      {now[f.code] && (
                        <span className="flex items-center gap-1.5 truncate text-xs text-muted">
                          <Eq />
                          {t.listeningNow}
                        </span>
                      )}
                    </span>
                    <span className={`grid h-[18px] w-[18px] place-items-center rounded-[5px] border ${on ? "border-text bg-text text-[#0b0b0d]" : "border-muted/60"}`}>{on && <Icon name="check" size={12} />}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-end gap-2 px-3 pb-1 pt-3">
              {single && (
                <button type="button" onClick={() => void call("clipboard:write", single.permalinkUrl).then(() => toast(t.linkCopied))} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted hover:text-text">
                  <Icon name="copy" size={15} />
                  {t.copyLink}
                </button>
              )}
              <button type="button" disabled={!picked.length || busy} onClick={() => void go()} className="marker-fill sketch sketch-thin flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-semibold disabled:opacity-50">
                <Icon name="send" size={15} />
                {picked.length > 1 ? t.sendToCount(picked.length) : t.send}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
