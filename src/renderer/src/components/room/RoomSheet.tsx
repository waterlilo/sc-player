import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { Friend } from "@shared/social";
import { useT } from "@/i18n";
import { useNav } from "@/state/nav";
import { room, useRoom, useRoomSheet } from "@/state/room";
import { useSocial } from "@/state/social";
import { useUi } from "@/state/ui";
import { Toggle } from "../settings/Controls";
import { Avatar } from "../social/bits";
import Icon from "../ui/Icon";

const NONE: Friend[] = [];

/**
 * "Listen together": out of a room, tick friends (and whether tracks start together) and open a room playing what plays
 * now; in a room as its host, invite more. Friends whose app can't join yet are shown, greyed.
 */
export default function RoomSheet() {
  const t = useT();
  const open = useRoomSheet((s) => s.open);
  const close = () => useRoomSheet.setState({ open: false });
  const friends = useSocial((s) => s.friends?.friends ?? NONE);
  const profile = useSocial((s) => s.status?.profile);
  const current = useRoom((s) => s.room);
  const toast = useUi((s) => s.showToast);
  const go = useNav((s) => s.open);
  const [picked, setPicked] = useState<string[]>([]);
  const [together, setTogether] = useState(true);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const shut = () => {
    setPicked([]);
    close();
  };
  const inRoom = new Set(current?.members.map((m) => m.code) ?? []);

  const start = async () => {
    setBusy(true);
    try {
      if (current) {
        await room.invite(picked);
        toast(t.roomInvited(picked.length));
      } else {
        await room.create(picked, together);
        toast(picked.length ? t.roomInvited(picked.length) : t.roomOpened);
        useUi.setState({ sideQueue: true });
      }
      shut();
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : t.roomFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] grid place-items-center bg-black/40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          onPointerDown={(e) => !ref.current?.contains(e.target as Node) && shut()}
        >
          <div ref={ref} role="dialog" aria-label={t.listenTogether} className="float-card paper-fill sketch sketch-thin flex w-[24rem] max-w-[90vw] flex-col rounded-md py-2 shadow-[0_24px_60px_rgba(0,0,0,0.5)]">
            <div className="px-4 pb-1 pt-1 font-type text-xs uppercase tracking-wider text-muted">{current ? t.roomInviteMore : t.listenTogether}</div>
            {!current && <p className="px-4 pb-2 text-[12.5px] leading-snug text-muted">{t.listenTogetherHint}</p>}
            {!profile ? (
              <div className="px-4 py-3 text-sm text-muted">
                {t.roomNeedsCode}{" "}
                <button
                  type="button"
                  className="text-text underline underline-offset-2"
                  onClick={() => {
                    shut();
                    go("inbox", { name: "inbox" });
                  }}
                >
                  {t.inbox}
                </button>
              </div>
            ) : (
              <div className="max-h-[44vh] overflow-y-auto px-1.5">
                {friends.length === 0 && <div className="px-3 py-3 text-sm text-muted">{t.noFriendsYet}</div>}
                {friends.map((f) => {
                  const here = inRoom.has(f.code);
                  const can = f.rooms !== false && !here;
                  const on = picked.includes(f.code);
                  return (
                    <button
                      key={f.code}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      disabled={!can}
                      onClick={() => setPicked((p) => (on ? p.filter((c) => c !== f.code) : [...p, f.code]))}
                      className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left outline-none enabled:hover:bg-[var(--row-hover)] disabled:opacity-50 ${on ? "bg-[var(--row-hover)]" : ""}`}
                    >
                      <Avatar name={f.name} code={f.code} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-text">{f.name || f.code}</span>
                        {(here || f.rooms === false) && <span className="block truncate text-xs text-muted">{here ? t.roomAlreadyIn : t.roomNeedsUpdate}</span>}
                      </span>
                      <span className={`grid h-[18px] w-[18px] place-items-center rounded-[5px] border ${on ? "border-text bg-text text-[#0b0b0d]" : "border-muted/60"}`}>{on && <Icon name="check" size={12} />}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {!current && profile && (
              <div className="mx-1.5 mt-2 flex items-center gap-3 rounded-md px-2.5 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-text">{t.startTogether}</span>
                  <span className="block text-xs leading-snug text-muted">{t.startTogetherHint}</span>
                </span>
                <Toggle on={together} onChange={setTogether} label={t.startTogether} />
              </div>
            )}
            <div className="flex items-center justify-end gap-2 px-3 pb-1 pt-3">
              <button type="button" onClick={shut} className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-text">
                {t.cancel}
              </button>
              <button
                type="button"
                disabled={!profile || busy || (!!current && !picked.length)}
                onClick={() => void start()}
                className="marker-fill sketch sketch-thin flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-semibold disabled:opacity-50"
              >
                <Icon name="users" size={15} />
                {current ? t.roomInvite : picked.length ? t.roomStartInvite : t.roomStart}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
