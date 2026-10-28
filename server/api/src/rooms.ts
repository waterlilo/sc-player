import { randomBytes } from "node:crypto";
import { fail } from "./http.ts";

/**
 * Listening rooms: friends hear the same track at the same moment, each from SoundCloud on their own — the server only
 * keeps what plays, from which second, and whether it is paused. The host picks the tracks: a list to play through
 * (a playlist, the likes…) and the queue, which goes first; everyone may pause or resume for all; the others suggest
 * tracks, the host takes them into the queue or not. The host may hand the room to another member; when the host
 * leaves (or is gone for a while), the member who joined first becomes host. A room lives in memory: a restart
 * of the server closes it (the apps say so and play on as usual).
 *
 * The state is the server's alone and every change bumps `version`: the apps get the whole room each time (never
 * changes to apply), so nothing is lost or applied twice when a connection drops. Commands set things ("pause",
 * "play this track"), so a repeated one does no harm. Time is the server's clock, passed in, so this is tested alone.
 */

export interface RoomTrack {
  id: number;
  title: string;
  artist: string;
  artworkUrl: string | null;
  permalinkUrl: string;
  durationMs: number;
}

export interface Person {
  id: number;
  code: string;
  name: string;
}

interface Member extends Person {
  joined: number;
  /** open event streams of this member (an app may reconnect before the old stream closes) */
  streams: number;
  /** when the last stream closed (or the member joined) */
  gone: number;
}

interface Item {
  uid: string;
  track: RoomTrack;
  by: string;
  /** picked by the host's autopilot: makes way when the host puts a list on */
  auto?: boolean;
}

export interface Room {
  id: string;
  version: number;
  created: number;
  host: number;
  members: Member[];
  /** device id → when the invitation runs out */
  invited: Map<number, { by: string; at: number; until: number }>;
  startTogether: boolean;
  track: RoomTrack | null;
  /** seconds into the track at `at` (server time), moving on from there while playing */
  position: number;
  at: number;
  playing: boolean;
  /** who paused or resumed last (shown as "Paused by …") */
  by: string;
  /** "start together": the track waits until everyone has it loaded, or until this time */
  waiting: { until: number; ready: Set<number> } | null;
  queue: Item[];
  /** what the host put on (a playlist, the likes…): played on after the queue, in order */
  list: { title: string; items: Item[] } | null;
  /** `list`: a whole playlist suggested (its first track is `track`, which older apps show) */
  suggestions: (Item & { at: number; list?: { title: string; tracks: RoomTrack[] } })[];
  history: { track: RoomTrack; at: number }[];
}

export const LIMITS = {
  members: 10,
  queue: 100,
  /** tracks of a list put on */
  list: 500,
  suggestions: 30,
  /** waiting suggestions per member */
  suggestionsEach: 5,
  history: 300,
  rooms: 500,
  inviteMs: 6 * 60 * 60_000,
  /**
   * a host without an open stream this long hands the room on. Not shorter: a VPN or a network that drops for a few
   * seconds (seen: every 3 hours on the hour, ~15 s) must not cost the host the room; leaving hands it on at once
   */
  hostGoneMs: 60_000,
  /** a member without one this long leaves */
  memberGoneMs: 2 * 60_000,
  /** "start together" waits at most this long for everyone */
  startWaitMs: 3_000,
  /** past the track's length by this much, the next one starts (the apps' lengths differ a little) */
  endGraceMs: 1_000,
};

const uid = () => randomBytes(6).toString("base64url");

export class Rooms {
  private rooms = new Map<string, Room>();
  /** room id → listeners told after each change */
  private listeners = new Map<string, Set<(closed: boolean) => void>>();

  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  /** The room this device is in, if any. */
  roomOf(device: number): Room | undefined {
    for (const r of this.rooms.values()) if (r.members.some((m) => m.id === device)) return r;
    return undefined;
  }

  /** Invitations waiting for this device (rooms it isn't in yet). */
  invitesFor(device: number): { room: string; by: string; at: number; host: string; track: RoomTrack | null; members: number }[] {
    const now = this.now();
    const out = [];
    for (const r of this.rooms.values()) {
      const inv = r.invited.get(device);
      if (!inv || inv.until <= now || r.members.some((m) => m.id === device)) continue;
      out.push({ room: r.id, by: inv.by, at: inv.at, host: this.hostOf(r).code, track: r.track, members: r.members.length });
    }
    return out;
  }

  subscribe(room: string, fn: (closed: boolean) => void): () => void {
    let set = this.listeners.get(room);
    if (!set) this.listeners.set(room, (set = new Set()));
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (!set!.size) this.listeners.delete(room);
    };
  }

  private changed(r: Room) {
    r.version++;
    for (const fn of this.listeners.get(r.id) ?? []) fn(false);
  }

  private close(r: Room) {
    this.rooms.delete(r.id);
    for (const fn of this.listeners.get(r.id) ?? []) fn(true);
    this.listeners.delete(r.id);
  }

  private room(id: string): Room {
    return this.rooms.get(id) ?? fail(404, "this room is closed");
  }

  private member(r: Room, device: number): Member {
    return r.members.find((m) => m.id === device) ?? fail(403, "not in this room");
  }

  private hostOf(r: Room): Member {
    return r.members.find((m) => m.id === r.host)!;
  }

  private onlyHost(r: Room, device: number) {
    this.member(r, device);
    if (r.host !== device) fail(403, "only the host can do that");
  }

  /** Where the track is now, in seconds. */
  positionOf(r: Room, now = this.now()): number {
    return r.playing ? r.position + (now - r.at) / 1000 : r.position;
  }

  // ---- joining and leaving ----------------------------------------------------------------------------------------

  create(host: Person, opts: { startTogether: boolean; track?: RoomTrack | null; position?: number; playing?: boolean }): Room {
    const other = this.roomOf(host.id);
    if (other) this.leave(other.id, host.id);
    if (this.rooms.size >= LIMITS.rooms) fail(503, "too many rooms right now");
    const now = this.now();
    const r: Room = {
      id: uid(),
      version: 1,
      created: now,
      host: host.id,
      members: [{ ...host, joined: now, streams: 0, gone: now }],
      invited: new Map(),
      startTogether: opts.startTogether,
      track: opts.track ?? null,
      position: Math.max(0, opts.position ?? 0),
      at: now,
      playing: !!opts.track && opts.playing !== false,
      by: host.code,
      waiting: null,
      queue: [],
      list: null,
      suggestions: [],
      history: opts.track ? [{ track: opts.track, at: now }] : [],
    };
    this.rooms.set(r.id, r);
    return r;
  }

  invite(id: string, device: number, friends: Person[]) {
    const r = this.room(id);
    this.onlyHost(r, device);
    const now = this.now();
    const by = this.hostOf(r).code;
    for (const f of friends) if (!r.members.some((m) => m.id === f.id)) r.invited.set(f.id, { by, at: now, until: now + LIMITS.inviteMs });
    this.changed(r);
  }

  join(id: string, who: Person): Room {
    const r = this.room(id);
    if (r.members.some((m) => m.id === who.id)) return r;
    const inv = r.invited.get(who.id);
    if (!inv || inv.until <= this.now()) fail(403, "the invitation has run out");
    if (r.members.length >= LIMITS.members) fail(409, "the room is full");
    const other = this.roomOf(who.id);
    if (other) this.leave(other.id, who.id);
    const now = this.now();
    r.members.push({ ...who, joined: now, streams: 0, gone: now });
    r.invited.delete(who.id);
    this.changed(r);
    return r;
  }

  leave(id: string, device: number) {
    const r = this.rooms.get(id);
    const m = r?.members.find((x) => x.id === device);
    if (!r || !m) return;
    r.members = r.members.filter((x) => x.id !== device);
    r.suggestions = r.suggestions.filter((s) => s.by !== m.code);
    if (!r.members.length) return this.close(r);
    if (r.host === device) this.handOn(r);
    this.changed(r);
  }

  /** The host role goes to whoever joined first — someone connected, if anyone is. */
  private handOn(r: Room) {
    const next = r.members.filter((m) => m.id !== r.host).sort((a, b) => (b.streams > 0 ? 1 : 0) - (a.streams > 0 ? 1 : 0) || a.joined - b.joined)[0];
    if (next) this.makeHost(r, next);
  }

  private makeHost(r: Room, m: Member) {
    r.host = m.id;
    // a suggestion from the new host is the host's own choice now
    r.suggestions = r.suggestions.filter((s) => s.by !== m.code);
  }

  /** The host gives the room to another member. */
  handOver(id: string, device: number, code: string) {
    const r = this.room(id);
    this.onlyHost(r, device);
    const to = r.members.find((m) => m.code === code) ?? fail(404, "not in this room");
    if (to.id === device) return;
    this.makeHost(r, to);
    this.changed(r);
  }

  connected(id: string, device: number) {
    const r = this.room(id);
    this.member(r, device).streams++;
    this.changed(r);
  }

  disconnected(id: string, device: number) {
    const r = this.rooms.get(id);
    const m = r?.members.find((x) => x.id === device);
    if (!r || !m) return;
    m.streams = Math.max(0, m.streams - 1);
    if (!m.streams) m.gone = this.now();
    this.changed(r);
  }

  // ---- playing ----------------------------------------------------------------------------------------------------

  /** The host starts a track (from `position`); with "start together" it waits until everyone has it loaded. */
  play(id: string, device: number, track: RoomTrack, position = 0) {
    const r = this.room(id);
    this.onlyHost(r, device);
    this.start(r, track, position);
    this.changed(r);
  }

  /** The host puts on a list: its first track now, the rest after the queue, in order. */
  playList(id: string, device: number, tracks: RoomTrack[], title: string) {
    const r = this.room(id);
    this.onlyHost(r, device);
    if (!tracks.length) fail(400, "no tracks");
    const by = this.hostOf(r).code;
    const rest = tracks.slice(1, LIMITS.list + 1);
    r.queue = r.queue.filter((q) => !q.auto);
    r.list = rest.length ? { title, items: rest.map((track) => ({ uid: uid(), track, by })) } : null;
    this.start(r, tracks[0]!, 0);
    this.changed(r);
  }

  /** The rest of a long list, sent once the host's app has it (the first part goes with playList, at once). */
  listAppend(id: string, device: number, tracks: RoomTrack[]) {
    const r = this.room(id);
    this.onlyHost(r, device);
    const by = this.hostOf(r).code;
    const list = (r.list ??= { title: "", items: [] });
    for (const track of tracks.slice(0, LIMITS.list - list.items.length)) list.items.push({ uid: uid(), track, by });
    if (!list.items.length) r.list = null;
    this.changed(r);
  }

  listRemove(id: string, device: number, item: string) {
    const r = this.room(id);
    this.onlyHost(r, device);
    if (!r.list) return;
    r.list.items = r.list.items.filter((q) => q.uid !== item);
    if (!r.list.items.length) r.list = null;
    this.changed(r);
  }

  listClear(id: string, device: number) {
    const r = this.room(id);
    this.onlyHost(r, device);
    r.list = null;
    this.changed(r);
  }

  private start(r: Room, track: RoomTrack, position: number) {
    const now = this.now();
    r.track = track;
    r.position = Math.max(0, position);
    r.at = now;
    r.by = this.hostOf(r).code;
    r.history.push({ track, at: now });
    if (r.history.length > LIMITS.history) r.history.splice(0, r.history.length - LIMITS.history);
    if (r.startTogether && r.members.length > 1) {
      r.playing = false;
      r.waiting = { until: now + LIMITS.startWaitMs, ready: new Set() };
    } else {
      r.playing = true;
      r.waiting = null;
    }
  }

  /** Anyone pauses or resumes for everyone. */
  setPlaying(id: string, device: number, playing: boolean) {
    const r = this.room(id);
    const m = this.member(r, device);
    if (!r.track) return;
    const now = this.now();
    if (r.playing === playing && !r.waiting) return;
    r.position = this.positionOf(r, now);
    r.at = now;
    r.playing = playing;
    r.waiting = null;
    r.by = m.code;
    this.changed(r);
  }

  seek(id: string, device: number, position: number) {
    const r = this.room(id);
    this.onlyHost(r, device);
    if (!r.track) return;
    r.position = Math.max(0, Math.min(position, r.track.durationMs / 1000));
    r.at = this.now();
    this.changed(r);
  }

  /** The next track: the queue's, else the list's; with neither, the room stops at the end. */
  next(id: string, device: number) {
    const r = this.room(id);
    this.onlyHost(r, device);
    this.advance(r);
    this.changed(r);
  }

  private advance(r: Room) {
    const item = r.queue.shift() ?? r.list?.items.shift();
    if (r.list && !r.list.items.length) r.list = null;
    if (item) return this.start(r, item.track, 0);
    if (r.track) r.position = r.track.durationMs / 1000;
    r.at = this.now();
    r.playing = false;
    r.waiting = null;
  }

  /** "Start together": this member has the track loaded; the room starts when everyone connected has. */
  ready(id: string, device: number, trackId: number) {
    const r = this.room(id);
    this.member(r, device);
    if (!r.waiting || r.track?.id !== trackId) return;
    r.waiting.ready.add(device);
    if (r.members.every((m) => !m.streams || r.waiting!.ready.has(m.id))) {
      this.go(r);
      this.changed(r);
    }
  }

  private go(r: Room) {
    r.waiting = null;
    r.playing = true;
    r.at = this.now();
  }

  // ---- the queue and suggestions ----------------------------------------------------------------------------------

  queueAdd(id: string, device: number, track: RoomTrack, next = false, auto = false) {
    const r = this.room(id);
    this.onlyHost(r, device);
    if (r.queue.length >= LIMITS.queue) fail(409, "the queue is full");
    const item: Item = { uid: uid(), track, by: this.hostOf(r).code, ...(auto ? { auto: true } : {}) };
    if (next) r.queue.unshift(item);
    else r.queue.push(item);
    this.changed(r);
  }

  queueRemove(id: string, device: number, item: string) {
    const r = this.room(id);
    this.onlyHost(r, device);
    r.queue = r.queue.filter((q) => q.uid !== item);
    this.changed(r);
  }

  queueMove(id: string, device: number, item: string, to: number) {
    const r = this.room(id);
    this.onlyHost(r, device);
    const from = r.queue.findIndex((q) => q.uid === item);
    if (from < 0) return;
    const [it] = r.queue.splice(from, 1);
    r.queue.splice(Math.max(0, Math.min(to, r.queue.length)), 0, it!);
    this.changed(r);
  }

  /** A member suggests a track to the host (the host just adds it). Repeats and full lists are refused quietly. */
  suggest(id: string, device: number, track: RoomTrack): "suggested" | "already" {
    const r = this.room(id);
    const m = this.member(r, device);
    if (r.host === device) {
      this.queueAdd(id, device, track);
      return "suggested";
    }
    if (r.suggestions.some((s) => s.track.id === track.id) || r.queue.some((q) => q.track.id === track.id)) return "already";
    if (r.suggestions.filter((s) => s.by === m.code).length >= LIMITS.suggestionsEach) fail(429, `at most ${LIMITS.suggestionsEach} suggestions waiting at a time`);
    if (r.suggestions.length >= LIMITS.suggestions) fail(429, "the host has enough suggestions for now");
    r.suggestions.push({ uid: uid(), track, by: m.code, at: this.now() });
    this.changed(r);
    return "suggested";
  }

  /**
   * A member suggests a whole playlist: one suggestion (of the member's few) that the host takes in one go. The host
   * suggesting is just putting it on.
   */
  suggestList(id: string, device: number, tracks: RoomTrack[], title: string): "suggested" | "already" {
    const r = this.room(id);
    const m = this.member(r, device);
    if (!tracks.length) fail(400, "no tracks");
    if (r.host === device) {
      this.playList(id, device, tracks, title);
      return "suggested";
    }
    if (r.suggestions.some((s) => s.list && s.list.title === title && s.track.id === tracks[0]!.id)) return "already";
    if (r.suggestions.filter((s) => s.by === m.code).length >= LIMITS.suggestionsEach) fail(429, `at most ${LIMITS.suggestionsEach} suggestions waiting at a time`);
    if (r.suggestions.length >= LIMITS.suggestions) fail(429, "the host has enough suggestions for now");
    r.suggestions.push({ uid: uid(), track: tracks[0]!, by: m.code, at: this.now(), list: { title, tracks: tracks.slice(0, LIMITS.list) } });
    this.changed(r);
    return "suggested";
  }

  /**
   * The host takes a suggestion or lets it go. A track goes to the end of the queue; a playlist after what is put on
   * (it starts at once when nothing is playing).
   */
  decide(id: string, device: number, item: string, take: boolean) {
    const r = this.room(id);
    this.onlyHost(r, device);
    const s = r.suggestions.find((x) => x.uid === item);
    if (!s) return;
    r.suggestions = r.suggestions.filter((x) => x.uid !== item);
    if (take && s.list) {
      const list = (r.list ??= { title: s.list.title, items: [] });
      for (const track of s.list.tracks.slice(0, LIMITS.list - list.items.length)) list.items.push({ uid: uid(), track, by: s.by });
      if (!list.items.length) r.list = null;
      const ended = !r.track || (!r.playing && r.position * 1000 >= r.track.durationMs);
      if (ended && !r.queue.length && r.list) this.advance(r);
    } else if (take && r.queue.length < LIMITS.queue) r.queue.push({ uid: s.uid, track: s.track, by: s.by });
    this.changed(r);
  }

  // ---- the clock --------------------------------------------------------------------------------------------------

  /** Called a few times a second: tracks that ended, "start together" timeouts, hosts and members who are gone. */
  tick() {
    const now = this.now();
    for (const r of [...this.rooms.values()]) {
      let moved = false;
      if (r.waiting && now >= r.waiting.until) {
        this.go(r);
        moved = true;
      }
      if (r.playing && r.track && this.positionOf(r, now) * 1000 >= r.track.durationMs + LIMITS.endGraceMs) {
        this.advance(r);
        moved = true;
      }
      for (const [dev, inv] of r.invited) if (inv.until <= now) r.invited.delete(dev);
      const host = this.hostOf(r);
      if (host && !host.streams && now - host.gone > LIMITS.hostGoneMs && r.members.some((m) => m.id !== host.id && m.streams)) {
        this.handOn(r);
        moved = true;
      }
      const stale = r.members.filter((m) => !m.streams && now - m.gone > LIMITS.memberGoneMs);
      if (stale.length) {
        if (stale.length === r.members.length) {
          this.close(r);
          continue;
        }
        for (const m of stale) {
          r.members = r.members.filter((x) => x.id !== m.id);
          r.suggestions = r.suggestions.filter((s) => s.by !== m.code);
        }
        if (!r.members.some((m) => m.id === r.host)) this.handOn(r);
        moved = true;
      }
      if (moved) this.changed(r);
    }
  }

  // ---- what the apps see ------------------------------------------------------------------------------------------

  /** The whole room as the apps get it, with the server's time to measure against. */
  view(r: Room) {
    const now = this.now();
    return {
      id: r.id,
      version: r.version,
      now,
      host: this.hostOf(r).code,
      startTogether: r.startTogether,
      members: r.members.map((m) => ({ code: m.code, name: m.name, here: m.streams > 0 })),
      track: r.track,
      position: r.position,
      at: r.at,
      playing: r.playing,
      by: r.by,
      waiting: r.waiting ? { until: r.waiting.until, ready: r.members.filter((m) => r.waiting!.ready.has(m.id)).map((m) => m.code) } : null,
      queue: r.queue,
      // the next few of the list and how many are left (the whole list would go out with every change)
      list: r.list ? { title: r.list.title, left: r.list.items.length, next: r.list.items.slice(0, 20) } : null,
      // a suggested playlist goes out as its name and size (all its tracks with every change would be too much)
      suggestions: r.suggestions.map(({ list, ...s }) => (list ? { ...s, list: { title: list.title, count: list.tracks.length } } : s)),
      // the latest few; the whole history comes on request (saving it as a playlist)
      history: r.history.slice(-30),
    };
  }
}
