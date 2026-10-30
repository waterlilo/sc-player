import { BrowserWindow, shell } from "electron";
import { getSecret, setSecret } from "../store/secrets";
import { log } from "../system/log";
import { presentAsChrome, scSession } from "./session";

/**
 * The SoundCloud sign-in: its token, stored encrypted (safeStorage), comes from the browser sign-in (the window inside
 * the app was taken away in 2.1.4 — SoundCloud's bot protection kept turning it down). The app's session also keeps the
 * site's `oauth_token` cookie, for the check window and after a restart.
 */
export class SessionAuth {
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

  /** A token from the browser sign-in (checked by the caller). */
  useToken(token: string) {
    setSecret("sessionToken", token);
  }

  private checkWindow: BrowserWindow | null = null;

  /**
   * SoundCloud's bot protection (DataDome) stopped an action: the page (a track's) opens on soundcloud.com in a window
   * of the app's own session, signed in with the user's session cookie, so the person can do the action on the site
   * itself and pass the site's own check (a captcha, if it shows one). The protection's cookie then sits in the
   * session and the app's next actions carry it. Resolves when the window is closed.
   */
  async check(url: string, parent: BrowserWindow | null): Promise<void> {
    if (this.checkWindow) {
      this.checkWindow.focus();
      return;
    }
    const ses = scSession();
    const token = this.token();
    // signed in through the browser: the app's session has no site cookie yet
    if (token) {
      const [cookie] = await ses.cookies.get({ name: "oauth_token" });
      if (cookie?.value !== token) {
        await ses.cookies.set({ url: "https://soundcloud.com", domain: ".soundcloud.com", path: "/", name: "oauth_token", value: token, secure: true, sameSite: "no_restriction", expirationDate: Date.now() / 1000 + 30 * 24 * 3600 });
      }
    }
    const win = new BrowserWindow({
      parent: parent ?? undefined,
      width: 1040,
      height: 800,
      minWidth: 760,
      minHeight: 600,
      center: true,
      title: "SoundCloud — check",
      autoHideMenuBar: true,
      backgroundColor: "#07050d",
      webPreferences: { partition: "persist:soundcloud", sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    this.checkWindow = win;
    log("main", "check: window opened");
    // what the site does with the sign-in cookie meanwhile (never its value): for the log
    const onCookie = (_e: Electron.Event, c: Electron.Cookie, cause: string, removed: boolean) => {
      if (c.name === "oauth_token") log("main", `check: the site ${removed ? `removed the sign-in cookie (${cause})` : "set the sign-in cookie"}${!removed && c.value === token ? " (the same token)" : ""}`);
    };
    ses.cookies.on("changed", onCookie);
    // links away from SoundCloud open in the real browser
    win.webContents.setWindowOpenHandler(({ url: to }) => {
      if (/^https:\/\//.test(to)) void shell.openExternal(to);
      return { action: "deny" };
    });
    await win.loadURL("about:blank");
    await presentAsChrome(win.webContents);
    void win.loadURL(url);
    await new Promise<void>((resolve) =>
      win.on("closed", () => {
        this.checkWindow = null;
        ses.cookies.removeListener("changed", onCookie);
        log("main", "check: window closed");
        resolve();
      }),
    );
    await this.adoptCookieToken();
  }

  /**
   * SoundCloud's own pages (the check window) may give the session a new token, after which the copy kept here is
   * refused (seen 2026-10-28: every request 401 right after a check). The cookie's token is taken when it differs.
   * True when it changed.
   */
  async adoptCookieToken(): Promise<boolean> {
    const [cookie] = await scSession().cookies.get({ name: "oauth_token" });
    const value = cookie?.value ?? "";
    if (!value || value === this.token()) return false;
    setSecret("sessionToken", value);
    log("main", "login: the site gave the session a new token — taken");
    return true;
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
