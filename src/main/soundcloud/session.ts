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

/**
 * The rest of what Chrome tells a site about itself: the client hints (Sec-CH-UA headers, navigator.userAgentData).
 * Electron's say "Chromium" without "Google Chrome", which next to a Chrome user agent is what SoundCloud's bot
 * protection (DataDome) flags as automation — "Access temporarily restricted" on sign-in. Set through the DevTools
 * protocol's Emulation domain only (nothing a page can see being attached), before the page loads.
 */
export async function presentAsChrome(wc: Electron.WebContents) {
  if (wc.isDestroyed()) return;
  const full = process.versions.chrome;
  const major = full.split(".")[0]!;
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
    const override = wc.debugger.sendCommand("Emulation.setUserAgentOverride", {
      userAgent: chromeUserAgent(),
      platform: "Win32",
      userAgentMetadata: {
        brands: [
          { brand: "Google Chrome", version: major },
          { brand: "Chromium", version: major },
          { brand: "Not?A_Brand", version: "24" },
        ],
        fullVersionList: [
          { brand: "Google Chrome", version: full },
          { brand: "Chromium", version: full },
          { brand: "Not?A_Brand", version: "24.0.0.0" },
        ],
        platform: "Windows",
        platformVersion: "10.0.0",
        architecture: "x86",
        bitness: "64",
        model: "",
        mobile: false,
        wow64: false,
      },
    });
    // never hold the sign-in up: without an answer in 2 s the page loads with the plain user agent
    await Promise.race([override, new Promise((resolve) => setTimeout(resolve, 2000))]);
  } catch {
    /* already attached by DevTools, or the window went away: the plain user agent stays */
  }
}
