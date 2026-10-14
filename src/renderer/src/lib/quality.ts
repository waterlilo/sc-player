import type { QualityPref } from "@shared/ipc";
import { getActivity, subscribeActivity } from "./activity";

/**
 * Adaptive quality, as on the site (portfolio lib/quality.ts + QualityGovernor): level 0 = everything; 1 = the
 * decorative loops freeze where they are (grain, drift, boiling, pulses); 2 = also the heavier decorations go
 * (Now Playing haze layers, stars). The level lives on <html data-quality>. "auto" measures the real frame rate while
 * the window is active and steps down when the machine can't keep up (remembered per device, never back up within a
 * run); a manual level in the settings wins.
 */
const KEY = "sky-quality";
const MAX = 2;

const SETTLE_MS = 1500;
const ACTIVE_TAIL_MS = 500;
const IDLE_WINDOW_MS = 2000;
const ACTIVE_BATCH = 90;
const MIN_FPS = 45;
const DROP_SHARE = 0.25;
const HITCH_MS = 100;
const HITCHES = 3;
const STEP_SCORE = 2;

let stopGovernor: (() => void) | null = null;

function setLevel(level: number) {
  const root = document.documentElement;
  if (level > 0) root.dataset.quality = String(level);
  else delete root.dataset.quality;
}

export function applyQuality(pref: QualityPref) {
  stopGovernor?.();
  stopGovernor = null;
  if (pref !== "auto") {
    setLevel(Number(pref));
    return;
  }
  let remembered = 0;
  try {
    remembered = Number(localStorage.getItem(KEY) ?? 0) || 0;
  } catch {
    /* storage unavailable */
  }
  setLevel(remembered);
  if (remembered < MAX) stopGovernor = govern(remembered);
}

/** Forget the remembered level (settings: "auto" chosen again). */
export function resetQuality() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

function govern(start: number) {
  let level = start;
  let raf = 0;
  let last = 0;
  let settleUntil = performance.now() + SETTLE_MS;
  let activeUntil = 0;
  let refresh = 1000 / 60;
  const recent: number[] = [];
  let active: number[] = [];
  let score = 0;
  let idle: number[] = [];
  let idleStart = 0;
  let idleBad = 0;
  let idleGood = 0;
  // after a few calm idle windows the idle check is done: from then on the loop only runs around scrolling
  let idleDone = false;

  const markActive = () => {
    activeUntil = performance.now() + ACTIVE_TAIL_MS;
    if (!raf && getActivity() === "active") {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  };
  const opts = { passive: true, capture: true } as const;
  window.addEventListener("wheel", markActive, opts);
  window.addEventListener("keydown", markActive, opts);
  window.addEventListener("scroll", markActive, opts);

  const slow = (deltas: number[]) => {
    const total = deltas.reduce((s, d) => s + d, 0);
    const fps = (deltas.length * 1000) / total;
    const dropAt = Math.max(refresh * 1.7, 25);
    const drops = deltas.filter((d) => d > dropAt).length / deltas.length;
    const hitches = deltas.filter((d) => d > HITCH_MS).length;
    return fps < MIN_FPS || drops > DROP_SHARE || hitches >= HITCHES;
  };

  const stepDown = (now: number) => {
    level += 1;
    setLevel(level);
    try {
      localStorage.setItem(KEY, String(level));
    } catch {
      /* not remembered */
    }
    settleUntil = now + SETTLE_MS;
    active = [];
    idle = [];
    score = 0;
    idleBad = 0;
    if (level >= MAX) stop();
  };

  const tick = (now: number) => {
    if (idleDone && now > activeUntil + 1000) {
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(tick);
    const d = last ? now - last : 0;
    last = now;
    if (!d || d > 400) return;
    if (now < settleUntil) {
      idle = [];
      idleStart = now;
      return;
    }
    recent.push(d);
    if (recent.length > 120) recent.shift();
    if (recent.length >= 30) {
      const sorted = [...recent].sort((a, b) => a - b);
      refresh = Math.min(refresh, Math.max(1000 / 165, sorted[Math.floor(sorted.length * 0.1)]!));
    }
    if (now < activeUntil) {
      active.push(d);
      idle = [];
      idleStart = now;
      if (active.length >= ACTIVE_BATCH) {
        score = slow(active) ? score + 1 : Math.max(0, score - 0.5);
        active = [];
        if (score >= STEP_SCORE) stepDown(now);
      }
      return;
    }
    idle.push(d);
    if (now - idleStart < IDLE_WINDOW_MS) return;
    if (idle.length >= 20) {
      const bad = slow(idle);
      idleBad = bad ? idleBad + 1 : 0;
      idleGood = bad ? 0 : idleGood + 1;
      if (idleGood >= 3) idleDone = true;
      if (idleBad >= 2) stepDown(now);
    }
    idle = [];
    idleStart = now;
  };

  // only judge (and only run at all) while the window is in front: a busy After Effects in the foreground must not
  // lower the quality, and a frame loop must not keep waking the page while nobody looks
  const sync = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    idle = [];
    idleBad = 0;
    if (getActivity() === "active" && !idleDone) {
      settleUntil = Math.max(settleUntil, performance.now() + 500);
      idleStart = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };
  const offActivity = subscribeActivity(sync);

  const stop = () => {
    offActivity();
    cancelAnimationFrame(raf);
    window.removeEventListener("wheel", markActive, opts);
    window.removeEventListener("keydown", markActive, opts);
    window.removeEventListener("scroll", markActive, opts);
  };
  sync();
  return stop;
}
