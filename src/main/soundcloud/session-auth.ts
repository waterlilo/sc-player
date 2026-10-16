import { BrowserWindow, shell, type OnBeforeSendHeadersListenerDetails } from "electron";
import { getSecret, setSecret } from "../store/secrets";
import { log } from "../system/log";
import type { ClientId } from "./client-id";
import { presentAsChrome, scSession } from "./session";

const LOGIN_URL = "https://soundcloud.com/signin";
/** popups that stay inside the sign-in window: SoundCloud and the sign-in providers */
const SIGN_IN_HOSTS = /(^|\.)(soundcloud\.com|google\.com|gstatic\.com|apple\.com|facebook\.com)$/;
const ZAPRET_GUIDE = "https://github.com/Flowseal/zapret-discord-youtube/issues/7449";

/** Shown in the sign-in window when soundcloud.com doesn't load. */
function failedPage(reason: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html><meta charset="utf-8"><title>SoundCloud didn't load</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#07050d;color:#ece7ff;font:15px/1.5 system-ui,sans-serif">
<main style="max-width:520px;padding:24px">
<h1 style="font-size:22px;margin:0 0 12px">SoundCloud didn't load</h1>
<p style="color:#a79ed0;margin:0 0 8px">The sign-in page couldn't be opened (${esc(reason)}). In Russia soundcloud.com is blocked: turn on zapret or a VPN, or set a proxy in sc player's Settings.</p>
<p style="color:#a79ed0;margin:0 0 20px">SoundCloud не открылся. В России soundcloud.com заблокирован — включите zapret или VPN либо укажите прокси в настройках sc player. Гайд по zapret: <a style="color:#f2dc1a" href="${ZAPRET_GUIDE}" target="_blank">«Как починить SoundCloud с помощью zapret»</a>.</p>
<a href="${LOGIN_URL}" style="display:inline-block;background:#f2dc1a;color:#07050d;padding:8px 18px;border-radius:6px;text-decoration:none;font-weight:600">Try again</a>
</main></body>`;
}

/**
 * Sign-in through the real SoundCloud website in a window of its own (persistent session). The site keeps its token
 * in the `oauth_token` cookie and sends it as "Authorization: OAuth …" to api-v2; whichever shows up first is taken.
 * The token is stored encrypted (safeStorage). The page's own api-v2 requests also tell us the current client_id.
 */
export class SessionAuth {
  private window: BrowserWindow | null = null;

  constructor(private readonly clientId: ClientId) {}

  token(): string | null {
    return getSecret("sessionToken");
  }

  /** After a restart: the cookie may still be there even if the encrypted copy was lost. */
  async restore(): Promise<boolean> {
    if (this.token()) return true;
    const [cookie] = await scSession().cookies.get({ name: "oauth_token" });
    if (cookie?.value) setSecret("sessionToken", cookie.value);
    return !!cookie?.value;
  }

  login(parent: BrowserWindow | null): Promise<boolean> {
    if (this.window) {
      this.window.focus();
      return Promise.resolve(false);
    }
    const ses = scSession();
    // wide enough for SoundCloud's desktop sign-in dialog (at 520 px it was cut off on the right)
    const win = new BrowserWindow({
      parent: parent ?? undefined,
      width: 1040,
      height: 800,
      minWidth: 760,
      minHeight: 600,
      center: true,
      title: "SoundCloud — sign in",
      autoHideMenuBar: true,
      backgroundColor: "#07050d",
      webPreferences: { partition: "persist:soundcloud", sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    this.window = win;
    log("main", "login: window opened");

    /**
     * Popups of SoundCloud and of the sign-in providers (Google, Apple, Facebook) open inside the app, in the same
     * session, so the provider can hand the sign-in back to SoundCloud. Before, they went to the real browser, where
     * the sign-in finished without the app ever knowing. Anything else (help links) opens in the real browser.
     */
    const popups = (wc: Electron.WebContents) => {
      wc.setWindowOpenHandler(({ url }) => {
        let host = "";
        try {
          host = new URL(url).hostname;
        } catch {
          /* not a URL */
        }
        // SoundCloud opens the provider's window blank first and navigates it afterwards
        if (url === "about:blank" || url === "" || SIGN_IN_HOSTS.test(host)) {
          log("main", `login: popup ${host || "about:blank"}`);
          return {
            action: "allow",
            overrideBrowserWindowOptions: { parent: win, width: 520, height: 720, center: true, autoHideMenuBar: true, backgroundColor: "#ffffff", webPreferences: { partition: "persist:soundcloud", sandbox: true } },
          };
        }
        log("main", `login: popup to ${host || url.slice(0, 40)} opened in the browser instead`);
        if (/^https:\/\//.test(url)) void shell.openExternal(url);
        return { action: "deny" };
      });
    };
    popups(win.webContents);
    win.webContents.on("did-create-window", (child) => {
      void presentAsChrome(child.webContents);
      popups(child.webContents);
      // inside a provider's window only the sign-in hosts load; anything else goes to the real browser
      child.webContents.on("will-navigate", (e, url) => {
        let host = "";
        try {
          host = new URL(url).hostname;
        } catch {
          /* not a URL */
        }
        if (SIGN_IN_HOSTS.test(host)) return;
        e.preventDefault();
        log("main", `login: popup navigation to ${host || "?"} opened in the browser instead`);
        if (/^https:\/\//.test(url)) void shell.openExternal(url);
      });
    });

    // SoundCloud didn't load (blocked in Russia without zapret / VPN, or offline): say so instead of a blank window
    win.webContents.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3: aborted by a redirect
      log("main", `login: failed to load ${url}: ${code} ${description}`);
      void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(failedPage(description))}`);
    });

    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (token: string | null) => {
        if (done) return;
        done = true;
        ses.cookies.removeListener("changed", onCookie);
        ses.webRequest.onBeforeSendHeaders(null);
        ses.webRequest.onCompleted(null);
        ses.webRequest.onErrorOccurred(null);
        if (token) setSecret("sessionToken", token);
        log("main", token ? "login: signed in" : "login: window closed without signing in");
        // let the site finish its redirect before the window goes away
        setTimeout(() => {
          if (!win.isDestroyed()) win.close();
        }, token ? 600 : 0);
        resolve(!!token);
      };
      const onCookie = (_e: Electron.Event, cookie: Electron.Cookie, _cause: string, removed: boolean) => {
        if (!removed && cookie.name === "oauth_token" && cookie.value) finish(cookie.value);
      };
      ses.cookies.on("changed", onCookie);
      ses.webRequest.onBeforeSendHeaders({ urls: ["https://api-v2.soundcloud.com/*"] }, (details: OnBeforeSendHeadersListenerDetails, callback) => {
        const id = new URL(details.url).searchParams.get("client_id");
        if (id) this.clientId.learn(id);
        const auth = details.requestHeaders.Authorization ?? details.requestHeaders.authorization;
        callback({ requestHeaders: details.requestHeaders });
        if (auth?.startsWith("OAuth ") && auth.length > 12) finish(auth.slice(6));
      });
      // what went wrong, for the log: refused or failed requests of the sign-in (host and path only — no query, no bodies)
      const where = (url: string) => {
        try {
          const u = new URL(url);
          return `${u.hostname}${u.pathname.slice(0, 60)}`;
        } catch {
          return "?";
        }
      };
      const SIGN_IN_TRAFFIC = ["https://*.soundcloud.com/*", "https://*.google.com/*", "https://*.captcha-delivery.com/*", "https://*.datadome.co/*"];
      ses.webRequest.onCompleted({ urls: SIGN_IN_TRAFFIC }, (d) => {
        if (d.statusCode >= 400) log("main", `login: ${d.method} ${where(d.url)} → ${d.statusCode}`);
      });
      ses.webRequest.onErrorOccurred({ urls: SIGN_IN_TRAFFIC }, (d) => {
        if (d.error !== "net::ERR_ABORTED") log("main", `login: ${d.method} ${where(d.url)} failed: ${d.error}`);
      });
      win.on("closed", () => {
        this.window = null;
        finish(null);
      });
      // the override takes once something is loaded: a blank page first, then the sign-in
      void win
        .loadURL("about:blank")
        .then(() => presentAsChrome(win.webContents))
        .catch(() => undefined)
        .finally(() => {
          if (!win.isDestroyed()) void win.loadURL(LOGIN_URL);
        });
    });
  }

  /** A token from the browser sign-in (checked by the caller). */
  useToken(token: string) {
    setSecret("sessionToken", token);
  }

  /** The token was refused: drop our copy (the site data stays; signing in again replaces it). */
  forget() {
    setSecret("sessionToken", null);
  }

  /** Sign out: the token, cookies, site storage and cache of the SoundCloud session are all wiped. */
  async logout() {
    setSecret("sessionToken", null);
    const ses = scSession();
    await ses.clearStorageData();
    await ses.clearCache();
  }
}
