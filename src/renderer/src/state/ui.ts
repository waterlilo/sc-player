import { create } from "zustand";
import type { Track } from "@shared/types";

interface UiStore {
  queueOpen: boolean;
  toggleQueue(): void;
  closeQueue(): void;
  /** the track context menu (right click / menu key on a row) */
  menu: { x: number; y: number; track: Track } | null;
  openMenu(x: number, y: number, track: Track): void;
  closeMenu(): void;
  /** a short message at the bottom ("Link copied") */
  toast: { id: number; text: string } | null;
  showToast(text: string): void;
}

let toastTimer = 0;

export const useUi = create<UiStore>((set) => ({
  queueOpen: false,
  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen })),
  closeQueue: () => set({ queueOpen: false }),
  menu: null,
  openMenu: (x, y, track) => set({ menu: { x, y, track } }),
  closeMenu: () => set({ menu: null }),
  toast: null,
  showToast: (text) => {
    window.clearTimeout(toastTimer);
    set({ toast: { id: Date.now(), text } });
    toastTimer = window.setTimeout(() => set({ toast: null }), 2200);
  },
}));
