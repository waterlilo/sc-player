import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import type { RoomInvite } from "@shared/social";
import { useT } from "@/i18n";
import { room, useRoom } from "@/state/room";
import { useSocial } from "@/state/social";
import { useUi } from "@/state/ui";
import { Avatar } from "../social/bits";
import Icon from "../ui/Icon";

/** "Join" for an invitation: into the room (out of any other), the room's panel shown. */
export function useJoin() {
  const t = useT();
  const toast = useUi((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const join = async (inv: RoomInvite) => {
    setBusy(true);
    try {
      await room.join(inv.room);
      useUi.setState({ sideQueue: true });
      useSocial.setState((s) => ({ invites: s.invites.filter((x) => x.room !== inv.room) }));
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : t.roomFailed);
    } finally {
      setBusy(false);
    }
  };
  return { join, busy };
}

/** An invitation as a card: who, what plays there, Join. */
export function InviteCard({ inv, onDismiss }: { inv: RoomInvite; onDismiss?: () => void }) {
  const t = useT();
  const { join, busy } = useJoin();
  return (
    <div className="flex items-center gap-3 rounded-md bg-white/[0.05] p-2.5">
      <Avatar name={inv.name} code={inv.by} size={34} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-text">{t.roomInvitesYou(inv.name || inv.by)}</div>
        <div className="truncate text-[11.5px] text-muted">{inv.track ? `${inv.track.title} — ${inv.track.artist}` : t.roomListeners(inv.members)}</div>
      </div>
      <button type="button" disabled={busy} onClick={() => void join(inv)} className="marker-fill sketch sketch-thin flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50">
        <Icon name="users" size={14} />
        {t.roomJoin}
      </button>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label={t.close} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:text-text">
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

/** A fresh invitation floats over the window (bottom right) until joined or put away; one at a time. */
export default function InviteFloat() {
  const invites = useSocial((s) => s.invites);
  const inRoom = useRoom((s) => s.room?.id);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const inv = invites.find((i) => i.room !== inRoom && !dismissed.includes(`${i.room}:${i.at}`));
  return (
    <AnimatePresence>
      {inv && (
        <motion.div
          key={`${inv.room}:${inv.at}`}
          className="float-card paper-fill sketch sketch-thin fixed bottom-28 right-5 z-[60] w-[24rem] max-w-[90vw] rounded-md p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.5)]"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8, transition: { duration: 0.12 } }}
        >
          <InviteCard inv={inv} onDismiss={() => setDismissed((d) => [...d, `${inv.room}:${inv.at}`])} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
