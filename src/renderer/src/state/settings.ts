import { create } from "zustand";
import { RENDERER_DEFAULTS, type RendererState } from "@shared/ipc";
import { call } from "@/lib/sky";

interface SettingsStore extends RendererState {
  hydrate(state: RendererState): void;
  save(patch: Partial<RendererState>): void;
}

/** The renderer's persisted state (language, quality, saved profiles, history, player). main writes it to disk. */
export const useSettings = create<SettingsStore>((set) => ({
  ...RENDERER_DEFAULTS,
  hydrate: (state) => set({ ...RENDERER_DEFAULTS, ...state }),
  save: (patch) => {
    set(patch);
    void call("store:set", patch);
  },
}));
