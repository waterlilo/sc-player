import { create } from "zustand";
import type { PlayerSnapshot, RepeatMode } from "@shared/ipc";
import type { ErrorCode, Page, QueueSource, Track } from "@shared/types";
import * as engine from "@/audio/engine";
import { getActivity, subscribeActivity } from "@/lib/activity";
import { call } from "@/lib/sky";
import { useSettings } from "./settings";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";

interface PlayerStore {
  queue: Track[];
  /** queue order before shuffle; null = shuffle off */
  original: Track[] | null;
  index: number;
  source: QueueSource;
  status: PlayerStatus;
  error: ErrorCode | null;
  duration: number;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
}

const HISTORY_LIMIT = 300;
const playable = (t: Track | undefined) => !!t && (t.playability === "ok" || t.playability === "preview");

export const usePlayer = create<PlayerStore>(() => ({
  queue: [],
  original: null,
  index: -1,
  source: { kind: "static" },
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

function remember(track: Track) {
  const { history, save } = useSettings.getState();
  save({ history: [track, ...history.filter((t) => t.id !== track.id)].slice(0, HISTORY_LIMIT) });
}

function start(index: number, opts: { autoplay?: boolean; startAt?: number } = {}) {
  const track = get().queue[index];
  if (!track) return;
  set({ index, error: null, duration: track.durationMs / 1000 });
  usePosition.setState({ position: opts.startAt ?? 0 });
  void engine.load(track, { autoplay: opts.autoplay ?? true, startAt: opts.startAt });
  if (opts.autoplay ?? true) remember(track);
  void topUp();
}

// ---- endless sources: when the queue nears its end, the next page of the list it came from is appended -----------

let toppingUp = false;

async function fetchMore(source: QueueSource): Promise<Page<Track> | null> {
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
    default:
      return null;
  }
}

async function topUp() {
  const { queue, index, source } = get();
  if (toppingUp || queue.length - index > 3 || source.kind === "static" || !source.cursor) return;
  toppingUp = true;
  try {
    const page = await fetchMore(source);
    if (!page) return;
    const known = new Set(get().queue.map((t) => t.id));
    const fresh = page.items.filter((t) => !known.has(t.id));
    const s = get();
    set({
      queue: [...s.queue, ...(s.original ? shuffled(fresh) : fresh)],
      original: s.original ? [...s.original, ...fresh] : null,
      source: { ...source, cursor: page.next },
    });
  } catch {
    /* the list can't grow right now; the queue just ends here */
  } finally {
    toppingUp = false;
  }
}

/** Next playable index after `from` (wrapping when repeat is "all"), or -1. */
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
    if (get().repeat === "one") {
      engine.seek(0);
      engine.play();
      return;
    }
    void advance(true);
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
  await topUp();
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
  /** Play `tracks` from `index`; `source` lets the queue keep loading the list it came from. */
  playFrom(tracks: Track[], index: number, source: QueueSource) {
    const target = tracks[index];
    if (!target) return;
    const shuffleOn = get().original !== null;
    if (shuffleOn) {
      const rest = shuffled(tracks.filter((_, i) => i !== index));
      set({ queue: [target, ...rest], original: [...tracks], source });
      start(0);
    } else {
      set({ queue: [...tracks], original: null, source });
      start(index);
    }
  },
  /** Shuffle-play a whole list. */
  shuffleFrom(tracks: Track[], source: QueueSource) {
    const list = tracks.filter(playable);
    if (!list.length) return;
    const order = shuffled(list);
    set({ queue: order, original: [...tracks], source });
    start(0);
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
  toggleShuffle() {
    const { queue, index, original } = get();
    const current = queue[index];
    if (original) {
      // back to the list order, at the track that is playing
      const at = current ? original.findIndex((t) => t.id === current.id) : -1;
      set({ queue: original, original: null, index: at >= 0 ? at : 0 });
    } else {
      const rest = shuffled(queue.filter((_, i) => i !== index));
      set({ queue: current ? [current, ...rest] : rest, original: [...queue], index: current ? 0 : -1 });
    }
  },
  cycleRepeat() {
    const order: RepeatMode[] = ["off", "all", "one"];
    set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length] });
  },
  playNext(track: Track) {
    const { queue, index, original } = get();
    if (index < 0) return player.playFrom([track], 0, { kind: "static" });
    const q = [...queue];
    q.splice(index + 1, 0, track);
    set({ queue: q, original: original ? [...original, track] : null });
  },
  addToQueue(track: Track) {
    const { queue, index, original } = get();
    if (index < 0) return player.playFrom([track], 0, { kind: "static" });
    set({ queue: [...queue, track], original: original ? [...original, track] : null });
  },
  removeAt(i: number) {
    const { queue, index, original } = get();
    if (i === index || i < 0 || i >= queue.length) return;
    const removed = queue[i]!;
    set({
      queue: queue.filter((_, k) => k !== i),
      index: i < index ? index - 1 : index,
      original: original ? original.filter((t) => t !== removed) : null,
    });
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
    const { queue, index } = get();
    set({ queue: queue.slice(0, index + 1), source: { kind: "static" } });
  },
  retry() {
    const { index } = get();
    if (index >= 0) start(index, { startAt: usePosition.getState().position });
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
