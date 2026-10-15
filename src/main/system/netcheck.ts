import type { NetCheck } from "@shared/ipc";
import { chromeUserAgent, scSession } from "../soundcloud";

const TARGETS: { name: string; url: string }[] = [
  { name: "soundcloud.com", url: "https://soundcloud.com/" },
  { name: "SoundCloud API (api-v2)", url: "https://api-v2.soundcloud.com/" },
  { name: "Audio CDN (sndcdn)", url: "https://cf-hls-media.sndcdn.com/" },
  { name: "Artwork CDN", url: "https://i1.sndcdn.com/" },
  { name: "GitHub (updates)", url: "https://api.github.com/" },
];

/**
 * Settings → Diagnostics → Check connection: can the app reach each host it needs, and how fast. Any HTTP answer
 * counts as reachable (the API answers 401/404 without parameters); only a network failure or a timeout doesn't.
 */
export async function netCheck(): Promise<NetCheck[]> {
  return Promise.all(
    TARGETS.map(async ({ name, url }) => {
      const started = performance.now();
      try {
        const res = await scSession().fetch(url, { method: "GET", headers: { "User-Agent": chromeUserAgent() }, signal: AbortSignal.timeout(8000) });
        void res.body?.cancel();
        return { name, ok: true, ms: Math.round(performance.now() - started), detail: `HTTP ${res.status}` };
      } catch (err) {
        const e = err as Error;
        return { name, ok: false, ms: null, detail: e.name === "TimeoutError" ? "timed out (8 s)" : e.message };
      }
    }),
  );
}
