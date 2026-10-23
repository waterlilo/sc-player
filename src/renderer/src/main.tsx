import "./styles/fonts.css";
import "./styles/globals.css";
import "./styles/studio.css";
import "./styles/now-playing.css";
import "./styles/home.css";
import "./styles/studio-shell.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { queryClient } from "@/api/queries";
import { initActivity, subscribeActivity } from "@/lib/activity";
import { watchLyricsSync } from "@/lib/lyricsSync";
import { initAnimationClock } from "@/lib/animClock";
import { applyQuality } from "@/lib/quality";
import { call } from "@/lib/sky";
import { useAuth } from "@/state/auth";
import { initAudioPrefs } from "@/audio/prefs";
import { initSystemBridge } from "@/lib/system";
import { initMediaSession } from "@/lib/media-session";
import { initKeys } from "@/lib/keys";
import { initReactive } from "@/lib/reactive";
import { initCoverTint } from "@/lib/cover-tint";
import { initLook } from "@/lib/look";
import { initSocial } from "@/state/social";
import { initLikes } from "@/state/likes";
import { initVolume, player, usePlayer } from "@/state/player";
import { useNav } from "@/state/nav";
import { useUi } from "@/state/ui";
import { useSocial } from "@/state/social";
import { useSettings } from "@/state/settings";
import App from "./App";

async function boot() {
  initActivity();
  watchLyricsSync();
  try {
    useSettings.getState().hydrate(await call("store:get"));
  } catch {
    /* defaults */
  }
  applyQuality(useSettings.getState().quality);
  initVolume();
  initAudioPrefs();
  initSystemBridge();
  initMediaSession();
  initKeys();
  initReactive();
  initCoverTint();
  initLook();
  initSocial();
  void useAuth.getState().init();
  initLikes();

  // development (or a profiling run from the sources): the stores, for driving the page from DevTools (window.__sc)
  if (import.meta.env.DEV || location.search === "?sc-debug") Object.assign(window, { __sc: { player, usePlayer, useNav, useUi, useSettings, useSocial, queryClient, call } });

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
  initAnimationClock(subscribeActivity);
}

void boot();
