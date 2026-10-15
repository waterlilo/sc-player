import { useSettings } from "@/state/settings";
import * as engine from "./engine";

/** Keeps the engine in step with the Settings screen: crossfade, equalizer, output device. */
export function initAudioPrefs() {
  let last = "";
  const apply = () => {
    const { crossfade, eq, outputDevice } = useSettings.getState().prefs;
    const key = JSON.stringify([crossfade, eq, outputDevice]);
    if (key === last) return;
    last = key;
    engine.setCrossfade(crossfade);
    engine.setEq(eq);
    void engine.setOutput(outputDevice);
  };
  apply();
  useSettings.subscribe(apply);
}
