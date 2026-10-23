import { create } from "zustand";
import * as engine from "@/audio/engine";
import { fallAsleep, stopAfterTrack, usePlayer } from "./player";

/**
 * The sleep timer: pause after some minutes (the sound fades out over the last few seconds) or at the end of the
 * current track. Not kept between runs.
 */
interface Sleep {
  /** when the music stops, ms since epoch; null when off or "end of track" */
  endsAt: number | null;
  endOfTrack: boolean;
}

export const useSleep = create<Sleep>(() => ({ endsAt: null, endOfTrack: false }));

const FADE_MS = 8000;
let timer = 0;
let fade = 0;

function clear() {
  window.clearTimeout(timer);
  window.clearInterval(fade);
  fade = 0;
  stopAfterTrack(false);
  // the fade may have been half way: back to the player's own volume
  const { volume, muted } = usePlayer.getState();
  engine.setVolume(volume, muted);
}

function fadeOutAndPause() {
  const { volume, muted } = usePlayer.getState();
  const started = performance.now();
  fade = window.setInterval(() => {
    const k = Math.min(1, (performance.now() - started) / FADE_MS);
    engine.setVolume(volume * (1 - k), muted);
    if (k < 1) return;
    window.clearInterval(fade);
    fade = 0;
    fallAsleep();
    engine.setVolume(volume, muted);
    useSleep.setState({ endsAt: null, endOfTrack: false });
  }, 100);
}

export const sleep = {
  /** minutes from now; 0 turns the timer off */
  inMinutes(minutes: number) {
    clear();
    if (!minutes) {
      useSleep.setState({ endsAt: null, endOfTrack: false });
      return;
    }
    const endsAt = Date.now() + minutes * 60_000;
    useSleep.setState({ endsAt, endOfTrack: false });
    timer = window.setTimeout(fadeOutAndPause, Math.max(0, endsAt - Date.now() - FADE_MS));
  },
  endOfTrack() {
    clear();
    useSleep.setState({ endsAt: null, endOfTrack: true });
    stopAfterTrack(true, () => useSleep.setState({ endOfTrack: false }));
  },
  off() {
    sleep.inMinutes(0);
  },
};
