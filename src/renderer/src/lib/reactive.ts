import { analyser } from "@/audio/engine";
import { useSettings } from "@/state/settings";
import { usePlayer } from "@/state/player";
import { getActivity, subscribeActivity } from "./activity";

/**
 * Sound → sky. While music plays and the window is in front, the output is measured ~30 times a second: the bass,
 * the top end, and the kick drum's hits (a jump in the bass over its recent average). The numbers go to the few
 * decorative elements that listen (stars, the edge glow) as CSS variables on those elements only — never on the
 * root, which would restyle the whole page each frame. Nothing runs in the background, when paused, or when the
 * "Sound-reactive sky" setting is off; the listeners then fall back to their resting look.
 */
export interface Levels {
  /** 0..1 */
  bass: number;
  treble: number;
  /** 1 on a hit, fading to 0 within ~0.4 s */
  beat: number;
}

const listeners = new Set<HTMLElement>();
const REST: Levels = { bass: 0, treble: 0, beat: 0 };

/** An element whose --rx-bass / --rx-treble / --rx-beat follow the music. */
export function listen(el: HTMLElement | null): () => void {
  if (!el) return () => undefined;
  listeners.add(el);
  write(el, current);
  return () => {
    listeners.delete(el);
  };
}

let current: Levels = REST;

function write(el: HTMLElement, l: Levels) {
  el.style.setProperty("--rx-bass", l.bass.toFixed(3));
  el.style.setProperty("--rx-treble", l.treble.toFixed(3));
  el.style.setProperty("--rx-beat", l.beat.toFixed(3));
}

function publish(l: Levels) {
  // skip invisible changes: each write restyles the listener's subtree
  if (Math.abs(l.bass - current.bass) < 0.01 && Math.abs(l.treble - current.treble) < 0.01 && Math.abs(l.beat - current.beat) < 0.01) return;
  current = l;
  for (const el of listeners) write(el, l);
}

let frame = 0;
let data: Uint8Array<ArrayBuffer> | null = null;
let bass = 0;
let treble = 0;
let beat = 0;
let lastHit = 0;
let lastTick = 0;
// loudness differs a lot between tracks: levels are taken against the track's own recent peak
let bassPeak = 0.2;
let treblePeak = 0.05;
// the kick: how much the low bins rose since the last look (spectral flux), against its own running average
let prevLow: Float32Array | null = null;
let fluxAvg = 0;
let fluxDev = 0;

/** the bins between two frequencies */
function bins(node: AnalyserNode, from: number, to: number): [number, number] {
  const hz = node.context.sampleRate / node.fftSize;
  return [Math.max(1, Math.floor(from / hz)), Math.min(node.frequencyBinCount - 1, Math.ceil(to / hz))];
}

function level(buf: Uint8Array, [a, b]: [number, number]) {
  let sum = 0;
  for (let i = a; i <= b; i++) sum += buf[i]!;
  return sum / ((b - a + 1) * 255);
}

/** 25 times a second on a timer: a requestAnimationFrame loop woke the page on every screen frame */
function tick() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  const node = analyser();
  data ??= new Uint8Array(node.frequencyBinCount);
  node.getByteFrequencyData(data);
  const low = bins(node, 35, 130);
  const b = level(data, low);
  const t = level(data, bins(node, 6000, 14000));

  // peaks fall back slowly (~5 s), so a quiet intro still moves the sky and a loud drop doesn't pin it
  bassPeak = Math.max(b, bassPeak - dt * bassPeak * 0.2, 0.08);
  treblePeak = Math.max(t, treblePeak - dt * treblePeak * 0.2, 0.02);
  const bassRel = b / bassPeak;
  // stars: only the top of the hi-hats lights them (curved), quick on, a little slower off
  const trebleRel = Math.pow(t / treblePeak, 2.5);
  bass = bassRel > bass ? bassRel : bass + (bassRel - bass) * Math.min(1, dt * 6);
  treble = trebleRel > treble ? treble + (trebleRel - treble) * 0.7 : treble + (trebleRel - treble) * Math.min(1, dt * 7);

  // kick: the low bins' rise this frame, compared with how much they usually rise
  let flux = 0;
  prevLow ??= new Float32Array(low[1] + 1);
  for (let i = low[0]; i <= low[1]; i++) {
    const v = data[i]! / 255;
    flux += Math.max(0, v - prevLow[i]!);
    prevLow[i] = v;
  }
  flux /= low[1] - low[0] + 1;
  const k = Math.min(1, dt * 3);
  fluxAvg += (flux - fluxAvg) * k;
  fluxDev += (Math.abs(flux - fluxAvg) - fluxDev) * k;
  if (flux > 0.015 && flux > fluxAvg + fluxDev * 1.8 && now - lastHit > 200) {
    lastHit = now;
    beat = 1;
  } else beat = Math.max(0, beat - dt * 3.2);

  publish({ bass: Math.min(1, bass), treble: Math.min(1, treble), beat });
}

function update() {
  const on = useSettings.getState().prefs.reactiveSky;
  const s = usePlayer.getState().status;
  const run = on && s === "playing" && getActivity() === "active";
  if (run && !frame) {
    lastTick = performance.now();
    frame = window.setInterval(tick, 40);
  } else if (!run && frame) {
    window.clearInterval(frame);
    frame = 0;
    bass = treble = beat = 0;
    prevLow = null;
    publish(REST);
  }
}

export function initReactive() {
  usePlayer.subscribe((s, prev) => s.status !== prev.status && update());
  useSettings.subscribe((s, prev) => s.prefs.reactiveSky !== prev.prefs.reactiveSky && update());
  subscribeActivity(update);
  update();
}
