import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, shell } from "electron";
import { lang } from "../i18n";
import { log } from "../system/log";
import { parseFriendFromArgs, parseTokenFromArgs, PROTOCOL, TOKEN } from "./browser-signin-url";

export { PROTOCOL, TOKEN };

/**
 * Sign-in through the user's own browser: the only way in since 2.1.4 (SoundCloud's bot protection kept turning the
 * window inside the app down; a browser the person uses every day passes it).
 *
 * The browser shows a helper page (written to the temp folder) with a bookmark to drag to the bookmarks bar. After
 * signing in on soundcloud.com as usual, a click on that bookmark reads the site's own `oauth_token` cookie (readable
 * by the page's scripts) and hands it to the app through the `scplayer://` link: Windows starts the app with that link
 * and the running app gets it as a second instance's arguments. Nothing leaves the computer.
 *
 * A link is taken at once while the user is waiting for it (they pressed "Sign in with your browser" in the last
 * 15 minutes); any other time the app asks first, so another page can't sign it into someone else's account. The
 * link handler stays registered after a sign-in (next time the bookmark alone does it) and goes with "Cancel".
 */
const WAIT_MS = 15 * 60_000;
let waitingUntil = 0;

const handlerArgs = (): [string, string[]] =>
  // in development the app runs as "electron <project folder>"; a portable build is the outer .exe, not the
  // unpacked copy in the temp folder that is gone after it quits
  process.defaultApp ? [process.execPath, [app.getAppPath()]] : [process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath, []];

export function waitingForBrowser() {
  return Date.now() < waitingUntil;
}

/** scplayer:// links open this app: a sign-in from the browser, a friend's link. Set at every start (installed). */
export function registerLinks() {
  if (process.platform === "darwin") {
    if (process.defaultApp) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [app.getAppPath()]);
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL);
    }
  } else {
    const [exe, args] = handlerArgs();
    app.setAsDefaultProtocolClient(PROTOCOL, exe, args);
  }
}

/** The code from a friend link (`scplayer://friend/SKY-XXXXX`) among a new instance's arguments, if there is one. */
export const friendFromArgs = parseFriendFromArgs;

export function startBrowserSignIn() {
  registerLinks();
  waitingUntil = Date.now() + WAIT_MS;
  const page = join(app.getPath("temp"), "sc-player-sign-in.html");
  writeFileSync(page, helperPage(), "utf8");
  log("main", "login: browser sign-in started");
  void shell.openPath(page);
}

/** Signed in: the wait is over, the link stays for next time. */
export function finishBrowserSignIn() {
  waitingUntil = 0;
}

export function stopBrowserSignIn() {
  // the link handler stays: friend links use it too
  waitingUntil = 0;
}

/** The token from a `scplayer://signin?token=…` link among a new instance's arguments, if there is one. */
export function tokenFromArgs(argv: string[]): string | null {
  return parseTokenFromArgs(argv, (msg) => log("main", msg));
}

function helperPage() {
  const isRu = lang() === "ru";
  const modKey = process.platform === "darwin" ? "Cmd" : "Ctrl";
  const notScMsg = isRu ? "Сначала откройте soundcloud.com, затем нажмите эту закладку." : "Open soundcloud.com first, then click this bookmark.";
  const notLoggedInMsg = isRu ? "Сначала войдите в SoundCloud, затем снова нажмите эту закладку." : "Sign in to SoundCloud first, then click this bookmark again.";
  const bookmarklet = `(()=>{if(!/(^|\\.)soundcloud\\.com$/.test(location.hostname)){alert("${notScMsg}");return}const m=document.cookie.match(/(?:^|;\\s*)oauth_token=([^;]+)/);if(!m){alert("${notLoggedInMsg}");return}location.href="${PROTOCOL}://signin?token="+encodeURIComponent(m[1])})()`;
  const href = `javascript:${encodeURIComponent(bookmarklet)}`;

  const title = isRu ? "sc player — вход через браузер" : "sc player — sign in with your browser";
  const h1 = isRu ? "Вход через браузер" : "Sign in with your browser";
  const lead = isRu ? "Это займёт минуту, а в следующий раз — в один клик." : "It takes a minute, and next time it's one click.";
  const dragNotice = isRu ? "Перетащите на панель закладок, а не нажимайте здесь." : "Drag it to the bookmarks bar instead of clicking.";
  const step1 = isRu
    ? `<b>Перетащите эту кнопку на панель закладок</b> (не нажимайте здесь):<br>
      <a class="bookmark" href="${href}" onclick="alert('${dragNotice}');return false">sc player sign-in</a><br>
      <span class="muted">Нет панели закладок? Нажмите <kbd>${modKey}</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>.</span>`
    : `<b>Drag this button to your bookmarks bar</b> (don't click it here):<br>
      <a class="bookmark" href="${href}" onclick="alert('${dragNotice}');return false">sc player sign-in</a><br>
      <span class="muted">No bookmarks bar? Press <kbd>${modKey}</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>.</span>`;
  const step2 = isRu
    ? `<b>Войдите в SoundCloud</b> в этом браузере как обычно: <a href="https://soundcloud.com/signin">soundcloud.com/signin</a>.<br>
      <span class="muted">Уже вошли? Просто откройте <a href="https://soundcloud.com/">soundcloud.com</a>.</span>`
    : `<b>Sign in to SoundCloud</b> in this browser as usual: <a href="https://soundcloud.com/signin">soundcloud.com/signin</a>.<br>
      <span class="muted">Already signed in here? Just open <a href="https://soundcloud.com/">soundcloud.com</a>.</span>`;
  const step3 = isRu
    ? `<b>На soundcloud.com нажмите закладку «sc player sign-in».</b> Браузер спросит, открыть ли sc player — подтвердите. sc player выполнит вход, и эту вкладку можно закрыть.`
    : `<b>On soundcloud.com, click the “sc player sign-in” bookmark.</b> The browser asks whether to open sc player — allow it. sc player signs in and this tab can be closed.`;
  const footer = isRu
    ? `Закладка лишь передаёт ваш вход SoundCloud в sc player на этом компьютере; она никуда ничего не отправляет. Относитесь к ней как к паролю: не делитесь снимками экрана адреса, который она открывает.`
    : `The bookmark only passes your SoundCloud sign-in to sc player on this computer; it sends nothing anywhere else. Treat it like a password: don't share screenshots of the address it opens.`;

  return `<!doctype html>
<html lang="${isRu ? "ru" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
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
  <h1>${h1}</h1>
  <p class="lead">${lead}</p>
  <ol>
    <li>${step1}</li>
    <li>${step2}</li>
    <li>${step3}</li>
  </ol>
  <p class="muted">${footer}</p>
</main></body></html>`;
}
