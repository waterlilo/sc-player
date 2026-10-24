import { create } from "zustand";
import type { AuthStatus } from "@shared/ipc";
import { en as t } from "@/i18n/en";
import { call, on } from "@/lib/sky";
import { useUi } from "./ui";

interface AuthStore {
  status: AuthStatus | null;
  busy: boolean;
  /** the browser sign-in: waiting for its link, or SoundCloud refused what came */
  browser: "idle" | "waiting" | "refused";
  init(): Promise<void>;
  loginWithBrowser(): Promise<void>;
  cancelBrowser(): Promise<void>;
  login(): Promise<void>;
  logout(): Promise<void>;
}

export const useAuth = create<AuthStore>((set) => ({
  status: null,
  busy: false,
  browser: "idle",
  init: async () => {
    on("auth:changed", (status) => set((s) => ({ status, browser: status.mode === "session" ? "idle" : s.browser })));
    on("auth:browserRefused", () => {
      set({ browser: "refused" });
      // seen on any screen, not only on the sign-in one
      useUi.getState().showToast(t.browserRefused);
    });
    try {
      set({ status: await call("auth:status") });
    } catch {
      set({ status: { mode: "public", user: null } });
    }
  },
  login: async () => {
    set({ busy: true });
    try {
      set({ status: await call("auth:login") });
    } finally {
      set({ busy: false });
    }
  },
  loginWithBrowser: async () => {
    await call("auth:browser");
    set({ browser: "waiting" });
  },
  cancelBrowser: async () => {
    await call("auth:browserCancel");
    set({ browser: "idle" });
  },
  logout: async () => {
    set({ status: await call("auth:logout") });
  },
}));
