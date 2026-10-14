import type { SkyBridge } from "../shared/ipc";

declare global {
  interface Window {
    sky: SkyBridge;
  }
}
