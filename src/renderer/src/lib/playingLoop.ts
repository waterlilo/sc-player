import { useEffect } from "react";
import { getActivity, subscribeActivity } from "@/lib/activity";
import { usePlayer } from "@/state/player";

/** runs `fn` 30 times a second while music plays and the window is in front; `idle` once whenever it stops */
export function usePlayingLoop(fn: () => void, idle: () => void, deps: unknown[]) {
  useEffect(() => {
    let timer = 0;
    const sync = () => {
      const run = usePlayer.getState().status === "playing" && getActivity() === "active";
      if (run && !timer) timer = window.setInterval(fn, 33);
      if (!run && timer) {
        window.clearInterval(timer);
        timer = 0;
        idle();
      }
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
