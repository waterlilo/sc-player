import { useSyncExternalStore } from "react";
import type { WindowActivity } from "@shared/ipc";
import { on } from "./sky";

/**
 * Is anyone looking? main reports the window state (active / blurred / hidden); the page's own visibility covers the
 * rest. It lives on <html data-activity>, where CSS pauses animations, and canvas/JS loops subscribe here.
 */
let current: WindowActivity = document.visibilityState === "visible" ? (document.hasFocus() ? "active" : "blurred") : "hidden";
let fromMain: WindowActivity = current;
const listeners = new Set<() => void>();

function update() {
  const next: WindowActivity = document.visibilityState !== "visible" ? "hidden" : fromMain;
  if (next === current) return;
  current = next;
  document.documentElement.dataset.activity = current;
  listeners.forEach((l) => l());
}

export function initActivity() {
  document.documentElement.dataset.activity = current;
  on("win:activity", (a) => {
    fromMain = a;
    update();
  });
  document.addEventListener("visibilitychange", update);
  // dev only: pretend the window is in front (window.__activity("active")), for driving the page from DevTools
  if (import.meta.env.DEV)
    Object.assign(window, {
      __activity: (a: WindowActivity) => {
        fromMain = a;
        update();
      },
    });
}

export const getActivity = () => current;

export function subscribeActivity(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useActivity() {
  return useSyncExternalStore(subscribeActivity, getActivity);
}
