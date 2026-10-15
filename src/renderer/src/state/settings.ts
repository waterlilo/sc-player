import { create } from "zustand";
import { RENDERER_DEFAULTS, withPrefDefaults, type Prefs, type RendererState } from "@shared/ipc";
import { call } from "@/lib/sky";

interface SettingsStore extends RendererState {
  hydrate(state: RendererState): void;
  save(patch: Partial<RendererState>): void;
  setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void;
}

/** The renderer's persisted state (language, quality, saved profiles, history, player). main writes it to disk. */
export const useSettings = create<SettingsStore>((set, get) => ({
  ...RENDERER_DEFAULTS,
  hydrate: (state) => set({ ...RENDERER_DEFAULTS, ...state, prefs: withPrefDefaults(state.prefs) }),
  save: (patch) => {
    set(patch);
    void call("store:set", patch);
  },
  setPref: (key, value) => {
    const prefs = { ...get().prefs, [key]: value };
    set({ prefs });
    void call("store:set", { prefs });
  },
}));
