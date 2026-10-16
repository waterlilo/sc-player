import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, shell } from "electron";
import { log } from "../system/log";

/**
 * Sign-in through the user's own browser, for when SoundCloud's bot protection turns the in-app window down.
 *
 * The browser shows a helper page (written to the temp folder) with a bookmark to drag to the bookmarks bar. After
 * signing in on soundcloud.com as usual, a click on that bookmark reads the site's own `oauth_token` cookie (readable
 * by the page's scripts) and hands it to the app through the `scplayer://` link: Windows starts the app with that link
 * and the running app gets it as a second instance's arguments. Nothing leaves the computer.
 *
 * A link is only taken while the user is waiting for it (they pressed "Sign in with your browser" in the last
 * 15 minutes), so another page can't sign the app into someone else's account. The link handler is registered for
 * that wait only and removed afterwards.
 */
const PROTOCOL = "scplayer";
const WAIT_MS = 15 * 60_000;
let waitingUntil = 0;

const handlerArgs = (): [string, string[]] =>
  // in development the app runs as "electron <project folder>"; a portable build is the outer .exe, not the
  // unpacked copy in the temp folder that is gone after it quits
  process.defaultApp ? [process.execPath, [app.getAppPath()]] : [process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath, []];

export function waitingForBrowser() {
  return Date.now() < waitingUntil;
}

export function startBrowserSignIn() {
  const [exe, args] = handlerArgs();
  app.setAsDefaultProtocolClient(PROTOCOL, exe, args);
  waitingUntil = Date.now() + WAIT_MS;
  const page = join(app.getPath("temp"), "sc-player-sign-in.html");
  writeFileSync(page, helperPage(), "utf8");
  log("main", "login: browser sign-in started");
  void shell.openPath(page);
}

export function stopBrowserSignIn() {
  waitingUntil = 0;
  const [exe, args] = handlerArgs();
  app.removeAsDefaultProtocolClient(PROTOCOL, exe, args);
}

/** The token from a `scplayer://signin?token=…` link among a new instance's arguments, if there is one. */
export function tokenFromArgs(argv: string[]): string | null {
  for (const arg of argv) {
    if (!arg.toLowerCase().startsWith(`${PROTOCOL}:`)) continue;
    try {
      const token = new URL(arg).searchParams.get("token") ?? "";
      if (/^[\w.-]{8,256}$/.test(token)) return token;
    } catch {
      /* not a link */
    }
    log("main", "login: browser link without a usable token");
  }
  return null;
}

/** Runs on soundcloud.com when the bookmark is clicked. */
const BOOKMARKLET = `(()=>{if(!/(^|\\.)soundcloud\\.com$/.test(location.hostname)){alert("Open soundcloud.com first, then click this bookmark.");return}const m=document.cookie.match(/(?:^|;\\s*)oauth_token=([^;]+)/);if(!m){alert("Sign in to SoundCloud first, then click this bookmark again.");return}location.href="${PROTOCOL}://signin?token="+encodeURIComponent(m[1])})()`;

function helperPage() {
  const href = `javascript:${encodeURIComponent(BOOKMARKLET)}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>sc player — sign in with your browser</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #07050d; color: #ece7ff; font: 16px/1.55 system-ui, sans-serif; }
  main { max-width: 600px; padding: 32px 20px; }
  h1 { font-size: 26px; margin: 0 0 6px; }
  .lead { color: #a79ed0; margin: 0 0 26px; }
  ol { padding-left: 22px; margin: 0; }
  li { margin: 0 0 22px; }
  .muted { color: #a79ed0; font-size: 14px; }
  a { color: #f2dc1a; }
  .bookmark { display: inline-block; margin: 10px 0 4px; padding: 9px 18px; border-radius: 8px; background: #f2dc1a; color: #07050d; font-weight: 700; text-decoration: none; cursor: grab; }
  kbd { border: 1px solid #4a3f78; border-radius: 4px; padding: 0 5px; font: 13px ui-monospace, monospace; }
</style></head>
<body><main>
  <h1>Sign in with your browser</h1>
  <p class="lead">For when the sign-in window inside sc player is blocked. It takes a minute, and next time it's one click.</p>
  <ol>
    <li><b>Drag this button to your bookmarks bar</b> (don't click it here):<br>
      <a class="bookmark" href="${href}" onclick="alert('Drag it to the bookmarks bar instead of clicking.');return false">sc player sign-in</a><br>
      <span class="muted">No bookmarks bar? Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>.</span></li>
    <li><b>Sign in to SoundCloud</b> in this browser as usual: <a href="https://soundcloud.com/signin">soundcloud.com/signin</a>.<br>
      <span class="muted">Already signed in here? Just open <a href="https://soundcloud.com/">soundcloud.com</a>.</span></li>
    <li><b>On soundcloud.com, click the “sc player sign-in” bookmark.</b> The browser asks whether to open sc player — allow it. sc player signs in and this tab can be closed.</li>
  </ol>
  <p class="muted">The bookmark only passes your SoundCloud sign-in to sc player on this computer; it sends nothing anywhere else. Treat it like a password: don't share screenshots of the address it opens.</p>
</main></body></html>`;
}
