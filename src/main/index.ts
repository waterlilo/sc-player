import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, clipboard, ipcMain, session, shell, type IpcMainInvokeEvent } from "electron";
import { RENDERER_DEFAULTS, type AuthStatus, type InvokeChannel, type InvokeMap, type PlayerCommand, type PlayerInfo, type RendererState, type Result } from "@shared/ipc";
import type { MusicProvider, SearchKind } from "@shared/provider";
import type { SocialTrack } from "@shared/social";
import type { QueueSource } from "@shared/types";
import { DemoProvider } from "./demo";
import { flushLyrics, lyricsFor, pickLyrics, searchLyrics } from "./lyrics";
import { auth, authStatus, chromeUserAgent, provider, ScError, scSession, startBrowserSignIn, stopBrowserSignIn, toErrorInfo, tokenFromArgs, waitingForBrowser } from "./soundcloud";
import { flushAlternatives } from "./soundcloud/alternatives";
import * as social from "./social";
import { patchRenderer, prefs, store } from "./store";
import { getSecret, setSecret } from "./store/secrets";
import { applyAutostart, startedHidden } from "./system/autostart";
import { pickBackground, registerBackgroundScheme, serveBackgrounds } from "./system/background";
import { applyHotkeys, initHotkeys, suspendHotkeys } from "./system/hotkeys";
import { log, logsDir } from "./system/log";
import { netCheck } from "./system/netcheck";
import { applyProxy, hasBuiltinProxy, initProxyAuth } from "./system/proxy";
import { notifyTrack } from "./system/notify";
import { createTray, showWindow, updateTray } from "./system/tray";
import { updateThumbar } from "./system/thumbar";
import { previewTrackPopup, trackPopup } from "./system/track-popup";
import * as updater from "./system/updater";
import { createMainWindow, isAppUrl, send } from "./windows/main-window";

let main: BrowserWindow | null = null;
let quitting = false;
/** the last playback state the page reported (tray, taskbar buttons, popup preview) */
let playerInfo: PlayerInfo = { track: null, playing: false };
const command = (c: PlayerCommand) => send(main, "player:command", c);

// The app was called "sky player" before: move its data (settings, sign-in) to the new folder once. If the new folder
// already exists without settings (a first start that couldn't move the old one), it is set aside, not deleted.
{
  const old = join(app.getPath("appData"), "sky player");
  const current = app.getPath("userData");
  const has = (dir: string) => existsSync(join(dir, "settings.json"));
  if (old !== current && has(old) && !has(current)) {
    try {
      if (existsSync(current)) renameSync(current, `${current}.unused-${Date.now()}`);
      renameSync(old, current);
    } catch {
      /* in use or not allowed: start fresh */
    }
  }
}

/** SKY_DEMO=1 in development: made-up data instead of SoundCloud (src/main/demo.ts). */
const DEMO = !app.isPackaged && process.env.SKY_DEMO === "1";
// the demo keeps its own settings, history and sign-in, apart from the real ones
if (DEMO) app.setPath("userData", join(app.getPath("appData"), "sc player demo"));
// SKY_PROFILE=<name> in development: real SoundCloud with a data folder of its own (signed out, fresh settings)
else if (!app.isPackaged && process.env.SKY_PROFILE) app.setPath("userData", join(app.getPath("appData"), `sc player ${process.env.SKY_PROFILE.replace(/[^\w-]/g, "")}`));
const data: MusicProvider = DEMO ? new DemoProvider() : provider;
const status = async (): Promise<AuthStatus> => (DEMO ? { mode: "session", user: await data.getMe() } : authStatus());

if (!app.requestSingleInstanceLock()) app.quit();
registerBackgroundScheme();
app.setAppUserModelId("com.skythemontage.scplayer");

// ---- IPC ------------------------------------------------------------------------------------------------------------

type Handler<K extends InvokeChannel> = (e: IpcMainInvokeEvent, ...args: Parameters<InvokeMap[K]>) => ReturnType<InvokeMap[K]> | Promise<ReturnType<InvokeMap[K]>>;

/** Every channel answers with a Result: errors cross the bridge as { code, message }, never as thrown objects. */
function handle<K extends InvokeChannel>(channel: K, fn: Handler<K>) {
  ipcMain.handle(channel, async (e, ...args): Promise<Result<unknown>> => {
    if (!e.senderFrame || !isAppUrl(e.senderFrame.url)) return { ok: false, error: { code: "unknown", message: "untrusted sender" } };
    try {
      return { ok: true, data: await fn(e, ...(args as Parameters<InvokeMap[K]>)) };
    } catch (err) {
      const info = toErrorInfo(err);
      if (info.code !== "not_found") log("main", `${channel}: ${info.code} ${info.message}`);
      return { ok: false, error: info };
    }
  });
}

// arguments come from the page: check their types before they reach anything
const bad = (what: string): never => {
  throw new ScError("unknown", `bad argument: ${what}`);
};
const str = (v: unknown, what: string) => (typeof v === "string" && v.length < 4096 ? v : bad(what));
const cursor = (v: unknown) => (v === null || v === undefined ? null : str(v, "cursor"));
const id = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : bad("id"));
const kinds: SearchKind[] = ["tracks", "playlists", "users"];
const themeId = (v: unknown) => (typeof v === "string" && /^[\w-]{10}$/.test(v) ? v : bad("theme id"));
/** a track to send or show to friends: the fields the server keeps */
function socialTrack(v: unknown): SocialTrack {
  const t = (typeof v === "object" && v !== null ? v : bad("track")) as Record<string, unknown>;
  return {
    id: id(t.id),
    title: str(t.title, "title"),
    artist: str(t.artist, "artist"),
    // the server takes SoundCloud's own pictures only; anything else would refuse the whole message
    artworkUrl: typeof t.artworkUrl === "string" && /^https:\/\/[a-z0-9.-]+\.sndcdn\.com\//.test(t.artworkUrl) ? t.artworkUrl : null,
    permalinkUrl: str(t.permalinkUrl, "link"),
    durationMs: typeof t.durationMs === "number" ? Math.max(0, Math.round(t.durationMs)) : 0,
  };
}
/** a queue source from the page: only the fields each kind needs, type-checked */
function queueSource(v: unknown): QueueSource {
  const s = (typeof v === "object" && v !== null ? v : bad("source")) as Record<string, unknown>;
  switch (s.kind) {
    case "likes":
      return { kind: "likes", userId: s.userId === "me" ? "me" : id(s.userId), cursor: null };
    case "userTracks":
      return { kind: "userTracks", userId: id(s.userId), cursor: null };
    case "playlist":
      return { kind: "playlist", playlistId: str(s.playlistId, "playlist id"), cursor: null };
    case "search":
      return { kind: "search", query: str(s.query, "query"), cursor: null };
    case "feed":
      return { kind: "feed", cursor: null };
    default:
      return { kind: "static" };
  }
}

function registerIpc() {
  handle("auth:status", () => status());
  handle("auth:login", async () => {
    if (await auth.login(main)) provider.reset();
    const status = await authStatus();
    send(main, "auth:changed", status);
    main?.focus();
    return status;
  });
  handle("auth:browser", () => startBrowserSignIn());
  handle("auth:browserCancel", () => stopBrowserSignIn());
  handle("auth:check", (_e, url) => {
    const to = str(url, "url");
    return auth.check(/^https:\/\/(www\.|m\.)?soundcloud\.com\//.test(to) ? to : "https://soundcloud.com/", main);
  });
  handle("auth:logout", async () => {
    await auth.logout();
    provider.reset();
    const status = await authStatus();
    send(main, "auth:changed", status);
    return status;
  });

  handle("data:me", () => data.getMe());
  handle("data:likes", (_e, c) => data.getLikes(cursor(c)));
  handle("data:playlists", (_e, c) => data.getPlaylists(cursor(c)));
  handle("data:playlist", (_e, p) => data.getPlaylist(str(p, "playlist id")));
  handle("data:playlistTracks", (_e, p, c) => data.getPlaylistTracks(str(p, "playlist id"), cursor(c)));
  handle("data:user", (_e, u) => data.getUser(id(u)));
  handle("data:userLikes", (_e, u, c) => data.getUserLikes(id(u), cursor(c)));
  handle("data:userTracks", (_e, u, c) => data.getUserTracks(id(u), cursor(c)));
  handle("data:userPlaylists", (_e, u, c) => data.getUserPlaylists(id(u), cursor(c)));
  handle("data:tracks", (_e, ids) => data.getTracks(Array.isArray(ids) ? ids.map(id) : bad("ids")));
  handle("data:sourceIds", (_e, source) => data.getSourceIds(queueSource(source)));
  handle("data:related", (_e, t) => data.getRelated(id(t)));
  handle("data:trackDetails", (_e, t) => data.getTrackDetails(id(t)));
  handle("data:alternatives", (_e, t, deep) => data.getAlternatives(id(t), deep === true));
  handle("lyrics:get", (_e, q) => {
    const o = (q ?? {}) as Record<string, unknown>;
    return lyricsFor({ trackId: id(o.trackId), artist: str(o.artist, "artist"), title: str(o.title, "title"), durationMs: typeof o.durationMs === "number" ? o.durationMs : 0 });
  });
  handle("lyrics:search", (_e, text) => searchLyrics(str(text, "text")));
  handle("lyrics:pick", (_e, t, l) => pickLyrics(id(t), id(l)));
  handle("data:feed", (_e, c) => data.getFeed(cursor(c)));
  handle("data:likedIds", (_e, refresh) => data.getLikedIds(refresh === true));
  handle("data:setLiked", (_e, t, on) => (on === true ? data.like(id(t)) : data.unlike(id(t))));
  handle("data:myPlaylists", () => data.getMyPlaylists());
  handle("data:addToPlaylist", (_e, p, t) => data.addToPlaylist(str(p, "playlist id"), id(t)));
  handle("data:resolve", (_e, url) => data.resolve(str(url, "url")));
  handle("data:search", (_e, q, kind, c) => data.search(str(q, "query"), kinds.includes(kind) ? kind : bad("kind"), cursor(c)));
  handle("data:suggest", (_e, q) => data.searchSuggestions(str(q, "query")));
  handle("data:stream", (_e, t) => data.getStreamUrl(id(t)));
  handle("data:waveform", (_e, url) => data.getWaveform(str(url, "url")));

  handle("bg:pick", () => pickBackground(main));

  handle("social:status", () => social.status());
  handle("social:join", (_e, name) => social.join(str(name, "name").slice(0, 32)));
  handle("social:profile", (_e, patch) => {
    const p = (typeof patch === "object" && patch !== null ? patch : bad("patch")) as Record<string, unknown>;
    return social.updateProfile({ ...(p.name !== undefined ? { name: str(p.name, "name").slice(0, 32) } : {}), ...(p.shareNow !== undefined ? { shareNow: p.shareNow === true } : {}) });
  });
  handle("social:leave", () => social.leave());
  handle("social:friends", () => social.getFriends());
  handle("social:addFriend", (_e, code) => social.friendAction("add", str(code, "code").slice(0, 16)));
  handle("social:accept", (_e, code) => social.friendAction("accept", str(code, "code").slice(0, 16)));
  handle("social:removeFriend", (_e, code) => social.friendAction("remove", str(code, "code").slice(0, 16)));
  handle("social:send", (_e, codes, track) => social.sendTrack(Array.isArray(codes) ? codes.slice(0, 20).map((c) => str(c, "code").slice(0, 16)) : bad("codes"), socialTrack(track)));
  handle("social:chat", (_e, code, before) => social.chat(str(code, "code").slice(0, 16), before === undefined ? undefined : id(before)));
  handle("social:seen", (_e, code) => social.seen(str(code, "code").slice(0, 16)));
  handle("social:state", (_e, m, state) => social.setState(id(m), state === "heard" || state === "liked" || state === "queued" ? state : bad("state")));
  handle("social:now", (_e, track) => social.now(track === null ? null : socialTrack(track)));
  handle("social:poll", () => social.poll());
  handle("ws:list", (_e, sort, page, q, mine) => social.wsList(sort === "top" ? "top" : "new", typeof page === "number" && page >= 0 && page < 1000 ? Math.floor(page) : 0, str(q ?? "", "query").slice(0, 40), mine === true));
  handle("ws:get", (_e, t) => social.wsGet(themeId(t)));
  handle("ws:publish", (_e, t) => {
    const o = (typeof t === "object" && t !== null ? t : bad("theme")) as Record<string, unknown>;
    return social.wsPublish({ name: str(o.name, "name").slice(0, 40), description: str(o.description ?? "", "description").slice(0, 300), withBackground: o.withBackground === true });
  });
  handle("ws:install", (_e, t) => social.wsInstall(themeId(t)));
  handle("ws:like", (_e, t) => social.wsLike(themeId(t)));
  handle("ws:report", (_e, t, reason) => social.wsReport(themeId(t), str(reason ?? "", "reason").slice(0, 300)));
  handle("ws:delete", (_e, t) => social.wsDelete(themeId(t)));
  handle("win:minimize", () => main?.minimize());
  handle("win:toggleMaximize", () => {
    if (main?.isMaximized()) main.unmaximize();
    else main?.maximize();
  });
  handle("win:close", () => main?.close());

  handle("store:get", () => store().get().renderer);
  handle("store:set", (_e, patch) => {
    if (typeof patch !== "object" || patch === null) bad("patch");
    const known = Object.keys(RENDERER_DEFAULTS);
    const before = prefs();
    patchRenderer(Object.fromEntries(Object.entries(patch).filter(([k]) => known.includes(k))) as Partial<RendererState>);
    if ("prefs" in patch) applySystemPrefs(before);
  });

  handle("player:state", (_e, info) => {
    playerInfo = info;
    const inFront = !!main?.isVisible() && !!main?.isFocused();
    updateTray(info);
    updateThumbar(main, info, command);
    void notifyTrack(info, prefs().notifications, inFront);
    trackPopup(info, { enabled: prefs().trackPopup, corner: prefs().popupCorner, windowInFront: inFront, design: prefs().look.design });
  });
  handle("popup:preview", () => {
    const sample: PlayerInfo = { track: { id: -1, title: "Track title", artist: "Artist", artworkUrl: null }, playing: true };
    previewTrackPopup(playerInfo.track ? playerInfo : sample, prefs().popupCorner, prefs().look.design);
  });
  handle("hotkeys:suspend", (_e, on) => {
    send(main, "hotkeys:failed", suspendHotkeys(on === true));
  });
  handle("app:info", () => ({ version: app.getVersion(), portable: !!process.env.PORTABLE_EXECUTABLE_DIR, packaged: app.isPackaged, logsDir: logsDir(), builtinProxy: hasBuiltinProxy() }));
  handle("log:write", (_e, message) => log("page", str(message, "message")));
  handle("diag:openLogs", async () => {
    await shell.openPath(logsDir());
  });
  handle("diag:netcheck", () => netCheck());
  handle("proxy:setPassword", (_e, password) => {
    const p = str(password, "password");
    setSecret("proxyPassword", p ? p : null);
    return !!p;
  });
  handle("proxy:hasPassword", () => getSecret("proxyPassword") !== null);
  handle("diag:clearCache", async () => {
    provider.reset();
    await Promise.all([session.defaultSession.clearCache(), scSession().clearCache()]);
  });
  handle("update:check", () => updater.check());
  handle("update:download", () => updater.download());
  handle("update:install", () => {
    quitting = true;
  if (waitingForBrowser()) stopBrowserSignIn();
    updater.install();
  });

  handle("clipboard:write", (_e, text) => clipboard.writeText(str(text, "text")));
  handle("clipboard:read", async () => (await clipboard.readText()).slice(0, 2000));
  handle("shell:open", (_e, url) => {
    const target = new URL(str(url, "url"));
    if (target.protocol === "https:") void shell.openExternal(target.href);
  });

}

/** Settings changed: apply what main is responsible for (autostart, global shortcuts). */
function applySystemPrefs(before: ReturnType<typeof prefs>) {
  const now = prefs();
  if (now.startWithWindows !== before.startWithWindows) applyAutostart(now.startWithWindows);
  if (JSON.stringify(now.hotkeys) !== JSON.stringify(before.hotkeys)) send(main, "hotkeys:failed", applyHotkeys(now.hotkeys));
  if (JSON.stringify(now.proxy) !== JSON.stringify(before.proxy)) void applyProxy(now.proxy);
}

// ---- network --------------------------------------------------------------------------------------------------------

/**
 * Audio is fetched by the page (hls.js), from SoundCloud's CDN. If a CDN response comes without CORS headers the
 * player would fail, so they are added for those hosts only.
 */
function allowAudioCors() {
  session.defaultSession.webRequest.onHeadersReceived({ urls: ["https://*.sndcdn.com/*", "https://*.soundcloud.cloud/*"] }, (details, callback) => {
    const headers = details.responseHeaders ?? {};
    const has = Object.keys(headers).some((k) => k.toLowerCase() === "access-control-allow-origin");
    if (!has) headers["Access-Control-Allow-Origin"] = ["*"];
    callback({ responseHeaders: headers });
  });
}

// ---- lifecycle ------------------------------------------------------------------------------------------------------

/** The browser sign-in's link (scplayer://signin?token=…) arrives as a second instance's arguments. */
async function signInFromBrowser(argv: string[]) {
  const token = tokenFromArgs(argv);
  if (!token) return;
  if (!waitingForBrowser()) {
    log("main", "login: browser link ignored (not waiting for one)");
    return;
  }
  auth.useToken(token);
  provider.reset();
  const status = await authStatus();
  // a refused token is forgotten by authStatus: the app stays signed out and keeps waiting for another try
  if (status.mode === "session") {
    stopBrowserSignIn();
    log("main", "login: signed in through the browser");
  } else {
    log("main", "login: browser token refused");
    send(main, "auth:browserRefused", null);
  }
  send(main, "auth:changed", status);
}

app.on("second-instance", (_e, argv) => {
  showWindow(main);
  void signInFromBrowser(argv);
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  quitting = true;
  store().flush();
  flushAlternatives();
  flushLyrics();
});
process.on("uncaughtException", (err) => log("main", `uncaught: ${err.stack ?? err.message}`));

void app.whenReady().then(async () => {
  scSession().setUserAgent(chromeUserAgent());
  initProxyAuth(() => prefs().proxy.username);
  await applyProxy(prefs().proxy);
  allowAudioCors();
  serveBackgrounds();
  registerIpc();
  await auth.restore();
  const p = prefs();
  main = createMainWindow({ startHidden: startedHidden() && p.startMinimized, closeToTray: () => prefs().closeToTray, quitting: () => quitting });
  main.on("closed", () => (main = null));
  // Windows forgets the taskbar buttons while the window is hidden
  main.on("show", () => updateThumbar(main, playerInfo, command, true));
  createTray({
    window: () => main,
    command,
    quit: () => {
      quitting = true;
      app.quit();
    },
  });
  initHotkeys((action) => (action === "showWindow" ? showWindow(main) : send(main, "player:command", action)));
  const failed = applyHotkeys(p.hotkeys);
  main.webContents.once("did-finish-load", () => send(main, "hotkeys:failed", failed));
  applyAutostart(p.startWithWindows);
  updater.initUpdater(() => main, () => prefs().checkUpdates);
  social.initSocial(() => main);
  // back in front: the messenger catches up at once
  main.on("focus", () => void social.poll());
});
