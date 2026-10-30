import { create } from "zustand";
import { isLocalTrack } from "@shared/types";

export type Route =
  | { name: "home" }
  | { name: "likes" }
  | { name: "feed" }
  | { name: "playlists" }
  | { name: "playlist"; id: string }
  | { name: "track"; id: number }
  | { name: "profile"; userId: number }
  | { name: "history" }
  | { name: "local" }
  | { name: "search" }
  | { name: "albums" }
  | { name: "stations" }
  | { name: "following" }
  | { name: "inbox" }
  | { name: "workshop" }
  | { name: "settings" }
  | { name: "signin" };

/** A sidebar entry: Home, Likes, Playlists, History, Search, or a saved profile ("profile:<id>"). */
export type Section = "home" | "likes" | "feed" | "playlists" | "history" | "local" | "search" | "albums" | "stations" | "following" | "inbox" | "workshop" | "settings" | "signin" | `profile:${number}`;

interface Entry {
  route: Route;
  section: Section;
}

interface NavStore extends Entry {
  stack: Entry[];
  /** pages left with Back, for Forward */
  ahead: Entry[];
  /** the last page shown in each section, so coming back to a section shows it again */
  last: Partial<Record<Section, Route>>;
  /** Open a page inside the current section (a playlist from a profile stays in that profile's section). */
  go(route: Route): void;
  /** Sidebar: switch to a section — its last page, or its start page when it's already the current one. */
  open(section: Section, root: Route): void;
  back(): void;
  forward(): void;
}

const same = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b);

/**
 * In-app navigation, like tabs: each sidebar section keeps the page you were on, and pages opened from a section
 * belong to it. One back stack across sections. No URLs — there's nothing to deep-link into.
 */
export const useNav = create<NavStore>((set, get) => ({
  route: { name: "home" },
  section: "home",
  stack: [],
  ahead: [],
  last: {},
  go: (route) => {
    const { route: current, section, stack, last } = get();
    // a file from this computer has no SoundCloud page, and its artist no profile
    if ((route.name === "track" && isLocalTrack(route.id)) || (route.name === "profile" && !route.userId)) return;
    if (same(route, current)) return;
    set({ route, stack: [...stack.slice(-30), { route: current, section }], ahead: [], last: { ...last, [section]: route } });
  },
  open: (target, root) => {
    const { route: current, section, stack, last } = get();
    const route = target === section ? root : (last[target] ?? root);
    if (target === section && same(route, current)) return;
    set({ route, section: target, stack: [...stack.slice(-30), { route: current, section }], ahead: [], last: { ...last, [target]: route } });
  },
  back: () => {
    const { stack, ahead, last, route, section } = get();
    const prev = stack[stack.length - 1];
    if (prev) set({ route: prev.route, section: prev.section, stack: stack.slice(0, -1), ahead: [...ahead, { route, section }], last: { ...last, [prev.section]: prev.route } });
  },
  forward: () => {
    const { stack, ahead, last, route, section } = get();
    const next = ahead[ahead.length - 1];
    if (next) set({ route: next.route, section: next.section, stack: [...stack, { route, section }], ahead: ahead.slice(0, -1), last: { ...last, [next.section]: next.route } });
  },
}));
