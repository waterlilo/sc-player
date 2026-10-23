import type HlsType from "hls.js";
import type { ErrorData } from "hls.js";
import { EQ_BANDS } from "@shared/ipc";
import type { ErrorCode, StreamInfo, Track } from "@shared/types";
import { call, errorCode } from "@/lib/sky";

/**
 * Playback. SoundCloud streams AAC over HLS (hls.js feeds it through Media Source Extensions); a progressive MP3
 * plays directly. Stream URLs are signed and short-lived, so a network failure mid-track asks main for a fresh URL
 * once and resumes at the same position.
 *
 * Two decks (an <audio> each) make the crossfade: near the end of a track the next one starts on the other deck and
 * the two volumes cross over. The equalizer is a Web Audio chain that is only built once it's switched on — until
 * then the decks play straight to the speakers and cost nothing extra.
 */
export interface EngineEvents {
  loading(): void;
  playing(): void;
  paused(): void;
  ended(): void;
  duration(seconds: number): void;
  time(seconds: number): void;
  error(code: ErrorCode): void;
  /** the next track to crossfade into (and whose stream to play: a substitute upload's id), or null */
  peekNext(): { track: Track; streamId: number } | null;
  /** the track's own stream turned out to be a 30 s preview */
  snippet(track: Track): void;
  /** a crossfade moved playback on to `track` */
  advanced(track: Track): void;
}

let Hls: typeof HlsType | null = null;
const loadHls = async () => (Hls ??= (await import("hls.js/light")).default);

let events: EngineEvents | null = null;
let volume = 0.8;
let muted = false;
let crossfade = 0;
let sinkId = "";

// ---- the optional Web Audio chain (equalizer) ---------------------------------------------------------------------

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let filters: BiquadFilterNode[] = [];
let eq = { enabled: false, gains: EQ_BANDS.map(() => 0) as number[] };

function graph() {
  if (ctx) return ctx;
  ctx = new AudioContext({ latencyHint: "playback" });
  bus = ctx.createGain();
  filters = EQ_BANDS.map((hz, i) => {
    const f = ctx!.createBiquadFilter();
    f.type = i === 0 ? "lowshelf" : i === EQ_BANDS.length - 1 ? "highshelf" : "peaking";
    f.frequency.value = hz;
    f.Q.value = 1.1;
    return f;
  });
  bus.connect(filters[0]!);
  filters.forEach((f, i) => f.connect(filters[i + 1] ?? ctx!.destination));
  for (const deck of decks) deck.route();
  applyEq();
  if (sinkId) void applySink();
  return ctx;
}

function applyEq() {
  filters.forEach((f, i) => (f.gain.value = eq.enabled ? (eq.gains[i] ?? 0) : 0));
}

/** with the equalizer on, the audio graph sleeps while nothing plays (it would keep a thread busy) */
let sleepTimer = 0;
function sleepSoon() {
  window.clearTimeout(sleepTimer);
  sleepTimer = window.setTimeout(() => {
    if (ctx && decks.every((d) => d.audio.paused)) void ctx.suspend();
  }, 1500);
}

// ---- decks --------------------------------------------------------------------------------------------------------

class Deck {
  readonly audio = new Audio();
  hls: HlsType | null = null;
  track: Track | null = null;
  /** the track whose stream plays: the track itself, or the other upload substituted for it */
  streamId = 0;
  /** bumped on every load: answers for an older track are ignored */
  gen = 0;
  refreshed = false;
  mediaRecovered = false;
  /** a track is starting: the pause events the old source fires while switching are not a real pause */
  starting = false;
  /** 0..1, the crossfade's share of this deck */
  level = 1;
  gain: GainNode | null = null;

  constructor() {
    this.audio.preload = "auto";
    // so the equalizer may read the samples (SoundCloud's CDN answers with CORS; main adds the header if missing)
    this.audio.crossOrigin = "anonymous";
    const on = (ev: string, fn: () => void) => this.audio.addEventListener(ev, () => this === active && fn());
    on("playing", () => {
      this.starting = false;
      events?.playing();
    });
    on("pause", () => {
      if (!this.audio.ended && !this.starting) events?.paused();
      sleepSoon();
    });
    on("waiting", () => events?.loading());
    on("ended", () => events?.ended());
    on("durationchange", () => {
      if (Number.isFinite(this.audio.duration)) events?.duration(this.audio.duration);
    });
    on("timeupdate", () => {
      events?.time(this.audio.currentTime);
      maybeCrossfade();
    });
    this.audio.addEventListener("error", () => {
      if (!this.hls && this.track) void this.recover("offline");
    });
  }

  /** connect into the Web Audio chain once it exists */
  route() {
    if (!ctx || !bus || this.gain) return;
    const src = ctx.createMediaElementSource(this.audio);
    this.gain = ctx.createGain();
    src.connect(this.gain).connect(bus);
    this.audio.volume = 1;
    this.applyLevel();
  }

  applyLevel() {
    const v = muted ? 0 : volume * volume * this.level;
    if (this.gain) this.gain.gain.value = v;
    else this.audio.volume = Math.max(0, Math.min(1, v));
  }

  teardown() {
    this.hls?.destroy();
    this.hls = null;
    this.audio.removeAttribute("src");
    this.audio.load();
  }

  attach(info: StreamInfo, startAt: number, autoplay: boolean) {
    this.teardown();
    const H = Hls;
    if (info.protocol === "hls" && H?.isSupported()) {
      // no worker: the page's CSP stays strict, and remuxing a single audio stream is light
      const hls = new H({ enableWorker: false, startPosition: startAt > 0 ? startAt : -1, maxBufferLength: 60, backBufferLength: 30 });
      this.hls = hls;
      hls.on(H.Events.ERROR, (_e, data: ErrorData) => {
        if (!data.fatal) return;
        if (data.type === H.ErrorTypes.MEDIA_ERROR && !this.mediaRecovered) {
          this.mediaRecovered = true;
          hls.recoverMediaError();
          return;
        }
        void this.recover(data.type === H.ErrorTypes.NETWORK_ERROR ? "offline" : "unknown");
      });
      hls.loadSource(info.url);
      hls.attachMedia(this.audio);
    } else {
      this.audio.src = info.url;
      if (startAt > 0) this.audio.addEventListener("loadedmetadata", () => (this.audio.currentTime = startAt), { once: true });
    }
    if (autoplay) {
      this.starting = true;
      void ctx?.resume();
      void this.audio.play().catch(() => {
        this.starting = false;
        if (this === active) events?.paused();
      });
    }
  }

  /** The signed URL probably expired: get a new one once and continue where we were. */
  async recover(code: ErrorCode) {
    const track = this.track;
    if (!track) return;
    if (this.refreshed) {
      if (this === active) events?.error(code);
      return;
    }
    this.refreshed = true;
    const at = this.audio.currentTime;
    const wasPlaying = !this.audio.paused;
    const gen = this.gen;
    try {
      const info = await call("data:stream", this.streamId);
      if (info.protocol === "hls") await loadHls();
      if (gen !== this.gen) return;
      this.attach(info, at, wasPlaying);
    } catch (err) {
      if (gen === this.gen && this === active) events?.error(errorCode(err));
    }
  }

  /** Resolves true once the stream is attached (and playing, with autoplay). */
  async load(track: Track, opts: { autoplay: boolean; startAt?: number; streamId?: number }): Promise<boolean> {
    const gen = ++this.gen;
    this.track = track;
    this.streamId = opts.streamId ?? track.id;
    this.refreshed = false;
    this.mediaRecovered = false;
    this.starting = opts.autoplay;
    this.teardown();
    try {
      const info = await call("data:stream", this.streamId);
      if (info.protocol === "hls") await loadHls();
      if (gen !== this.gen) return false;
      this.attach(info, opts.startAt ?? 0, opts.autoplay);
      if (info.snipped && this.streamId === track.id && track.playability === "ok") events?.snippet(track);
      return true;
    } catch (err) {
      if (gen === this.gen) {
        this.starting = false;
        if (this === active) events?.error(errorCode(err));
      }
      return false;
    }
  }

  stop() {
    this.gen++;
    this.track = null;
    this.audio.pause();
    this.teardown();
  }
}

const decks = [new Deck(), new Deck()] as const;
let active: Deck = decks[0];
const other = () => (active === decks[0] ? decks[1] : decks[0]);

// ---- crossfade ----------------------------------------------------------------------------------------------------

let fade: { from: Deck; to: Deck; startedAt: number; length: number; timer: number } | null = null;
let preparing = false;

function endFade() {
  if (!fade) return;
  window.clearInterval(fade.timer);
  fade.from.stop();
  fade.from.level = 1;
  fade.to.level = 1;
  fade.from.applyLevel();
  fade.to.applyLevel();
  fade = null;
}

function maybeCrossfade() {
  if (!crossfade || fade || preparing || active.audio.paused) return;
  const left = active.audio.duration - active.audio.currentTime;
  if (!Number.isFinite(left) || left > crossfade || left < 0.5) return;
  const next = events?.peekNext();
  if (!next) return;
  preparing = true;
  const from = active;
  const to = other();
  const length = Math.max(0.5, left);
  to.level = 0;
  to.applyLevel();
  void to.load(next.track, { autoplay: true, streamId: next.streamId }).then((ok) => {
    preparing = false;
    if (!ok || from !== active || from.audio.paused) {
      if (to !== active) to.stop();
      return;
    }
    // the next track is now the current one; the old deck fades out underneath
    active = to;
    events?.advanced(next.track);
    if (Number.isFinite(to.audio.duration)) events?.duration(to.audio.duration);
    const startedAt = performance.now();
    fade = {
      from,
      to,
      startedAt,
      length,
      timer: window.setInterval(() => {
        const k = Math.min(1, (performance.now() - startedAt) / (length * 1000));
        from.level = 1 - k;
        to.level = k;
        from.applyLevel();
        to.applyLevel();
        if (k >= 1) endFade();
      }, 50),
    };
  });
}

// ---- public -------------------------------------------------------------------------------------------------------

export const currentTime = () => active.audio.currentTime;
/** whose stream the current deck plays (the track's own id, or a substitute upload's) */
export const activeStreamId = () => active.streamId;

export function bindEngine(handlers: EngineEvents) {
  events = handlers;
}

export async function load(track: Track, opts: { autoplay: boolean; startAt?: number; streamId?: number }) {
  endFade();
  preparing = false;
  other().stop();
  active.level = 1;
  active.applyLevel();
  events?.loading();
  const ok = await active.load(track, opts);
  if (ok && !opts.autoplay) events?.paused();
}

export function stop() {
  endFade();
  decks.forEach((d) => d.stop());
}

export function play() {
  if (!active.track) return;
  void ctx?.resume();
  void active.audio.play().catch(() => events?.paused());
}

export function pause() {
  endFade();
  active.audio.pause();
}

export function seek(seconds: number) {
  if (!Number.isFinite(seconds)) return;
  endFade();
  active.audio.currentTime = Math.max(0, seconds);
}

/**
 * A touch faster or slower (a listening room catching up with the others), the pitch kept; a new track starts at 1.
 */
export function setRate(rate: number) {
  const r = Math.max(0.9, Math.min(1.1, rate));
  for (const d of decks) {
    d.audio.preservesPitch = true;
    if (d.audio.playbackRate !== r) d.audio.playbackRate = r;
  }
}

/** 0..1 slider → a curve that feels even to the ear */
export function setVolume(v: number, m: boolean) {
  volume = Math.max(0, Math.min(1, v));
  muted = m;
  decks.forEach((d) => d.applyLevel());
}

export function setCrossfade(seconds: number) {
  crossfade = Math.max(0, Math.min(12, seconds));
}

/** The equalizer: the Web Audio chain is built the first time it's switched on (and stays for the session). */
export function setEq(next: { enabled: boolean; gains: number[] }) {
  eq = next;
  if (eq.enabled) graph();
  applyEq();
}

let analyserNode: AnalyserNode | null = null;

/**
 * The sound-reactive sky's ear: an analyser listening to the output, after the equalizer. Asking for it builds the
 * Web Audio chain if it isn't there yet (as switching the equalizer on does).
 */
export function analyser(): AnalyserNode {
  const c = graph();
  if (!analyserNode) {
    analyserNode = c.createAnalyser();
    analyserNode.fftSize = 1024;
    analyserNode.smoothingTimeConstant = 0.3;
    filters[filters.length - 1]!.connect(analyserNode);
  }
  if (c.state === "suspended" && decks.some((d) => !d.audio.paused)) void c.resume();
  return analyserNode;
}

/** Audio output device ("" = the system default). */
export async function setOutput(id: string) {
  // the default device needs no call: setSinkId starts Chromium's media device service (and its video capture
  // helper, ~60 MB) even for ""
  if (id === sinkId) return;
  sinkId = id;
  await applySink();
}

async function applySink() {
  const id = sinkId;
  try {
    if (ctx && "setSinkId" in ctx) await (ctx as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(id);
    else await Promise.all(decks.map((d) => d.audio.setSinkId(id)));
  } catch {
    /* the device is gone: stay on the current one */
  }
}

// dev only: drive the engine from DevTools (window.__engine.seek(25))
if (import.meta.env.DEV) (window as unknown as { __engine: unknown }).__engine = { seek, currentTime, decks };
