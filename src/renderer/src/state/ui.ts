import { create } from "zustand";

interface UiStore {
  queueOpen: boolean;
  toggleQueue(): void;
  closeQueue(): void;
}

export const useUi = create<UiStore>((set) => ({
  queueOpen: false,
  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen })),
  closeQueue: () => set({ queueOpen: false }),
}));
