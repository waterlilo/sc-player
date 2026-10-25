import { useState } from "react";
import type { RoomItem } from "@shared/social";
import { useT } from "@/i18n";
import { createPlaylist } from "@/lib/playlists";
import { room, useRoom, useRoomSheet } from "@/state/room";
import { useSettings } from "@/state/settings";
import { useUi } from "@/state/ui";
import { Avatar, Cover } from "../social/bits";
import Icon from "../ui/Icon";

/** One row of the room's queue or suggestions: the cover, the track, who put it there; the host's buttons on the right. */
function Row({ item, who, children }: { item: RoomItem; who: string; children?: React.ReactNode }) {
  return (
    <li className="group flex items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-[var(--row-hover)]">
      <Cover url={item.track.artworkUrl} size={34} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium text-text">{item.track.title}</span>
        <span className="block truncate text-[11px] text-muted">
          {item.track.artist}
          {who && ` · ${who}`}
        </span>
      </span>
      {children}
    </li>
  );
}

const small = "grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-white/[0.08] hover:text-text";

/**
 * The room in the place of the queue: who's in it (the host first), what's going on (paused by…, waiting for everyone),
 * suggestions for the host, the queue everyone sees, what played (and saving it as a playlist), leaving.
 */
export default function RoomPanel() {
  const t = useT();
  const r = useRoom((s) => s.room);
  const me = useRoom((s) => s.me);
  const connected = useRoom((s) => s.connected);
  const toast = useUi((s) => s.showToast);
  const autopilot = useSettings((s) => s.prefs.autopilot);
  const [saving, setSaving] = useState(false);
  if (!r) return null;
  const host = r.host === me;
  const name = (code: string) => (code === me ? t.roomYou : r.members.find((m) => m.code === code)?.name || code);
  const members = [...r.members].sort((a, b) => (a.code === r.host ? -1 : b.code === r.host ? 1 : 0));
  const mySuggestions = r.suggestions.filter((s) => s.by === me);

  const save = async () => {
    setSaving(true);
    try {
      const tracks = await room.history();
      if (!tracks.length) return;
      const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      const others = r.members.filter((m) => m.code !== me).map((m) => m.name || m.code);
      await createPlaylist(t.roomPlaylistTitle(others, date), tracks.map((x) => x.id));
      toast(t.roomPlaylistSaved(tracks.length));
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : t.roomFailed);
    } finally {
      setSaving(false);
    }
  };

  const status = !connected
    ? t.roomReconnecting
    : r.waiting
      ? t.roomWaiting(r.waiting.ready.length, r.members.filter((m) => m.here).length)
      : !r.track
        ? host
          ? t.roomPickSomething
          : t.roomHostPicks
        : r.playing
          ? null
          : t.roomPausedBy(name(r.by));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <Icon name="users" size={16} className="text-[var(--accent,var(--glow))]" />
        <b className="text-[13px] font-semibold text-text">{t.listenTogether}</b>
        <button type="button" onClick={() => void room.leave()} className="ml-auto rounded-md px-2 py-1 text-[11.5px] text-muted hover:bg-white/[0.06] hover:text-text">
          {t.roomLeave}
        </button>
      </div>

      <ul className="mb-2 flex flex-wrap gap-1.5 px-1" aria-label={t.roomMembers}>
        {members.map((m) => (
          <li key={m.code} title={m.here ? undefined : t.roomAway} className={`group/m flex items-center gap-1.5 rounded-full bg-white/[0.05] py-0.5 pl-0.5 pr-2.5 ${m.here ? "" : "opacity-45"}`}>
            <Avatar name={m.name} code={m.code} size={20} />
            <span className="max-w-[7.5rem] truncate text-[11.5px] text-text">{name(m.code)}</span>
            {m.code === r.host && <span className="text-[10px] uppercase tracking-wider text-[var(--accent,var(--glow))]">{t.roomHost}</span>}
            {/* the host hands the room over: a crown on the others, shown on hover */}
            {host && m.code !== me && (
              <button
                type="button"
                onClick={() => room.handOver(m.code)}
                aria-label={t.roomMakeHost(name(m.code))}
                title={t.roomMakeHost(name(m.code))}
                className="-mr-1.5 grid h-5 w-5 place-items-center rounded-full text-muted opacity-0 hover:bg-white/[0.1] hover:text-text focus-visible:opacity-100 group-hover/m:opacity-100"
              >
                <Icon name="crown" size={12} />
              </button>
            )}
          </li>
        ))}
        {host && (
          <li>
            <button type="button" onClick={() => useRoomSheet.setState({ open: true })} className="flex h-[24px] items-center gap-1 rounded-full border border-dashed border-white/20 px-2.5 text-[11.5px] text-muted hover:text-text">
              <Icon name="plus" size={12} />
              {t.roomInvite}
            </button>
          </li>
        )}
      </ul>
      {status && <p className="mb-2 px-1 text-[11.5px] text-muted">{status}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {host && r.suggestions.length > 0 && (
          <section className="mb-3">
            <h3 className="mb-1 px-1 text-[10.5px] uppercase tracking-wider text-[var(--s-dim,var(--muted))]">{t.roomSuggestions}</h3>
            <ul>
              {r.suggestions.map((s) => (
                <Row key={s.uid} item={s} who={name(s.by)}>
                  <button type="button" className={small} aria-label={t.roomTake} title={t.roomTake} onClick={() => room.decide(s.uid, true)}>
                    <Icon name="check" size={15} />
                  </button>
                  <button type="button" className={small} aria-label={t.roomDismiss} title={t.roomDismiss} onClick={() => room.decide(s.uid, false)}>
                    <Icon name="close" size={14} />
                  </button>
                </Row>
              ))}
            </ul>
          </section>
        )}
        {!host && mySuggestions.length > 0 && (
          <section className="mb-3">
            <h3 className="mb-1 px-1 text-[10.5px] uppercase tracking-wider text-[var(--s-dim,var(--muted))]">{t.roomMySuggestions}</h3>
            <ul>
              {mySuggestions.map((s) => (
                <Row key={s.uid} item={s} who={t.roomWaitingForHost} />
              ))}
            </ul>
          </section>
        )}

        <section className="mb-3">
          <h3 className="mb-1 px-1 text-[10.5px] uppercase tracking-wider text-[var(--s-dim,var(--muted))]">{t.upNext}</h3>
          {r.queue.length === 0 ? (
            <p className="px-1 text-[12px] leading-snug text-muted">{host ? t.roomQueueEmptyHost : t.roomQueueEmpty}</p>
          ) : (
            <ul>
              {r.queue.map((q, i) => (
                <Row key={q.uid} item={q} who={q.auto ? t.roomAutopilotPick : q.by === r.host ? "" : name(q.by)}>
                  {host && (
                    <>
                      {i > 0 && (
                        <button type="button" className={`${small} opacity-0 group-hover:opacity-100`} aria-label={t.roomMoveUp} title={t.roomMoveUp} onClick={() => room.move(q.uid, i - 1)}>
                          <Icon name="back" size={14} className="rotate-90" />
                        </button>
                      )}
                      <button type="button" className={`${small} opacity-0 group-hover:opacity-100`} aria-label={t.remove} title={t.remove} onClick={() => room.remove(q.uid)}>
                        <Icon name="close" size={14} />
                      </button>
                    </>
                  )}
                </Row>
              ))}
            </ul>
          )}
        </section>

        {r.list && r.list.left > 0 && (
          <section className="mb-3">
            <div className="mb-1 flex items-center gap-2 px-1">
              <h3 className="min-w-0 truncate text-[10.5px] uppercase tracking-wider text-[var(--s-dim,var(--muted))]">{t.roomFromList(r.list.title)}</h3>
              <span className="shrink-0 text-[10.5px] text-muted">{t.roomListLeft(r.list.left)}</span>
              {host && (
                <button type="button" onClick={() => room.listClear()} className="ml-auto shrink-0 text-[11px] text-muted hover:text-text">
                  {t.roomListClear}
                </button>
              )}
            </div>
            <ul>
              {r.list.next.map((q) => (
                <Row key={q.uid} item={q} who="">
                  {host && (
                    <button type="button" className={`${small} opacity-0 group-hover:opacity-100`} aria-label={t.remove} title={t.remove} onClick={() => room.listRemove(q.uid)}>
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </Row>
              ))}
            </ul>
          </section>
        )}
        {host && autopilot && !r.queue.length && !r.list?.left && r.track && <p className="mb-3 px-1 text-[11.5px] text-muted">{t.roomAutopilotNext}</p>}

        {r.history.length > 1 && (
          <section className="mb-2">
            <div className="mb-1 flex items-center px-1">
              <h3 className="text-[10.5px] uppercase tracking-wider text-[var(--s-dim,var(--muted))]">{t.roomPlayed}</h3>
              <button type="button" disabled={saving} onClick={() => void save()} className="ml-auto text-[11px] text-muted hover:text-text disabled:opacity-50">
                {t.roomSavePlaylist}
              </button>
            </div>
            <ul>
              {[...r.history]
                .reverse()
                .slice(1, 11)
                .map((h, i) => (
                  <Row key={`${h.track.id}-${i}`} item={{ uid: "", track: h.track, by: "" }} who="" />
                ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
