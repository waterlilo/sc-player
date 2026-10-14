import { BrowserWindow, shell, type OnBeforeSendHeadersListenerDetails } from "electron";
import { getSecret, setSecret } from "../store/secrets";
import type { ClientId } from "./client-id";
import { scSession } from "./session";

const LOGIN_URL = "https://soundcloud.com/signin";
const SC_HOSTS = /(^|\.)soundcloud\.com$/;

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
    const win = new BrowserWindow({
      parent: parent ?? undefined,
      width: 520,
      height: 760,
      title: "SoundCloud — sign in",
      autoHideMenuBar: true,
      backgroundColor: "#07050d",
      webPreferences: { partition: "persist:soundcloud", sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    this.window = win;

    // popups stay inside the session if they're SoundCloud's own; anything else opens in the real browser
    win.webContents.setWindowOpenHandler(({ url }) => {
      try {
        if (SC_HOSTS.test(new URL(url).hostname)) return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { partition: "persist:soundcloud", sandbox: true } } };
      } catch {
        /* not a URL */
      }
      void shell.openExternal(url);
      return { action: "deny" };
    });

    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (token: string | null) => {
        if (done) return;
        done = true;
        ses.cookies.removeListener("changed", onCookie);
        ses.webRequest.onBeforeSendHeaders(null);
        if (token) setSecret("sessionToken", token);
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
      win.on("closed", () => {
        this.window = null;
        finish(null);
      });
      void win.loadURL(LOGIN_URL);
    });
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
