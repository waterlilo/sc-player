import { create } from "zustand";
import type { Track } from "@shared/types";

interface UiStore {
  queueOpen: boolean;
  toggleQueue(): void;
  closeQueue(): void;
  /** the words panel; it opens where the queue does, so one closes the other */
  lyricsOpen: boolean;
  toggleLyrics(): void;
  closeLyrics(): void;
  /** the player over the whole window: big cover with its spectrum, the words sung line by line */
  fullOpen: boolean;
  openFull(): void;
  closeFull(): void;
  /** the track context menu (right click / menu key on a row) */
  menu: { x: number; y: number; track: Track } | null;
  openMenu(x: number, y: number, track: Track): void;
  closeMenu(): void;
  /** "Add to playlist" picker for this track */
  picker: Track | null;
  openPicker(track: Track): void;
  closePicker(): void;
  /** a short message at the bottom ("Link copied") */
  toast: { id: number; text: string } | null;
  showToast(text: string): void;
}

let toastTimer = 0;

export const useUi = create<UiStore>((set) => ({
  queueOpen: false,
  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen, lyricsOpen: false })),
  lyricsOpen: false,
  toggleLyrics: () => set((s) => ({ lyricsOpen: !s.lyricsOpen, queueOpen: false })),
  closeLyrics: () => set({ lyricsOpen: false }),
  closeQueue: () => set({ queueOpen: false }),
  fullOpen: false,
  openFull: () => set({ fullOpen: true, queueOpen: false, lyricsOpen: false }),
  closeFull: () => set({ fullOpen: false }),
  menu: null,
  openMenu: (x, y, track) => set({ menu: { x, y, track } }),
  closeMenu: () => set({ menu: null }),
  picker: null,
  openPicker: (track) => set({ picker: track }),
  closePicker: () => set({ picker: null }),
  toast: null,
  showToast: (text) => {
    window.clearTimeout(toastTimer);
    set({ toast: { id: Date.now(), text } });
    toastTimer = window.setTimeout(() => set({ toast: null }), 2200);
  },
}));
