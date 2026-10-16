import { app, session } from "electron";
import type { Prefs } from "@shared/ipc";
import { scSession } from "../soundcloud";
import { getSecret } from "../store/secrets";

/**
 * Proxy for everything the app fetches: SoundCloud pages and API (the SoundCloud session), audio and artwork (the
 * page's session) and updates. "system" follows Windows, "direct" uses none, "custom" an address like
 * socks5://127.0.0.1:1080 or http://host:8080 (http when no scheme is given). A username and password are answered
 * when the proxy asks (HTTP proxies; Chromium can't log in to SOCKS proxies); the password is kept encrypted.
 */
export function proxyRules(url: string): string | null {
  const m = url.trim().match(/^(?:(https?|socks[45]?):\/\/)?(?:[^@/\s]*@)?([\w.-]+|\[[0-9a-f:]+\]):(\d{1,5})\/?$/i);
  if (!m) return null;
  const scheme = (m[1] ?? "http").toLowerCase().replace(/^socks$/, "socks5");
  return `${scheme}://${m[2]}:${m[3]}`;
}

export async function applyProxy(p: Prefs["proxy"]) {
  const rules = p.mode === "custom" ? proxyRules(p.url) : null;
  const config: Electron.ProxyConfig = p.mode === "direct" ? { mode: "direct" } : rules ? { mode: "fixed_servers", proxyRules: rules, proxyBypassRules: "<local>" } : { mode: "system" };
  for (const s of [session.defaultSession, scSession()]) {
    await s.setProxy(config);
    await s.closeAllConnections();
  }
}

export function initProxyAuth(getUsername: () => string) {
  app.on("login", (event, _webContents, _details, authInfo, callback) => {
    if (!authInfo.isProxy) return;
    const username = getUsername();
    const password = getSecret("proxyPassword");
    if (!username || password === null) return;
    event.preventDefault();
    callback(username, password);
  });
}
