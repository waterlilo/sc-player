import { create } from "zustand";
import type { PlayerSnapshot, RepeatMode } from "@shared/ipc";
import type { ErrorCode, Page, QueueSource, Track } from "@shared/types";
import * as engine from "@/audio/engine";
import { getActivity, subscribeActivity } from "@/lib/activity";
import { isHidden } from "@/lib/hidden";
import { call } from "@/lib/sky";
import { useSettings } from "./settings";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";

interface PlayerStore {
  queue: Track[];
  index: number;
  source: QueueSource;
  shuffle: boolean;
  /** the loaded list in its own order, kept while shuffled (to go back to it) */
  original: Track[] | null;
  /**
   * Track ids still to come, in play order: the rest of a shuffled list, or the list in order after what's loaded.
   * Filled into the queue a few at a time as it plays.
   */
  pending: number[];
  /** where the autopilot's similar tracks begin in the queue, -1 when there are none */
  autoFrom: number;
  status: PlayerStatus;
  error: ErrorCode | null;
  duration: number;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
}

const HISTORY_LIMIT = 300;
const FILL = 20; // tracks fetched from `pending` at a time
const AHEAD = 3; // keep at least this many tracks queued after the current one
/** Can this track be played (directly, or through another upload that may be found)? */
export const canPlay = (t: Track | undefined) => playable(t);
const playable = (t: Track | undefined): boolean =>
  !!t && !isHidden(t) && (t.playability === "ok" || t.playability === "preview" || (needsSub(t) && useSubs.getState().byTrack[t.id]?.state !== "none"));

// ---- substitutes: another playable upload of a track SoundCloud only streams with DRM (or as a preview) -----------

interface Sub {
  state: "searching" | "found" | "none";
  candidates: Track[];
  pick: number;
  /** "none" because the search failed (timeout, network), not because nothing exists: searched again next time */
  failed?: boolean;
  /** the deep search ("try another upload" ran out of candidates) was done */
  deep?: boolean;
}

/** What was found for each protected track this session (main also remembers it on disk). */
export const useSubs = create<{ byTrack: Record<number, Sub> }>(() => ({ byTrack: {} }));
const setSub = (id: number, sub: Sub) => useSubs.setState((s) => ({ byTrack: { ...s.byTrack, [id]: sub } }));

/** Should this track be played from another upload? (Settings → substitute, and not switched off for this track.) */
export function needsSub(t: Track) {
  const p = useSettings.getState().prefs;
  return p.substitute && t.playability !== "ok" && !p.noSubstitute.includes(t.id);
}

/** The upload that plays instead of `t`, once found. */
export function substituteFor(t: Track): Track | null {
  const s = useSubs.getState().byTrack[t.id];
  return s?.state === "found" ? (s.candidates[s.pick] ?? null) : null;
}

/** For the player bar and the waveform: the track whose sound actually plays. */
export function useStreamTrack(track: Track | null): Track | null {
  const sub = useSubs((s) => (track ? s.byTrack[track.id] : undefined));
  const on = useSettings((s) => !!track && s.prefs.substitute && !s.prefs.noSubstitute.includes(track.id));
  if (!track || track.playability === "ok" || !on || sub?.state !== "found") return track;
  return sub.candidates[sub.pick] ?? track;
}

const pendingSubs = new Map<number, Promise<Track | null>>();

/** Finds (once) the other upload for a protected track; null when there is none. */
function resolveSub(t: Track): Promise<Track | null> {
  const known = useSubs.getState().byTrack[t.id];
  if (known?.state === "found") return Promise.resolve(known.candidates[known.pick] ?? null);
  if (known?.state === "none" && !known.failed) return Promise.resolve(null);
  const pending = pendingSubs.get(t.id);
  if (pending) return pending;
  setSub(t.id, { state: "searching", candidates: [], pick: 0 });
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 25_000));
  const run = Promise.race([call("data:alternatives", t.id), timeout])
    .then((list) => {
      const ok = list.filter((c) => !isHidden(c));
      setSub(t.id, ok.length ? { state: "found", candidates: ok, pick: 0 } : { state: "none", candidates: [], pick: 0 });
      return ok[0] ?? null;
    })
    .catch(() => {
      setSub(t.id, { state: "none", candidates: [], pick: 0, failed: true });
      return null;
    })
    .finally(() => pendingSubs.delete(t.id));
  pendingSubs.set(t.id, run);
  return run;
}

/** Look for the next track's substitute while this one plays, so the change (and the crossfade) is seamless. */
function prefetchNextSub() {
  const { index, repeat, queue } = get();
  const next = queue[nextIndex(index, repeat === "all")];
  if (next && needsSub(next)) void resolveSub(next);
}

export const usePlayer = create<PlayerStore>(() => ({
  queue: [],
  index: -1,
  source: { kind: "static" },
  shuffle: false,
  original: null,
  pending: [],
  autoFrom: -1,
  status: "idle",
  error: null,
  duration: 0,
  volume: 0.8,
  muted: false,
  repeat: "off",
}));

/** Position in seconds, ~4 updates a second (from the audio element); kept apart so lists don't re-render. */
export const usePosition = create<{ position: number }>(() => ({ position: 0 }));

export const currentTrack = () => {
  const { queue, index } = usePlayer.getState();
  return queue[index] ?? null;
};
export const useCurrentTrack = () => usePlayer((s) => s.queue[s.index] ?? null);

const set = usePlayer.setState;
const get = usePlayer.getState;

function shuffled<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Tracks added by hand ("play next", "add to queue"): they stay put when the queue is rebuilt. */
const manual = new WeakSet<Track>();

function remember(track: Track) {
  const { history, save } = useSettings.getState();
  save({ history: [track, ...history.filter((t) => t.id !== track.id)].slice(0, HISTORY_LIMIT) });
}

/** the sleep timer's "stop at the end of this track": no crossfade, no next track */
let stopAtEnd = false;
let onStopAtEnd: (() => void) | null = null;
export function stopAfterTrack(on: boolean, done?: () => void) {
  stopAtEnd = on;
  onStopAtEnd = on ? (done ?? null) : null;
}

/** bumped on every start: a substitute found late for a track that is no longer current is not played */
let starts = 0;

function start(index: number, opts: { autoplay?: boolean; startAt?: number } = {}) {
  const track = get().queue[index];
  if (!track) return;
  const gen = ++starts;
  const autoplay = opts.autoplay ?? true;
  set({ index, error: null, duration: track.durationMs / 1000 });
  usePosition.setState({ position: opts.startAt ?? 0 });
  if (autoplay) remember(track);
  void topUp();
  if (!needsSub(track)) {
    void engine.load(track, { autoplay, startAt: opts.startAt });
    prefetchNextSub();
    return;
  }
  // a protected track: play another upload of it; a preview plays as is if there is none; otherwise skip
  set({ status: "loading" });
  void resolveSub(track).then((alt) => {
    if (gen !== starts) return;
    if (alt) {
      set({ duration: alt.durationMs / 1000 });
      void engine.load(track, { autoplay, startAt: opts.startAt, streamId: alt.id });
    } else if (track.playability === "preview") {
      void engine.load(track, { autoplay, startAt: opts.startAt });
    } else {
      set({ status: "error", error: "unavailable" });
      window.clearTimeout(skipTimer);
      skipTimer = window.setTimeout(() => void advance(true), 600);
      return;
    }
    prefetchNextSub();
  });
}

// ---- whole lists --------------------------------------------------------------------------------------------------

const sourceKey = (s: QueueSource) => JSON.stringify({ ...s, cursor: null });
const idCache = new Map<string, { at: number; ids: number[] }>();
const ID_TTL = 10 * 60_000;

/** Every track id of the list a queue came from (all likes, the whole playlist), cached for a few minutes. */
async function sourceIds(source: QueueSource): Promise<number[]> {
  if (source.kind === "static") return [];
  const key = sourceKey(source);
  const hit = idCache.get(key);
  if (hit && Date.now() - hit.at < ID_TTL) return hit.ids;
  const ids = await call("data:sourceIds", source);
  idCache.set(key, { at: Date.now(), ids });
  return ids;
}
const cachedSourceIds = (source: QueueSource) => {
  const hit = idCache.get(sourceKey(source));
  return hit && Date.now() - hit.at < ID_TTL ? hit.ids : null;
};

/** bumped whenever the queue is rebuilt: a whole-list shuffle that arrives late for an older queue is dropped */
let rebuild = 0;

/**
 * A true shuffle: the rest of the WHOLE list (not just the loaded page) in one uniform random order. What has been
 * played stays, tracks added by hand stay next, everything else is replaced by the shuffled remainder.
 */
async function shuffleWholeList() {
  const gen = ++rebuild;
  const { source } = get();
  let ids: number[];
  try {
    ids = await sourceIds(source);
  } catch {
    return; // keep the shuffle of the loaded tracks
  }
  const now = get();
  if (gen !== rebuild || !now.shuffle || !ids.length) return;
  const played = new Set(now.queue.slice(0, now.index + 1).map((t) => t.id));
  const keep = now.queue.slice(now.index + 1).filter((t) => manual.has(t));
  set({ queue: [...now.queue.slice(0, now.index + 1), ...keep], pending: shuffled(ids.filter((id) => !played.has(id))), autoFrom: -1 });
  await topUp(true);
}

// ---- keeping the queue filled -------------------------------------------------------------------------------------

let toppingUp = false;

async function fetchPage(source: QueueSource): Promise<Page<Track> | null> {
  switch (source.kind) {
    case "likes":
      if (!source.cursor) return null;
      return source.userId === "me" ? call("data:likes", source.cursor) : call("data:userLikes", source.userId, source.cursor);
    case "userTracks":
      return source.cursor ? call("data:userTracks", source.userId, source.cursor) : null;
    case "playlist":
      return source.cursor ? call("data:playlistTracks", source.playlistId, source.cursor) : null;
    case "search":
      return source.cursor ? ((await call("data:search", source.query, "tracks", source.cursor)) as Page<Track>) : null;
    case "feed":
      return source.cursor ? call("data:feed", source.cursor) : null;
    default:
      return null;
  }
}

const append = (tracks: Track[]) => {
  const fresh = tracks.filter(playable);
  if (fresh.length) set({ queue: [...get().queue, ...fresh] });
  return fresh.length;
};

/**
 * Keeps a few tracks queued ahead. In order: the next ids from `pending`; else the next page of the list (in list
 * order); else the list is really over — repeat "all" starts it again (a fresh shuffle when shuffled), and with
 * repeat off the autopilot continues with similar tracks. The autopilot never steps in while any of the list is left.
 */
async function topUp(force = false) {
  if (toppingUp) return;
  if (!force && get().queue.length - get().index > AHEAD) return;
  toppingUp = true;
  const gen = rebuild;
  try {
    for (let guard = 0; guard < 6 && get().queue.length - get().index <= AHEAD; guard++) {
      const s = get();
      if (s.pending.length) {
        const take = s.pending.slice(0, FILL);
        const tracks = await call("data:tracks", take);
        if (gen !== rebuild) return;
        set({ pending: get().pending.slice(take.length) });
        append(tracks);
        continue;
      }
      if (s.source.kind !== "static" && s.source.cursor) {
        const page = await fetchPage(s.source);
        if (gen !== rebuild) return;
        if (!page) break;
        const have = new Set(get().queue.map((t) => t.id));
        set({ source: { ...s.source, cursor: page.next } });
        append(page.items.filter((t) => !have.has(t.id)));
        continue;
      }
      // the list is over
      if (s.repeat === "all") {
        if (s.shuffle && s.source.kind !== "static") {
          const ids = await sourceIds(s.source);
          if (gen !== rebuild) return;
          const current = s.queue[s.index]?.id;
          set({ pending: shuffled(ids.filter((id) => id !== current)) });
          continue;
        }
        break; // in order: advance() wraps around to the first track
      }
      if (!useSettings.getState().prefs.autopilot) break;
      const last = s.queue[s.queue.length - 1];
      if (!last) break;
      const related = await call("data:related", last.id);
      if (gen !== rebuild) return;
      const recent = new Set(get().queue.slice(-200).map((t) => t.id));
      const from = get().queue.length;
      if (!append(related.filter((t) => !recent.has(t.id)))) break;
      if (get().autoFrom < 0) set({ autoFrom: from });
    }
  } catch {
    /* can't grow right now: the queue just ends here */
  } finally {
    toppingUp = false;
  }
}

/** Next playable index after `from` (wrapping when allowed), or -1. */
function nextIndex(from: number, wrap: boolean) {
  const { queue } = get();
  for (let i = from + 1; i < queue.length; i++) if (playable(queue[i])) return i;
  if (wrap) for (let i = 0; i <= from && i < queue.length; i++) if (playable(queue[i])) return i;
  return -1;
}

// ---- engine → store -----------------------------------------------------------------------------------------------

let skipTimer = 0;

engine.bindEngine({
  loading: () => set({ status: "loading" }),
  playing: () => set({ status: "playing", error: null }),
  paused: () => set({ status: get().status === "error" ? "error" : "paused" }),
  duration: (d) => set({ duration: d }),
  // nobody sees the time while the window is hidden: no DOM updates then (they kept the GPU process busy)
  time: (t) => {
    if (getActivity() !== "hidden") usePosition.setState({ position: t });
  },
  ended: () => {
    if (stopAtEnd) {
      // the sleep timer's "end of track"
      stopAtEnd = false;
      onStopAtEnd?.();
      engine.seek(0);
      set({ status: "paused" });
      return;
    }
    if (get().repeat === "one") {
      engine.seek(0);
      engine.play();
      return;
    }
    void advance(true);
  },
  peekNext: () => {
    const { repeat, index, queue } = get();
    if (repeat === "one" || stopAtEnd) return null;
    const t = queue[nextIndex(index, repeat === "all")];
    if (!t) return null;
    if (!needsSub(t)) return { track: t, streamId: t.id };
    const alt = substituteFor(t);
    if (alt) return { track: t, streamId: alt.id };
    // not found yet: no crossfade into it (the normal change will search and wait)
    return t.playability === "preview" && useSubs.getState().byTrack[t.id]?.state === "none" ? { track: t, streamId: t.id } : null;
  },
  // SoundCloud sent a 30 s preview for a track its list entry called full (the subscription or region changed since
  // the list was read, or it came from history): from now on it's a preview, and another upload is looked for
  snippet: (track) => {
    track.playability = "preview";
    if (!needsSub(track)) return;
    void resolveSub(track).then((alt) => {
      if (!alt || currentTrack() !== track || engine.activeStreamId() !== track.id) return;
      set({ duration: alt.durationMs / 1000 });
      void engine.load(track, { autoplay: get().status !== "paused", streamId: alt.id });
    });
  },
  advanced: (track) => {
    const { queue, index } = get();
    let at = queue.indexOf(track, index + 1);
    if (at < 0) at = queue.findIndex((t, i) => i > index && t.id === track.id);
    if (at < 0) return;
    starts++;
    const alt = needsSub(track) ? substituteFor(track) : null;
    set({ index: at, error: null, duration: (alt ?? track).durationMs / 1000 });
    usePosition.setState({ position: 0 });
    remember(track);
    void topUp();
    prefetchNextSub();
  },
  error: (code) => {
    set({ status: "error", error: code });
    // a track SoundCloud won't stream to us (DRM, region): skip it; network trouble waits for "retry"
    if (code === "unavailable" || code === "not_found") {
      window.clearTimeout(skipTimer);
      skipTimer = window.setTimeout(() => void advance(true), 1200);
    }
  },
});

subscribeActivity(() => {
  if (getActivity() !== "hidden") usePosition.setState({ position: engine.currentTime() });
});

async function advance(auto: boolean) {
  await topUp(true);
  const { index, repeat } = get();
  const next = nextIndex(index, repeat === "all" || !auto);
  if (next >= 0) start(next);
  else {
    engine.pause();
    engine.seek(0);
    set({ status: "paused" });
  }
}

// ---- actions ------------------------------------------------------------------------------------------------------

export const player = {
  /** Play `tracks` from `index`; `source` lets the queue keep loading (or shuffle) the whole list it came from. */
  playFrom(tracks: Track[], index: number, source: QueueSource) {
    const target = tracks[index];
    if (!target) return;
    rebuild++;
    if (get().shuffle) {
      const rest = shuffled(tracks.filter((t, i) => i !== index && playable(t)));
      set({ queue: [target, ...rest], original: [...tracks], pending: [], source, autoFrom: -1 });
      start(0);
      void shuffleWholeList();
    } else {
      set({ queue: [...tracks], original: null, pending: [], source, autoFrom: -1 });
      start(index);
    }
  },
  /** The Shuffle button of a list: shuffle on, a random first track from the whole list when it's known. */
  async shuffleFrom(tracks: Track[], source: QueueSource) {
    const gen = ++rebuild;
    set({ shuffle: true });
    let first = shuffled(tracks.filter(playable))[0];
    try {
      // a whole-list pick when the ids come quickly (a playlist always does; huge likes may take longer)
      const ids = await Promise.race([sourceIds(source), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
      if (gen !== rebuild) return;
      if (ids?.length) {
        const picks = await call("data:tracks", shuffled(ids).slice(0, 5));
        const pick = picks.find(playable);
        if (pick) first = pick;
      }
    } catch {
      /* fall back to a loaded track */
    }
    if (!first || gen !== rebuild) return;
    const chosen = first;
    const index = tracks.findIndex((t) => t.id === chosen.id);
    player.playFrom(index >= 0 ? tracks : [chosen, ...tracks], index >= 0 ? index : 0, source);
  },
  jumpTo(index: number) {
    if (playable(get().queue[index])) start(index);
  },
  toggle() {
    const { status, index } = get();
    if (index < 0) return;
    if (status === "playing" || status === "loading") engine.pause();
    else if (status === "error") start(index);
    else engine.play();
  },
  play: () => engine.play(),
  pause: () => engine.pause(),
  next: () => void advance(false),
  /** Back to the start if more than 3 s in, otherwise the previous playable track. */
  prev() {
    const { index, queue } = get();
    if (engine.currentTime() > 3) {
      engine.seek(0);
      return;
    }
    for (let i = index - 1; i >= 0; i--) if (playable(queue[i])) return start(i);
    engine.seek(0);
  },
  seek(seconds: number) {
    engine.seek(seconds);
    usePosition.setState({ position: seconds });
  },
  seekBy(delta: number) {
    player.seek(Math.min(get().duration, Math.max(0, engine.currentTime() + delta)));
  },
  setVolume(volume: number) {
    const v = Math.max(0, Math.min(1, volume));
    set({ volume: v, muted: v === 0 ? get().muted : false });
    engine.setVolume(v, get().muted);
    saveVolume();
  },
  toggleMute() {
    set({ muted: !get().muted });
    engine.setVolume(get().volume, get().muted);
    saveVolume();
  },
  /**
   * Shuffle on: the loaded tracks are shuffled at once (no pause in the music), then the whole list is fetched and
   * the rest of the queue becomes a uniform shuffle of all of it. Off: back to list order, right after the track
   * that is playing.
   */
  toggleShuffle() {
    const s = get();
    const current = s.queue[s.index];
    const played = s.queue.slice(0, s.index + 1);
    const upcoming = s.queue.slice(s.index + 1);
    const keep = upcoming.filter((t) => manual.has(t));
    rebuild++;
    if (!s.shuffle) {
      const rest = shuffled(upcoming.filter((t) => !manual.has(t)));
      set({ shuffle: true, original: s.original ?? s.queue.filter((t) => !manual.has(t)), queue: [...played, ...keep, ...rest], pending: shuffled(s.pending), autoFrom: -1 });
      void shuffleWholeList();
      return;
    }
    const ids = cachedSourceIds(s.source);
    const at = current && ids ? ids.indexOf(current.id) : -1;
    if (ids && at >= 0) {
      // the list order after the current track, filled as it plays (the cursor isn't needed any more)
      set({ shuffle: false, original: null, queue: [...played, ...keep], pending: ids.slice(at + 1), source: { ...s.source, cursor: null } as QueueSource, autoFrom: -1 });
    } else {
      const list = s.original ?? [];
      const pos = current ? list.findIndex((t) => t.id === current.id) : -1;
      set({ shuffle: false, original: null, queue: [...played, ...keep, ...(pos >= 0 ? list.slice(pos + 1) : [])], pending: [], autoFrom: -1 });
    }
    void topUp(true);
  },
  cycleRepeat() {
    const order: RepeatMode[] = ["off", "all", "one"];
    set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length] });
  },
  playNext(track: Track) {
    const { queue, index, autoFrom } = get();
    if (index < 0) return player.playFrom([track], 0, { kind: "static" });
    const item = { ...track };
    manual.add(item);
    const q = [...queue];
    // after the current track and any tracks already added by hand
    let at = index + 1;
    while (at < q.length && manual.has(q[at]!)) at++;
    q.splice(at, 0, item);
    set({ queue: q, autoFrom: autoFrom >= at ? autoFrom + 1 : autoFrom });
  },
  addToQueue(track: Track) {
    const { queue, index, autoFrom } = get();
    if (index < 0) return player.playFrom([track], 0, { kind: "static" });
    const item = { ...track };
    manual.add(item);
    // before the autopilot's suggestions, if there are any
    const q = [...queue];
    const at = autoFrom >= 0 ? autoFrom : q.length;
    q.splice(at, 0, item);
    set({ queue: q, autoFrom: autoFrom >= 0 ? autoFrom + 1 : -1 });
  },
  removeAt(i: number) {
    const { queue, index, autoFrom } = get();
    if (i === index || i < 0 || i >= queue.length) return;
    set({ queue: queue.filter((_, k) => k !== i), index: i < index ? index - 1 : index, autoFrom: autoFrom > i ? autoFrom - 1 : autoFrom });
  },
  /** Drag in the queue panel: move upcoming item `from` to `to` (queue indexes). */
  move(from: number, to: number) {
    const { queue, index } = get();
    if (from === to || from === index || to <= index) return;
    const q = [...queue];
    const [item] = q.splice(from, 1);
    q.splice(to, 0, item!);
    set({ queue: q });
  },
  clearUpcoming() {
    rebuild++;
    const { queue, index } = get();
    set({ queue: queue.slice(0, index + 1), pending: [], source: { kind: "static" }, autoFrom: -1 });
  },
  retry() {
    const { index } = get();
    if (index >= 0) start(index, { startAt: usePosition.getState().position });
  },
  /** "Wrong version?": the next found upload for the current protected track, from the start. */
  /**
   * The next found upload of a substituted track (the current one when none is given). At the end of the list the
   * search runs once more, deeper; null when there is no other upload. The current track restarts with the new one.
   */
  async tryAnotherVersion(track?: Track): Promise<{ upload: Track; at: number; of: number } | null> {
    const t = track ?? currentTrack();
    let s = t ? useSubs.getState().byTrack[t.id] : undefined;
    if (!t || !s || s.state !== "found") return null;
    if (s.pick + 1 >= s.candidates.length && !s.deep) {
      const more = await call("data:alternatives", t.id, true).catch(() => [] as Track[]);
      const now = useSubs.getState().byTrack[t.id];
      if (!now || now.state !== "found") return null;
      const fresh = more.filter((c) => !isHidden(c) && !now.candidates.some((x) => x.id === c.id));
      s = { ...now, candidates: [...now.candidates, ...fresh], deep: true };
      setSub(t.id, s);
    }
    if (s.candidates.length < 2) return null;
    const pick = (s.pick + 1) % s.candidates.length;
    setSub(t.id, { ...s, pick });
    const { queue, index } = get();
    if (queue[index]?.id === t.id) start(index);
    return { upload: s.candidates[pick]!, at: pick + 1, of: s.candidates.length };
  },
  /** Substitute this track or not (the menu); the current track restarts with the new choice. */
  setSubstitute(track: Track, on: boolean) {
    const { prefs, setPref } = useSettings.getState();
    setPref("noSubstitute", on ? prefs.noSubstitute.filter((id) => id !== track.id) : [...prefs.noSubstitute.filter((id) => id !== track.id), track.id]);
    const { queue, index } = get();
    if (queue[index]?.id === track.id) start(index);
  },
};

// ---- persistence (phase 2 restores this on start) -----------------------------------------------------------------

export function snapshot(): PlayerSnapshot | null {
  const s = get();
  if (s.index < 0) return null;
  return {
    queue: s.queue,
    original: s.original,
    index: s.index,
    source: s.source,
    position: engine.currentTime(),
    volume: s.volume,
    muted: s.muted,
    repeat: s.repeat,
  };
}

/** Volume and mute are remembered between runs (settings.json); written once the slider settles. */
let volumeTimer = 0;
function saveVolume() {
  window.clearTimeout(volumeTimer);
  volumeTimer = window.setTimeout(() => {
    const { volume, muted } = get();
    useSettings.getState().save({ volume, muted });
  }, 300);
}

/** At start: the remembered volume. */
export function initVolume() {
  const { volume, muted } = useSettings.getState();
  set({ volume: Math.max(0, Math.min(1, volume)), muted });
  engine.setVolume(get().volume, get().muted);
}

// dev only: inspect the queue from DevTools (window.__player.getState()) and drive it (window.__actions.playFrom(…))
if (import.meta.env.DEV) Object.assign(window, { __player: usePlayer, __actions: player });
