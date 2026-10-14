import { create } from "zustand";
import type { AuthStatus } from "@shared/ipc";
import { call, on } from "@/lib/sky";

interface AuthStore {
  status: AuthStatus | null;
  busy: boolean;
  init(): Promise<void>;
  login(): Promise<void>;
  logout(): Promise<void>;
}

export const useAuth = create<AuthStore>((set) => ({
  status: null,
  busy: false,
  init: async () => {
    on("auth:changed", (status) => set({ status }));
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
  logout: async () => {
    set({ status: await call("auth:logout") });
  },
}));
