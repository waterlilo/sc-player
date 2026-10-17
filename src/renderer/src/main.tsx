import "./styles/fonts.css";
import "./styles/globals.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { queryClient } from "@/api/queries";
import { initActivity, subscribeActivity } from "@/lib/activity";
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
import { initLikes } from "@/state/likes";
import { initVolume } from "@/state/player";
import { useSettings } from "@/state/settings";
import App from "./App";

async function boot() {
  initActivity();
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
  void useAuth.getState().init();
  initLikes();

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
