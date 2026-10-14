import type HlsType from "hls.js";
import type { ErrorData } from "hls.js";
import type { ErrorCode, StreamInfo, Track } from "@shared/types";
import { call, errorCode } from "@/lib/sky";

/**
 * The one <audio> element. SoundCloud streams AAC over HLS (hls.js feeds it through Media Source Extensions); a
 * progressive MP3 plays directly. Stream URLs are signed and short-lived, so a network failure mid-track asks main for
 * a fresh URL once and resumes at the same position.
 */
export interface EngineEvents {
  loading(): void;
  playing(): void;
  paused(): void;
  ended(): void;
  duration(seconds: number): void;
  time(seconds: number): void;
  error(code: ErrorCode): void;
}

/**
 * hls.js, light build (no subtitles, alternate audio or DRM, none of which SoundCloud audio needs), loaded with the
 * first HLS track so a cold start doesn't parse it.
 */
let Hls: typeof HlsType | null = null;
const loadHls = async () => (Hls ??= (await import("hls.js/light")).default);

const audio = new Audio();
audio.preload = "auto";
let hls: HlsType | null = null;
let events: EngineEvents | null = null;
let current: Track | null = null;
/** bumped on every load: answers for an older track are ignored */
let generation = 0;
let refreshed = false;
let mediaRecovered = false;
/** a track is starting: the pause events the old source fires while switching are not a real pause */
let starting = false;

export const engineElement = audio;
export const currentTime = () => audio.currentTime;
export const bufferedEnd = () => (audio.buffered.length ? audio.buffered.end(audio.buffered.length - 1) : 0);

export function bindEngine(handlers: EngineEvents) {
  events = handlers;
  audio.addEventListener("playing", () => {
    starting = false;
    events?.playing();
  });
  audio.addEventListener("pause", () => {
    if (!audio.ended && !starting) events?.paused();
  });
  audio.addEventListener("waiting", () => events?.loading());
  audio.addEventListener("ended", () => events?.ended());
  audio.addEventListener("durationchange", () => {
    if (Number.isFinite(audio.duration)) events?.duration(audio.duration);
  });
  audio.addEventListener("timeupdate", () => events?.time(audio.currentTime));
  audio.addEventListener("error", () => {
    if (!hls && current) void recover("offline");
  });
}

function teardown() {
  hls?.destroy();
  hls = null;
  audio.removeAttribute("src");
  audio.load();
}

function attach(info: StreamInfo, startAt: number, autoplay: boolean) {
  teardown();
  const H = Hls;
  if (info.protocol === "hls" && H?.isSupported()) {
    // no worker: the page's CSP stays strict, and remuxing a single audio stream is light
    hls = new H({ enableWorker: false, startPosition: startAt > 0 ? startAt : -1, maxBufferLength: 60, backBufferLength: 30 });
    hls.on(H.Events.ERROR, (_e, data: ErrorData) => {
      if (!data.fatal) return;
      if (data.type === H.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
        mediaRecovered = true;
        hls?.recoverMediaError();
        return;
      }
      void recover(data.type === H.ErrorTypes.NETWORK_ERROR ? "offline" : "unknown");
    });
    hls.loadSource(info.url);
    hls.attachMedia(audio);
  } else {
    audio.src = info.url;
    if (startAt > 0) audio.addEventListener("loadedmetadata", () => (audio.currentTime = startAt), { once: true });
  }
  if (autoplay) {
    starting = true;
    void audio.play().catch(() => {
      starting = false;
      events?.paused();
    });
  }
}

/** The signed URL probably expired: get a new one once and continue where we were. */
async function recover(code: ErrorCode) {
  const track = current;
  if (!track) return;
  if (refreshed) {
    events?.error(code);
    return;
  }
  refreshed = true;
  const at = audio.currentTime;
  const wasPlaying = !audio.paused;
  const gen = generation;
  try {
    const info = await call("data:stream", track.id);
    if (info.protocol === "hls") await loadHls();
    if (gen !== generation) return;
    attach(info, at, wasPlaying);
  } catch (err) {
    if (gen === generation) events?.error(errorCode(err));
  }
}

export async function load(track: Track, opts: { autoplay: boolean; startAt?: number }) {
  const gen = ++generation;
  current = track;
  refreshed = false;
  mediaRecovered = false;
  starting = opts.autoplay;
  teardown();
  events?.loading();
  try {
    const info = await call("data:stream", track.id);
    if (info.protocol === "hls") await loadHls();
    if (gen !== generation) return;
    attach(info, opts.startAt ?? 0, opts.autoplay);
    if (!opts.autoplay) events?.paused();
  } catch (err) {
    if (gen === generation) {
      starting = false;
      events?.error(errorCode(err));
    }
  }
}

export function stop() {
  generation++;
  current = null;
  teardown();
}

export function play() {
  if (!current) return;
  void audio.play().catch(() => events?.paused());
}

export function pause() {
  audio.pause();
}

export function seek(seconds: number) {
  if (!Number.isFinite(seconds)) return;
  audio.currentTime = Math.max(0, seconds);
}

/** 0..1 slider → a curve that feels even to the ear */
export function setVolume(v: number, muted: boolean) {
  audio.volume = Math.max(0, Math.min(1, v * v));
  audio.muted = muted;
}
