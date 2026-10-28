import { create } from "zustand";
import { correction, roomPosition, SETTLING_FAR } from "@shared/roomSync";
import type { Room, RoomOp, RoomState, SocialTrack } from "@shared/social";
import { isLocalTrack, type QueueSource, type Track } from "@shared/types";
import { en as t } from "@/i18n/en";
import { call, on } from "@/lib/sky";
import { canPlay, roomPlayer, usePlayer, type Remote } from "./player";
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
  topUp(room, target);
  if (room.playing && status === "playing" && Date.now() >= quietUntil) {
    const c = correction(roomPlayer.time(), target, Date.now() < settleUntil ? SETTLING_FAR : undefined);
    if (c.seek !== undefined) {
      roomPlayer.seek(c.seek);
      quietUntil = Date.now() + 1500;
    }
    roomPlayer.setRate(c.rate);
  } else if (!room.playing || status !== "playing") roomPlayer.setRate(1);
}

/**
 * The host's autopilot, as in its own player (Settings → Autopilot): when the queue and the list have run out, tracks
 * similar to the one playing go into the room's queue a minute before its end — tried again in a while if SoundCloud
 * didn't answer. A room that already stopped at the end with nothing left gets them too and goes on.
 */
let toppedFor = 0;
let toppedAt = 0;
function topUp(room: Room, target: number) {
  if (!isHost() || !room.track || room.queue.length || room.list?.left || !useSettings.getState().prefs.autopilot) return;
  const left = room.track.durationMs / 1000 - target;
  const ended = !room.playing && !room.waiting && left <= 0.5;
  if (!ended && (!room.playing || left > 60)) return;
  if (toppedFor === room.track.id && Date.now() - toppedAt < 15_000) return;
  toppedFor = room.track.id;
  toppedAt = Date.now();
  const played = new Set(room.history.map((h) => h.track.id));
  void call("data:related", room.track.id)
    .then(async (related) => {
      const picks = related.filter((x) => canPlay(x) && !played.has(x.id)).slice(0, 5);
      for (const tr of picks) await act({ op: "queueAdd", track: toSocial(tr), auto: true });
      if (ended && picks.length) await act({ op: "next" });
    })
    .catch(() => undefined);
}

// ---- a list put on --------------------------------------------------------------------------------------------------

const LIST_MAX = 500;
/** bumped by every list put on: the late part of an older one goes nowhere */
let putting = 0;

function shuffled<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

async function listTitle(source: QueueSource): Promise<string> {
  switch (source.kind) {
    case "likes":
      return t.roomListLikes;
    case "playlist":
      return (await call("data:playlist", source.playlistId).catch(() => null))?.title ?? t.roomListPlaylist;
    case "userTracks":
      return t.roomListTracks;
    case "search":
      return t.roomListSearch(source.query);
    case "feed":
      return t.roomListFeed;
    default:
      return "";
  }
}

/** Full playable tracks for these ids, in their order, 200 a request (main knows most of them already from the list). */
async function tracksOf(ids: number[], known: Map<number, Track>): Promise<Track[]> {
  const missing = ids.filter((id) => !known.has(id));
  for (let i = 0; i < missing.length; i += 200) for (const tr of await call("data:tracks", missing.slice(i, i + 200))) known.set(tr.id, tr);
  return ids.map((id) => known.get(id)).filter((x): x is Track => !!x && canPlay(x));
}

/**
 * The host puts a list on (a playlist, the likes, search results…): the chosen track at once with what the page has
 * loaded after it, then the rest of the list (up to 500 tracks) once it's fetched. The room plays it after its queue,
 * so suggestions taken still come first. Shuffled: the whole list in a random order.
 */
async function putOn(tracks: Track[], index: number, source: QueueSource, shuffle: boolean) {
  const mine = ++putting;
  const known = new Map(tracks.map((x) => [x.id, x]));
  const title = listTitle(source);
  const allIds = (): Promise<number[]> =>
    source.kind === "static" ? Promise.resolve(tracks.map((x) => x.id)) : call("data:sourceIds", source).catch(() => tracks.map((x) => x.id));
  if (shuffle) {
    const order = shuffled(await allIds()).slice(0, LIST_MAX + 1);
    const head = await tracksOf(order.slice(0, 30), known);
    if (mine !== putting || !head.length) return;
    await act({ op: "playList", tracks: head.map(toSocial), title: await title });
    const rest = order.length > 30 ? await tracksOf(order.slice(30), known) : [];
    if (mine === putting && isHost() && rest.length) await act({ op: "listAppend", tracks: rest.map(toSocial) });
    return;
  }
  const first = tracks[index];
  if (!first) return;
  const loaded = tracks.slice(index + 1).filter(canPlay).slice(0, LIST_MAX);
  await act({ op: "playList", tracks: [first, ...loaded].map(toSocial), title: await title });
  // the part of the list the page hasn't loaded yet
  if (source.kind === "static" || loaded.length >= LIST_MAX) return;
  const ids = await allIds();
  const at = ids.indexOf(loaded.at(-1)?.id ?? first.id);
  if (at < 0) return;
  const rest = await tracksOf(ids.slice(at + 1, at + 1 + LIST_MAX - loaded.length), known);
  if (mine === putting && isHost() && rest.length) await act({ op: "listAppend", tracks: rest.map(toSocial) });
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

/** a file from this computer can't go to the room: said once, and nothing is sent */
const localOnly = (tr: Track | undefined) => {
  if (!tr || !isLocalTrack(tr.id)) return false;
  toast(t.roomNoLocal);
  return true;
};

const remote: Remote = {
  playFrom: (all, at, source, shuffle) => {
    if (!shuffle && localOnly(all[at])) return;
    const tracks = all.filter((x) => !isLocalTrack(x.id));
    if (!tracks.length) return void toast(t.roomNoLocal);
    const index = Math.max(0, tracks.indexOf(all[at]!));
    if (isHost()) return void putOn(tracks, index, source, !!shuffle).catch(() => toast(t.roomFailed));
    const tr = shuffle ? shuffled(tracks.filter(canPlay))[0] : tracks[index];
    if (tr) void suggest(tr);
  },
  toggle: () => setPlaying(!useRoom.getState().room?.playing),
  play: () => setPlaying(true),
  pause: () => setPlaying(false),
  next: () => hostOnly(() => void act({ op: "next" })),
  prev: () => hostOnly(() => void act({ op: "seek", position: 0 })),
  seek: (s) => hostOnly(() => void act({ op: "seek", position: s })),
  playNext: (tr) => (localOnly(tr) ? undefined : isHost() ? void act({ op: "queueAdd", track: toSocial(tr), next: true }) : void suggest(tr)),
  addToQueue: (tr) => (localOnly(tr) ? undefined : void suggest(tr)),
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
  /**
   * A whole list (a playlist, the likes…) suggested to the host: up to 500 of its tracks, files from this computer left
   * out. The host's own suggestion just puts it on.
   */
  async suggestList(tracks: Track[], source: QueueSource) {
    const known = new Map(tracks.map((x) => [x.id, x]));
    const ids = source.kind === "static" ? tracks.map((x) => x.id) : await call("data:sourceIds", source).catch(() => tracks.map((x) => x.id));
    const all = (await tracksOf(ids.filter((id) => !isLocalTrack(id)).slice(0, LIST_MAX), known)).map(toSocial);
    if (!all.length) return void toast(t.roomNoLocal);
    const r = await act({ op: "suggestList", tracks: all, title: (await listTitle(source)) || t.roomListPlaylist });
    if (r.result) toast(r.result === "already" ? t.roomAlreadySuggested : isHost() ? t.roomListOn : t.roomListSuggested(all.length));
  },
  listRemove: (item: string) => void act({ op: "listRemove", item }),
  listClear: () => void act({ op: "listClear" }),
  /** the host role to another member */
  handOver: (code: string) => void act({ op: "handOver", to: code }),
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
