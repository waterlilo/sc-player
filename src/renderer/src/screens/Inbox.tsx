import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Friends, Message } from "@shared/social";
import { Avatar, Cover, Eq, when } from "@/components/social/bits";
import { IconButton } from "@/components/ui/Buttons";
import Icon from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/States";
import { useT } from "@/i18n";
import { duration } from "@/lib/format";
import { call } from "@/lib/sky";
import { usePlayer } from "@/state/player";
import { playShared, refreshSocial, useSocial } from "@/state/social";
import { useUi } from "@/state/ui";

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message && !/^HTTP \d+$/.test(e.message) ? e.message.charAt(0).toUpperCase() + e.message.slice(1) : fallback);

/** Not on the server yet: a name and "Get my code". */
function Join() {
  const t = useT();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      useSocial.getState().setStatus(await call("social:join", name.trim()));
      await refreshSocial();
    } catch (err) {
      setError(errText(err, t.serverOffline));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid h-full place-items-center px-8">
      <form onSubmit={submit} className="w-[26rem] max-w-full" data-keys-own>
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-white/[0.06] text-glow">
          <Icon name="send" size={22} />
        </div>
        <h1 className="display-heading text-3xl text-text">{t.inboxJoinTitle}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t.inboxJoinText}</p>
        <label className="field sketch sketch-thin paper-fill mt-5 flex rounded-md">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder={t.yourName} aria-label={t.yourName} className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-text placeholder:text-muted/70" />
        </label>
        <button type="submit" disabled={busy || !name.trim()} className="marker-fill sketch sketch-thin mt-3 rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {busy ? t.loadingMore : t.getMyCode}
        </button>
        {error && <p className="mt-3 text-sm text-blood">{error}</p>}
        <p className="mt-6 text-xs leading-relaxed text-muted/80">{t.inboxPrivacy}</p>
      </form>
    </div>
  );
}

function MyCode({ code }: { code: string }) {
  const t = useT();
  const toast = useUi((s) => s.showToast);
  return (
    <button type="button" onClick={() => void call("clipboard:write", code).then(() => toast(t.codeCopied))} title={t.copyCode} className="flex w-full items-center gap-2 rounded-md bg-white/[0.04] px-3 py-2 text-left text-xs text-muted hover:bg-white/[0.07]">
      {t.yourCode}
      <b className="font-type text-sm font-semibold tracking-wider text-text">{code}</b>
      <Icon name="copy" size={14} className="ml-auto" />
    </button>
  );
}

function AddFriend({ onFriends }: { onFriends: (f: Friends) => void }) {
  const t = useT();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError("");
    try {
      onFriends(await call("social:addFriend", code.trim()));
      setCode("");
    } catch (err) {
      setError(errText(err, t.serverOffline));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} data-keys-own>
      <div className="flex gap-1.5">
        <label className="field sketch sketch-thin paper-fill flex min-w-0 flex-1 rounded-md">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={16} placeholder="SKY-XXXXX" aria-label={t.friendCode} className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 font-type text-sm tracking-wider text-text placeholder:text-muted/50" />
        </label>
        <button type="submit" disabled={busy || !code.trim()} title={t.addFriend} className="sketch sketch-thin flex items-center gap-1 rounded-md px-2.5 text-sm text-text disabled:opacity-50">
          <Icon name="plus" size={15} />
          {t.add}
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-blood">{error}</p>}
    </form>
  );
}

function People() {
  const t = useT();
  const status = useSocial((s) => s.status);
  const friends = useSocial((s) => s.friends);
  const unread = useSocial((s) => s.unread);
  const now = useSocial((s) => s.now);
  const open = useSocial((s) => s.open);
  const openChat = useSocial((s) => s.openChat);
  const setFriends = useSocial((s) => s.setFriends);
  const act = (p: Promise<Friends>) => void p.then(setFriends).catch(() => undefined);

  return (
    <section className="panel flex w-[300px] shrink-0 flex-col overflow-hidden rounded-md">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h1 className="display-heading text-2xl text-text">{t.inbox.toLowerCase()}</h1>
      </div>
      <div className="space-y-2 px-3">
        <MyCode code={status!.profile!.code} />
        <AddFriend onFriends={setFriends} />
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {!!friends?.incoming.length && <div className="px-2.5 pb-1 pt-2 font-type text-[0.65rem] uppercase tracking-[0.18em] text-muted">{t.requests}</div>}
        {friends?.incoming.map((r) => (
          <div key={r.code} className="flex items-center gap-2.5 rounded-md px-2.5 py-2">
            <Avatar name={r.name} code={r.code} size={30} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-text">{r.name || r.code}</span>
              <span className="block truncate font-type text-[0.7rem] text-muted">{r.code}</span>
            </span>
            <button type="button" onClick={() => act(call("social:accept", r.code))} className="marker-fill rounded-md px-2 py-1 text-xs font-semibold">
              {t.accept}
            </button>
            <IconButton icon="close" size={14} label={t.decline} onClick={() => act(call("social:removeFriend", r.code))} className="!h-7 !w-7" />
          </div>
        ))}
        {!!friends?.friends.length && <div className="px-2.5 pb-1 pt-2 font-type text-[0.65rem] uppercase tracking-[0.18em] text-muted">{t.friends}</div>}
        {friends?.friends.map((f) => {
          const live = now[f.code];
          const n = unread[f.code] ?? 0;
          return (
            <button
              key={f.code}
              type="button"
              onClick={() => openChat(f.code)}
              aria-current={open === f.code ? "true" : undefined}
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${open === f.code ? "bg-[var(--row-hover)]" : "hover:bg-[var(--row-hover)]"}`}
            >
              <Avatar name={f.name} code={f.code} size={34} live={!!live} />
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm ${n ? "font-semibold text-text" : "text-text"}`}>{f.name || f.code}</span>
                <span className="flex items-center gap-1.5 truncate text-xs text-muted">
                  {live ? (
                    <>
                      <Eq />
                      <span className="truncate">{live.title}</span>
                    </>
                  ) : (
                    <span className="font-type text-[0.7rem]">{f.code}</span>
                  )}
                </span>
              </span>
              {n > 0 && <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-glow px-1 font-type text-[0.65rem] font-semibold text-on-glow">{n}</span>}
            </button>
          );
        })}
        {!!friends?.outgoing.length && <div className="px-2.5 pb-1 pt-2 font-type text-[0.65rem] uppercase tracking-[0.18em] text-muted">{t.waiting}</div>}
        {friends?.outgoing.map((r) => (
          <div key={r.code} className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-muted">
            <Avatar name={r.name} code={r.code} size={26} />
            <span className="min-w-0 flex-1 truncate text-sm">{r.name || r.code}</span>
            <button type="button" onClick={() => act(call("social:removeFriend", r.code))} className="text-xs hover:text-text">
              {t.cancel}
            </button>
          </div>
        ))}
        {friends && !friends.friends.length && !friends.incoming.length && <p className="px-3 pt-4 text-sm leading-relaxed text-muted">{t.noFriendsHint}</p>}
      </div>
    </section>
  );
}

const STATE_ICON = { heard: "check", liked: "heart", queued: "queue" } as const;

function Bubble({ m, onPlay, playing }: { m: Message; onPlay: () => void; playing: boolean }) {
  const t = useT();
  const state = useSocial((s) => (m.mine ? (s.states[m.id] ?? m.state) : m.state));
  return (
    <div className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
      <button
        type="button"
        onClick={onPlay}
        className={`group flex w-[min(26rem,85%)] items-center gap-3 rounded-lg p-2 pr-3 text-left transition-colors ${m.mine ? "bg-white/[0.07] hover:bg-white/[0.1]" : "bg-white/[0.035] hover:bg-white/[0.07]"} ${playing ? "ring-1 ring-glow/60" : ""}`}
      >
        <span className="relative">
          <Cover url={m.track.artworkUrl} size={46} />
          <span className="absolute inset-0 grid place-items-center rounded-[5px] bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <Icon name={playing ? "pause" : "play"} size={16} />
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-medium ${playing ? "text-glow" : "text-text"}`}>{m.track.title}</span>
          <span className="block truncate text-xs text-muted">
            {m.track.artist} · <span className="font-type tabular-nums">{duration(m.track.durationMs)}</span>
          </span>
        </span>
        <span className="flex flex-col items-end gap-1 font-type text-[0.65rem] text-muted">
          {when(m.sent)}
          {m.mine && state && (
            <span title={t.messageState[state]} className="text-glow">
              <Icon name={STATE_ICON[state]} size={12} filled={state === "liked"} />
            </span>
          )}
        </span>
      </button>
    </div>
  );
}

function Chat({ code }: { code: string }) {
  const t = useT();
  const friend = useSocial((s) => s.friends?.friends.find((f) => f.code === code));
  const live = useSocial((s) => s.now[code]);
  const arrived = useSocial((s) => s.arrived);
  const setFriends = useSocial((s) => s.setFriends);
  const openChat = useSocial((s) => s.openChat);
  const toast = useUi((s) => s.showToast);
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    call("social:chat", code)
      .then((m) => alive && setMessages(m))
      .catch(() => alive && setFailed(true));
    void call("social:seen", code).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [code]);

  // tracks that arrive while the conversation is open join it
  const all = useMemo(() => {
    if (!messages) return null;
    const have = new Set(messages.map((m) => m.id));
    return [...messages, ...arrived.filter((m) => m.from === code && !have.has(m.id))].sort((a, b) => a.id - b.id);
  }, [messages, arrived, code]);

  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [all?.length]);

  const play = (i: number) => {
    if (!all) return;
    const list = all.slice(i);
    playShared(
      list.map((m) => m.track),
      0,
      list.filter((m) => !m.mine).slice(0, 1).map((m) => m.id),
    ).catch(() => toast(t.trackGone));
  };

  if (!friend) return null;
  const fromThem = all?.filter((m) => !m.mine) ?? [];

  return (
    <section className="panel flex min-w-0 flex-1 flex-col overflow-hidden rounded-md">
      <header className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <Avatar name={friend.name} code={friend.code} size={36} live={!!live} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-text">{friend.name || friend.code}</div>
          <div className="flex items-center gap-1.5 truncate text-xs text-muted">
            {live ? (
              <>
                <Eq />
                {t.listeningTo(live.title, live.artist)}
              </>
            ) : (
              <span className="font-type">{friend.code}</span>
            )}
          </div>
        </div>
        {fromThem.length > 1 && (
          <button
            type="button"
            onClick={() => void playShared(fromThem.map((m) => m.track), 0).catch(() => toast(t.trackGone))}
            className="sketch sketch-thin flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-text"
          >
            <Icon name="play" size={14} />
            {t.playAll} <span className="font-type text-xs text-muted">{fromThem.length}</span>
          </button>
        )}
        <IconButton
          icon="close"
          size={15}
          label={t.removeFriend}
          onClick={() => {
            if (!window.confirm(t.removeFriendConfirm(friend.name || friend.code))) return;
            void call("social:removeFriend", code).then((f) => {
              setFriends(f);
              openChat(null);
            });
          }}
        />
      </header>
      <div ref={box} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {failed && <p className="text-sm text-muted">{t.serverOffline}</p>}
        {all?.length === 0 && <p className="pt-10 text-center text-sm text-muted">{t.chatEmpty}</p>}
        {all?.map((m, i) => <Bubble key={m.id} m={m} playing={currentId === m.track.id} onPlay={() => play(i)} />)}
      </div>
      <p className="border-t border-white/[0.06] px-4 py-2.5 text-xs text-muted">{t.chatHint}</p>
    </section>
  );
}

/** The track messenger: friends on the left, the tracks you sent each other on the right. */
export default function Inbox() {
  const t = useT();
  const status = useSocial((s) => s.status);
  const open = useSocial((s) => s.open);
  const friends = useSocial((s) => s.friends);
  const openChat = useSocial((s) => s.openChat);

  useEffect(() => {
    void call("social:poll").catch(() => undefined);
  }, []);
  // nothing picked yet: the friend with the newest unread track, or the first one
  useEffect(() => {
    if (!open && friends?.friends.length) openChat(friends.friends[0]!.code);
  }, [open, friends, openChat]);

  if (!status) return null;
  if (!status.available) return <EmptyState caption={t.inboxUnavailable} />;
  if (!status.profile) return <Join />;
  return (
    <div className="flex h-full min-h-0 gap-3 px-3 pb-3 pt-3">
      <People />
      {open && friends?.friends.some((f) => f.code === open) ? (
        <Chat key={open} code={open} />
      ) : (
        <section className="panel grid flex-1 place-items-center rounded-md px-8 text-center text-sm text-muted">{t.inboxNoChat}</section>
      )}
    </div>
  );
}
