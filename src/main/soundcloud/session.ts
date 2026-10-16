import { session } from "electron";

/** The persistent browser session the SoundCloud website (login window) and every api-v2 request share. */
export const SC_PARTITION = "persist:soundcloud";
export const scSession = () => session.fromPartition(SC_PARTITION);

/**
 * Exactly the user agent Chrome on Windows sends (Chrome reports only its major version). Electron's own one carries
 * "Electron/…" and the app's name ("scplayer/1.3.2"); with those SoundCloud's bot protection turned the sign-in down
 * ("Something unexpected happened", no e-mail code), and filtering tokens out missed the app's name once already.
 */
export function chromeUserAgent() {
  const major = process.versions.chrome.split(".")[0];
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

export const API_V2 = "https://api-v2.soundcloud.com";
export const API_HOST = "api-v2.soundcloud.com";
