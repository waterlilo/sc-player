import { useEffect } from "react";
import { getActivity, subscribeActivity } from "@/lib/activity";
import { usePlayer } from "@/state/player";

/**
 * runs `fn` 30 times a second while music plays and the window is in front — and `blurredMs` apart while it is
 * visible behind another window, when given; `idle` once whenever it stops
 */
export function usePlayingLoop(fn: () => void, idle: () => void, deps: unknown[], blurredMs = 0) {
  useEffect(() => {
    let timer = 0;
    let every = 0;
    const sync = () => {
      const activity = getActivity();
      const playing = usePlayer.getState().status === "playing";
      const ms = playing && activity === "active" ? 33 : playing && activity === "blurred" && blurredMs ? blurredMs : 0;
      if (ms === every) return;
      if (timer) window.clearInterval(timer);
      timer = ms ? window.setInterval(fn, ms) : 0;
      if (!ms && every) idle();
      every = ms;
    };
    sync();
    const offActivity = subscribeActivity(sync);
    const offPlayer = usePlayer.subscribe((s, prev) => s.status !== prev.status && sync());
    return () => {
      window.clearInterval(timer);
      offActivity();
      offPlayer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
