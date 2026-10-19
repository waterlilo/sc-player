import { app, session } from "electron";
import type { Prefs } from "@shared/ipc";
import { scSession } from "../soundcloud";
import { getSecret } from "../store/secrets";

/**
 * Proxy for everything the app fetches: SoundCloud pages and API (the SoundCloud session), audio and artwork (the
 * page's session) and updates. "system" follows Windows, "direct" uses none, "custom" an address like
 * socks5://127.0.0.1:1080 or http://host:8080 (http when no scheme is given). A username and password are answered
 * when the proxy asks (HTTP proxies; Chromium can't log in to SOCKS proxies); the password is kept encrypted.
 * "builtin" is sc player's own proxy (proxy/README.md), for SoundCloud only.
 */
export function proxyRules(url: string): string | null {
  const m = url.trim().match(/^(?:(https?|socks[45]?):\/\/)?(?:[^@/\s]*@)?([\w.-]+|\[[0-9a-f:]+\]):(\d{1,5})\/?$/i);
  if (!m) return null;
  const scheme = (m[1] ?? "http").toLowerCase().replace(/^socks$/, "socks5");
  return `${scheme}://${m[2]}:${m[3]}`;
}

/** Does this build carry sc player's own proxy (proxy.local.json at build time)? */
export const hasBuiltinProxy = () => __SC_PROXY__ !== null;

/** What goes through sc player's own proxy: SoundCloud's site, API, audio and artwork, and its bot protection. */
const THROUGH = ["soundcloud.com", "sndcdn.com", "soundcloud.cloud", "datadome.co", "captcha-delivery.com"];

/** The built-in proxy as a PAC script: those domains through it, everything else (updates, lyrics…) direct. */
function builtinPac(p: NonNullable<typeof __SC_PROXY__>) {
  const via = `${p.scheme === "http" ? "PROXY" : "HTTPS"} ${p.host}:${p.port}`;
  const test = THROUGH.map((d) => `host === "${d}" || dnsDomainIs(host, ".${d}")`).join(" || ");
  const script = `function FindProxyForURL(url, host) { if (${test}) return "${via}"; return "DIRECT"; }`;
  return `data:application/x-ns-proxy-autoconfig;charset=utf-8,${encodeURIComponent(script)}`;
}

export async function applyProxy(p: Prefs["proxy"]) {
  const rules = p.mode === "custom" ? proxyRules(p.url) : null;
  const config: Electron.ProxyConfig =
    p.mode === "direct"
      ? { mode: "direct" }
      : p.mode === "builtin" && __SC_PROXY__
        ? { mode: "pac_script", pacScript: builtinPac(__SC_PROXY__) }
        : rules
          ? { mode: "fixed_servers", proxyRules: rules, proxyBypassRules: "<local>" }
          : { mode: "system" };
  for (const s of [session.defaultSession, scSession()]) {
    await s.setProxy(config);
    await s.closeAllConnections();
  }
}

export function initProxyAuth(getUsername: () => string) {
  app.on("login", (event, _webContents, _details, authInfo, callback) => {
    if (!authInfo.isProxy) return;
    // sc player's own proxy logs in with the build's credentials
    if (__SC_PROXY__ && authInfo.host === __SC_PROXY__.host) {
      event.preventDefault();
      callback(__SC_PROXY__.username, __SC_PROXY__.password);
      return;
    }
    const username = getUsername();
    const password = getSecret("proxyPassword");
    if (!username || password === null) return;
    event.preventDefault();
    callback(username, password);
  });
}
