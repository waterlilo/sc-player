import { app, net, powerMonitor, session } from "electron";
import type { Prefs } from "@shared/ipc";
import { scSession } from "../soundcloud";
import { chromeUserAgent } from "../soundcloud/session";
import { store } from "../store";
import { getSecret } from "../store/secrets";
import { log } from "./log";
import { onNetTrouble } from "./net-trouble";

/**
 * Proxy for everything the app fetches: SoundCloud pages and API (the SoundCloud session), audio and artwork (the
 * page's session) and updates. "system" follows Windows, "direct" uses none, "custom" an address like
 * socks5://127.0.0.1:1080 or http://host:8080 (http when no scheme is given). A username and password are answered
 * when the proxy asks (HTTP proxies; Chromium can't log in to SOCKS proxies); the password is kept encrypted.
 * "builtin" is sc player's own proxy (server/README.md), for SoundCloud only. "auto" is the user's own connection
 * (Windows settings: their VPN, zapret or nothing) while SoundCloud opens through it, and sc player's proxy only when
 * it doesn't — the server carries only those who need it. In a build without sc player's proxy "auto" is "system".
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

async function setAll(config: Electron.ProxyConfig, dropConnections = true) {
  for (const s of [session.defaultSession, scSession()]) {
    await s.setProxy(config);
    if (dropConnections) await s.closeAllConnections();
  }
}

/**
 * Pages log in to sc player's proxy through app "login", but main's session.fetch doesn't answer a proxy's password
 * request at all (407). One request that does (net.request) leaves the password in the session, and fetch uses it.
 */
async function logInToBuiltin() {
  const p = __SC_PROXY__;
  if (!p) return;
  await Promise.all(
    [session.defaultSession, scSession()].map(
      (s) =>
        new Promise<void>((done) => {
          const req = net.request({
            url: "https://soundcloud.com/robots.txt",
            session: s,
            useSessionCookies: false,
          });
          req.on("login", (_auth, callback) => callback(p.username, p.password));
          req.on("response", (res) => {
            res.on("data", () => undefined);
            res.on("end", () => done());
            res.on("error", () => done());
          });
          req.on("error", () => done());
          // a server that doesn't answer mustn't hold up the start
          setTimeout(() => {
            req.abort();
            done();
          }, PROBE_TIMEOUT);
          req.end();
        }),
    ),
  );
}

let current: Prefs["proxy"] | null = null;

export async function applyProxy(p: Prefs["proxy"]) {
  current = p;
  clearTimeout(timer);
  route = null;
  if (p.mode === "auto" && __SC_PROXY__) {
    // start the way that worked last time, then check
    await go(store().get().proxyRoute ?? "own");
    void check();
    return;
  }
  if (p.mode === "builtin" && __SC_PROXY__) {
    await setAll({ mode: "pac_script", pacScript: builtinPac(__SC_PROXY__) });
    await logInToBuiltin();
    return;
  }
  const rules = p.mode === "custom" ? proxyRules(p.url) : null;
  await setAll(
    p.mode === "direct"
      ? { mode: "direct" }
      : rules
        ? {
            mode: "fixed_servers",
            proxyRules: rules,
            proxyBypassRules: "<local>",
          }
        : { mode: "system" },
  );
}

// ---- auto -----------------------------------------------------------------------------------------------------------

type Route = "own" | "ours";
/** which way "auto" sends SoundCloud now; null in the other modes */
let route: Route | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let checking: Promise<boolean> | null = null;
let checkedAt = 0;

export const proxyRoute = () => route;

/** Hosts SoundCloud needs: the site, the API, artwork and audio. Any answer counts; a block never answers. */
const PROBES = ["https://soundcloud.com/", "https://api-v2.soundcloud.com/", "https://i1.sndcdn.com/", "https://cf-hls-media.sndcdn.com/"];
const PROBE_TIMEOUT = 8000;
/** past the 16 KB a throttled connection freezes at */
const PROBE_BYTES = 24 * 1024;

let probeSession: Electron.Session | null = null;

/** One host over the user's own connection (a session of its own, so playback isn't touched). */
async function reaches(url: string) {
  if (!probeSession) {
    probeSession = session.fromPartition("sc-probe");
    await probeSession.setProxy({ mode: "system" });
  }
  const abort = new AbortController();
  const t = setTimeout(() => abort.abort(), PROBE_TIMEOUT);
  try {
    const res = await probeSession.fetch(url, {
      signal: abort.signal,
      redirect: "manual",
      cache: "no-store",
      headers: { "User-Agent": chromeUserAgent() },
    });
    const reader = res.body?.getReader();
    for (let n = 0; reader && n < PROBE_BYTES;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
    }
    void reader?.cancel().catch(() => undefined);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

const ownWorks = async () => (await Promise.all(PROBES.map(reaches))).every(Boolean);

async function go(next: Route) {
  if (!__SC_PROXY__) return;
  const changed = route !== null && route !== next;
  route = next;
  store().patch({ proxyRoute: next });
  // off a connection that doesn't work: drop what hangs on it; back to the user's own: let running downloads finish
  await setAll(next === "ours" ? { mode: "pac_script", pacScript: builtinPac(__SC_PROXY__) } : { mode: "system" }, next === "ours");
  if (next === "ours") await logInToBuiltin();
  if (changed) log("main", `proxy auto: SoundCloud now goes ${next === "ours" ? "through sc player's proxy" : "over the user's own connection"}`);
}

/** Is the user's own connection enough? Switches either way; resolves with whether the route changed. */
function check(): Promise<boolean> {
  if (current?.mode !== "auto" || !__SC_PROXY__) return Promise.resolve(false);
  checking ??= (async () => {
    let own = await ownWorks();
    // one failure may be a hiccup: look again before leaning on the server
    if (!own && route === "own") own = await new Promise<void>((r) => setTimeout(r, 2000)).then(ownWorks);
    checkedAt = Date.now();
    const before = route;
    await go(own ? "own" : "ours");
    // on sc player's proxy: look every 10 minutes whether the user's own works again (a VPN turned on, zapret started)
    clearTimeout(timer);
    timer = setTimeout(() => void check(), route === "ours" ? 10 * 60_000 : 60 * 60_000);
    return before !== route;
  })().finally(() => {
    checking = null;
  });
  return checking;
}

export function initProxyAuto() {
  // a failed request: check now (not more than every half minute)
  onNetTrouble(() => checking ?? (Date.now() - checkedAt > 30_000 ? check() : Promise.resolve(false)));
  // after sleep the network may be another one
  powerMonitor.on("resume", () => void check());
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
