import { app, session } from "electron";

/** The persistent browser session the SoundCloud website (login window) and every api-v2 request share. */
export const SC_PARTITION = "persist:soundcloud";
export const scSession = () => session.fromPartition(SC_PARTITION);

/** Electron's user agent without the Electron and app tokens: SoundCloud's login page then sees plain Chrome. */
export function chromeUserAgent() {
  return app.userAgentFallback
    .split(" ")
    .filter((part) => !/^(Electron|sky-player|sky player|sc-player|sc player)\//i.test(part))
    .join(" ");
}

export const API_V2 = "https://api-v2.soundcloud.com";
export const API_HOST = "api-v2.soundcloud.com";
