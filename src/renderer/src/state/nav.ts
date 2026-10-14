import { create } from "zustand";

export type Route =
  | { name: "likes" }
  | { name: "playlists" }
  | { name: "playlist"; id: string }
  | { name: "profile"; userId: number }
  | { name: "history" }
  | { name: "search" };

interface NavStore {
  route: Route;
  stack: Route[];
  go(route: Route): void;
  back(): void;
}

const same = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b);

/** In-app navigation: a route and a back stack (no URLs — there's nothing to deep-link into). */
export const useNav = create<NavStore>((set, get) => ({
  route: { name: "likes" },
  stack: [],
  go: (route) => {
    const { route: current, stack } = get();
    if (same(route, current)) return;
    set({ route, stack: [...stack.slice(-30), current] });
  },
  back: () => {
    const { stack } = get();
    const prev = stack[stack.length - 1];
    if (prev) set({ route: prev, stack: stack.slice(0, -1) });
  },
}));
