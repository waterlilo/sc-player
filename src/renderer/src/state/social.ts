import { create } from "zustand";
import type { Friends, Message, MessageState, RoomInvite, SocialStatus, SocialTrack } from "@shared/social";
import type { Track } from "@shared/types";
import { currentTime } from "@/audio/engine";
import { call, on } from "@/lib/sky";
import { useNav } from "./nav";
import { player, usePlayer } from "./player";

/**
 * The messenger as the page sees it: who I am on sc player's server, my friends, unread counts, what friends are
 * playing. main polls the server and pushes what changed; screens read it from here.
 */
interface SocialStore {
  status: SocialStatus | null;
  friends: Friends | null;
  unread: Record<string, number>;
  now: Record<string, SocialTrack>;
  /** what friends did with the tracks I sent */
  states: Record<string, MessageState>;
  /** tracks that arrived (or I sent) since the page started, newest last; `from` is the friend either way (an open chat adds them) */
  arrived: Message[];
  /** the friend whose conversation is open in the inbox */
  open: string | null;
  /** the "Send to friends" sheet, for this track */
  sending: SocialTrack | null;
  /** invitations to friends' listening rooms */
  invites: RoomInvite[];
  /** a friend link opened the app: this code, waiting for "Add" in the Inbox */
  linked: string | null;
  setStatus(s: SocialStatus): void;
  setFriends(f: Friends): void;
  openChat(code: string | null): void;
  openSend(track: Track | SocialTrack): void;
  closeSend(): void;
}

export const useSocial = create<SocialStore>((set) => ({
  status: null,
  friends: null,
  unread: {},
  now: {},
  states: {},
  arrived: [],
  open: null,
  sending: null,
  invites: [],
  linked: null,
  setStatus: (status) => set({ status }),
  setFriends: (friends) => set({ friends }),
  openChat: (open) => set((s) => ({ open, unread: open ? { ...s.unread, [open]: 0 } : s.unread })),
  openSend: (track) => set({ sending: toSocial(track) }),
  closeSend: () => set({ sending: null }),
}));

export const unreadTotal = (u: Record<string, number>) => Object.values(u).reduce((n, x) => n + x, 0);

export function toSocial(t: Track | SocialTrack): SocialTrack {
  return { id: t.id, title: t.title, artist: t.artist, artworkUrl: t.artworkUrl, permalinkUrl: t.permalinkUrl, durationMs: t.durationMs };
}

/** Play tracks friends sent: SoundCloud is asked for the full tracks first (the messages carry only the basics). */
export async function playShared(list: SocialTrack[], index: number, messageIds: number[] = []) {
  const ids = list.map((t) => t.id);
  const full = await call("data:tracks", ids);
  const byId = new Map(full.map((t) => [t.id, t]));
  const tracks = ids.map((id) => byId.get(id)).filter((t): t is Track => !!t);
  const at = tracks.findIndex((t) => t.id === list[index]?.id);
  if (!tracks.length) throw new Error("gone");
  player.playFrom(tracks, Math.max(0, at), { kind: "static" });
  for (const id of messageIds) void call("social:state", id, "heard").catch(() => undefined);
}

export async function refreshSocial() {
  const status = await call("social:status");
  useSocial.getState().setStatus(status);
  if (status.profile) useSocial.getState().setFriends(await call("social:friends"));
}

export function initSocial() {
  void refreshSocial().catch(() => useSocial.getState().setStatus({ available: true, profile: null }));
  on("social:update", (u) => {
    useSocial.setState((s) => ({
      friends: u.friends ?? s.friends,
      // the open conversation is being read: it stays at zero
      unread: s.open ? { ...u.unread, [s.open]: 0 } : u.unread,
      now: u.now,
      states: { ...s.states, ...u.states },
      arrived: u.messages.length ? [...s.arrived, ...u.messages].slice(-500) : s.arrived,
      invites: u.invites ?? [],
    }));
    const open = useSocial.getState().open;
    if (open && u.messages.some((m) => m.from === open) && useNav.getState().route.name === "inbox") void call("social:seen", open).catch(() => undefined);
  });
  on("social:friendLink", (code) => {
    useSocial.setState({ linked: code });
    useNav.getState().open("inbox", { name: "inbox" });
  });
  on("social:open", (code) => {
    useNav.getState().open("inbox", { name: "inbox" });
    useSocial.getState().openChat(code);
  });
  // friends see what is playing (main sends it only when sharing is on)
  usePlayer.subscribe((s, prev) => {
    const t = s.queue[s.index];
    if (t === prev.queue[prev.index] && s.status === prev.status) return;
    if (!useSocial.getState().status?.profile?.shareNow) return;
    void call("social:now", t && s.status !== "paused" && s.status !== "idle" ? toSocial(t) : null).catch(() => undefined);
  });
  // a track heard for half a minute (or half of a short one) counts for "Listening on sc player" — once per play; main
  // sends it only with sc player's server in the build and "Share what I play" on
  let counted = "";
  window.setInterval(() => {
    const s = usePlayer.getState();
    const t = s.queue[s.index];
    if (!t || s.status !== "playing") return;
    const play = `${s.index}:${t.id}`;
    if (counted === play || currentTime() < Math.min(30, (s.duration || 60) / 2)) return;
    counted = play;
    void call("social:listened", t.id).catch(() => undefined);
  }, 5000);
}
