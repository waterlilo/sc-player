import { useCallback, useSyncExternalStore } from "react";
import { useNav } from "./nav";

/**
 * What each page looked like when you left it — the chosen tab, filter, search text, scroll position — kept for this
 * run of the app, so coming back to a page shows it exactly as it was. Keyed by the page (its route) plus a name.
 * Scroll positions change on every scroll frame, so they live in a plain map and never re-render anything.
 */
const values = new Map<string, unknown>();
const listeners = new Set<() => void>();
const scrolls = new Map<string, number>();

export const routeKey = () => JSON.stringify(useNav.getState().route);

export function useViewState<T>(name: string, initial: T): [T, (value: T) => void] {
  const route = useNav((s) => JSON.stringify(s.route));
  const key = `${route}|${name}`;
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => (values.has(key) ? (values.get(key) as T) : initial),
  );
  const set = useCallback(
    (next: T) => {
      values.set(key, next);
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}

/** Another page's value (the title bar's search box writes what Search shows). */
export const getViewValue = (route: string, name: string) => values.get(`${route}|${name}`);
export function setViewValue(route: string, name: string, value: unknown) {
  values.set(`${route}|${name}`, value);
  listeners.forEach((l) => l());
}
export function subscribeView(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const getScroll = (key: string) => scrolls.get(key) ?? 0;
export const setScroll = (key: string, top: number) => scrolls.set(key, top);
