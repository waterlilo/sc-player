import { create } from "zustand";
import { correction, roomPosition, SETTLING_FAR } from "@shared/roomSync";
import type { Room, RoomOp, RoomState, SocialTrack } from "@shared/social";
import type { Track } from "@shared/types";
import { en as t } from "@/i18n/en";
import { call, on } from "@/lib/sky";
import { roomPlayer, usePlayer, type Remote } from "./player";
import { useSettings } from "./settings";
import { toSocial } from "./social";
import { useUi } from "./ui";

/**
 * A listening room, the page's side (main/rooms.ts keeps the connection; the rules are the server's): while this app is
 * in a room, the player plays the room — its track from the room's second, paused when the room is — and catches up
 * by itself (state/../shared/roomSync); the player's buttons and menus ask the room instead of acting here.
 */

export const useRoom = create<RoomState>(() => ({ room: null, me: "", offset: 0, connected: false, closed: false }));
/** the "Listen together" sheet (components/room/RoomSheet) */
export const useRoomSheet = create<{ open: boolean }>(() => ({ open: false }));

const serverNow = () => Date.now() + useRoom.getState().offset;
const isHost = () => {
  const { room, me } = useRoom.getState();
  return !!room && room.host === me;
};
const toast = (text: string) => useUi.getState().showToast(text);
const act = (op: RoomOp): Promise<{ result?: "suggested" | "already" }> => call("room:do", op).catch((e: Error) => (toast(e.message), {}));

// ---- the room's tracks as the player's ------------------------------------------------------------------------------

/** full tracks for the room's (which carry only the basics), fetched once */
const full = new Map<number, Track>();
async function trackOf(s: SocialTrack): Promise<Track | null> {
  const known = full.get(s.id);
  if (known) return known;
  const [tr] = await call("data:tracks", [s.id]).catch(() => [] as Track[]);
  if (tr) full.set(s.id, tr);
  return tr ?? null;
}

/** the room track this app has loaded (or is loading); 0 when none */
let loaded = 0;
/** bumped on every load: a track that arrives late for an older room track is dropped */
let loading = 0;
/** "start together": the track this app said it is ready with */
let readyFor = 0;
/** the room's playing state as last applied here (a change is applied once; a missed one by the next check) */
let applied: { version: number; playing: boolean } | null = null;
/** just loaded or resumed: until then a gap is loading time and a seek closes it (SETTLING_FAR) */
let settleUntil = 0;
/** after a seek the decoder starts again: no new correction until then */
let quietUntil = 0;
const settle = () => (settleUntil = Date.now() + 6000);

async function load(room: Room) {
  const s = room.track!;
  const mine = ++loading;
  loaded = s.id;
  const tr = await trackOf(s);
  if (mine !== loading) return;
  if (!tr) {
    toast(t.roomTrackGone);
    return;
  }
  const now = useRoom.getState().room ?? room;
  roomPlayer.load(tr, roomPosition(now, serverNow()), now.playing && !now.waiting);
  applied = { version: now.version, playing: now.playing };
  settle();
}

/** Brings the player to the room: its track, its pause, its place. Run on every change and every second. */
function follow() {
  const { room } = useRoom.getState();
  if (!room) return;
  if (!room.track) {
    if (usePlayer.getState().status === "playing") roomPlayer.pause();
    return;
  }
  if (loaded !== room.track.id) return void load(room);
  const status = usePlayer.getState().status;
  // "start together": say so once the track is loaded here
  if (room.waiting && readyFor !== room.track.id && (status === "paused" || status === "playing")) {
    readyFor = room.track.id;
    void act({ op: "ready", trackId: room.track.id });
  }
  const target = roomPosition(room, serverNow());
  if (!applied || applied.version !== room.version || applied.playing !== room.playing) {
    applied = { version: room.version, playing: room.playing };
    if (room.playing && status !== "playing" && status !== "loading") {
      roomPlayer.seek(target);
      roomPlayer.play();
      settle();
    } else if (!room.playing && (status === "playing" || status === "loading")) {
      roomPlayer.pause();
      roomPlayer.seek(target);
    }
  }
  if (room.playing && status === "playing" && Date.now() >= quietUntil) {
    const c = correction(roomPlayer.time(), target, Date.now() < settleUntil ? SETTLING_FAR : undefined);
    if (c.seek !== undefined) {
      roomPlayer.seek(c.seek);
      quietUntil = Date.now() + 1500;
    }
    roomPlayer.setRate(c.rate);
    topUp(room, target);
  } else if (!room.playing || status !== "playing") roomPlayer.setRate(1);
}

/** The host's autopilot: near the end of a track with nothing queued, a few similar ones go into the room's queue. */
let toppedFor = 0;
function topUp(room: Room, target: number) {
  if (!isHost() || room.queue.length || !room.track || toppedFor === room.track.id) return;
  if (!useSettings.getState().prefs.autopilot || room.track.durationMs / 1000 - target > 25) return;
  toppedFor = room.track.id;
  const played = new Set(room.history.map((h) => h.track.id));
  void call("data:related", room.track.id)
    .then(async (related) => {
      for (const tr of related.filter((x) => !played.has(x.id)).slice(0, 3)) await act({ op: "queueAdd", track: toSocial(tr) });
    })
    .catch(() => undefined);
}

// ---- the player's buttons, in a room --------------------------------------------------------------------------------

const hostOnly = (then: () => void) => (isHost() ? then() : toast(t.roomHostOnly));
const suggest = async (tr: Track) => {
  if (isHost()) return void act({ op: "queueAdd", track: toSocial(tr) });
  const r = await act({ op: "suggest", track: toSocial(tr) });
  if (r.result) toast(r.result === "already" ? t.roomAlreadySuggested : t.roomSuggested);
};
const setPlaying = (playing: boolean) => {
  // at once here; the room follows in a moment
  if (playing) roomPlayer.play();
  else roomPlayer.pause();
  void act({ op: "playing", playing });
};

const remote: Remote = {
  playFrom: (tracks, index) => {
    const tr = tracks[index];
    if (!tr) return;
    if (isHost()) void act({ op: "play", track: toSocial(tr) });
    else void suggest(tr);
  },
  toggle: () => setPlaying(!useRoom.getState().room?.playing),
  play: () => setPlaying(true),
  pause: () => setPlaying(false),
  next: () => hostOnly(() => void act({ op: "next" })),
  prev: () => hostOnly(() => void act({ op: "seek", position: 0 })),
  seek: (s) => hostOnly(() => void act({ op: "seek", position: s })),
  playNext: (tr) => (isHost() ? void act({ op: "queueAdd", track: toSocial(tr), next: true }) : void suggest(tr)),
  addToQueue: (tr) => void suggest(tr),
  sleep: () => void leaveRoom(),
};

// ---- in and out -----------------------------------------------------------------------------------------------------

function take(s: RoomState) {
  const was = useRoom.getState().room;
  useRoom.setState(s);
  if (s.room && !was) roomPlayer.enter(remote);
  if (!s.room && was) {
    roomPlayer.leave();
    loaded = 0;
    applied = null;
    readyFor = 0;
    if (s.closed) toast(t.roomClosed);
    return;
  }
  follow();
}

let timer = 0;
export function initRoom() {
  on("room:state", take);
  void call("room:state")
    .then(take)
    .catch(() => undefined);
  window.clearInterval(timer);
  timer = window.setInterval(follow, 500);
}

/** The room's actions for its panel and dialogs. */
export const room = {
  async create(invite: string[], startTogether: boolean) {
    const p = usePlayer.getState();
    const cur = p.queue[p.index];
    await call("room:create", { startTogether, invite, track: cur ? toSocial(cur) : null, position: roomPlayer.time(), playing: p.status === "playing" });
  },
  invite: (codes: string[]) => call("room:invite", codes),
  join: (id: string) => call("room:join", id),
  leave: leaveRoom,
  remove: (item: string) => void act({ op: "queueRemove", item }),
  move: (item: string, to: number) => void act({ op: "queueMove", item, to }),
  decide: (item: string, take: boolean) => void act({ op: "decide", item, take }),
  /** everything that played, as full tracks (for saving as a playlist) */
  async history(): Promise<Track[]> {
    const list = await call("room:history");
    const ids = [...new Set(list.map((x) => x.id))];
    const tracks = await call("data:tracks", ids);
    const byId = new Map(tracks.map((x) => [x.id, x]));
    return ids.map((id) => byId.get(id)).filter((x): x is Track => !!x);
  },
};

export async function leaveRoom() {
  await call("room:leave").catch(() => undefined);
}
