import { app, BrowserWindow, ipcMain, session, shell, type IpcMainInvokeEvent } from "electron";
import { RENDERER_DEFAULTS, type AuthStatus, type InvokeChannel, type InvokeMap, type RendererState, type Result, type ThemePref } from "@shared/ipc";
import type { MusicProvider, SearchKind } from "@shared/provider";
import { DemoProvider } from "./demo";
import { auth, authStatus, chromeUserAgent, provider, ScError, scSession, toErrorInfo } from "./soundcloud";
import { patchRenderer, store } from "./store";
import { onSystemTheme, setThemePref, THEME_BG, themeState } from "./theme";
import { createMainWindow, isAppUrl, send } from "./windows/main-window";

let main: BrowserWindow | null = null;

/** SKY_DEMO=1 in development: made-up data instead of SoundCloud (src/main/demo.ts). */
const DEMO = !app.isPackaged && process.env.SKY_DEMO === "1";
const data: MusicProvider = DEMO ? new DemoProvider() : provider;
const status = async (): Promise<AuthStatus> => (DEMO ? { mode: "session", user: await data.getMe() } : authStatus());

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId("com.skythemontage.skyplayer");

// ---- IPC ------------------------------------------------------------------------------------------------------------

type Handler<K extends InvokeChannel> = (e: IpcMainInvokeEvent, ...args: Parameters<InvokeMap[K]>) => ReturnType<InvokeMap[K]> | Promise<ReturnType<InvokeMap[K]>>;

/** Every channel answers with a Result: errors cross the bridge as { code, message }, never as thrown objects. */
function handle<K extends InvokeChannel>(channel: K, fn: Handler<K>) {
  ipcMain.handle(channel, async (e, ...args): Promise<Result<unknown>> => {
    if (!e.senderFrame || !isAppUrl(e.senderFrame.url)) return { ok: false, error: { code: "unknown", message: "untrusted sender" } };
    try {
      return { ok: true, data: await fn(e, ...(args as Parameters<InvokeMap[K]>)) };
    } catch (err) {
      return { ok: false, error: toErrorInfo(err) };
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
const prefs: ThemePref[] = ["system", "night", "day"];

function registerIpc() {
  handle("auth:status", () => status());
  handle("auth:login", async () => {
    if (await auth.login(main)) provider.reset();
    const status = await authStatus();
    send(main, "auth:changed", status);
    main?.focus();
    return status;
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
  handle("data:userPlaylists", (_e, u, c) => data.getUserPlaylists(id(u), cursor(c)));
  handle("data:resolve", (_e, url) => data.resolve(str(url, "url")));
  handle("data:search", (_e, q, kind, c) => data.search(str(q, "query"), kinds.includes(kind) ? kind : bad("kind"), cursor(c)));
  handle("data:suggest", (_e, q) => data.searchSuggestions(str(q, "query")));
  handle("data:stream", (_e, t) => data.getStreamUrl(id(t)));
  handle("data:waveform", (_e, url) => data.getWaveform(str(url, "url")));

  handle("win:minimize", () => main?.minimize());
  handle("win:toggleMaximize", () => {
    if (main?.isMaximized()) main.unmaximize();
    else main?.maximize();
  });
  handle("win:close", () => main?.close());

  handle("theme:set", (_e, pref) => {
    const state = setThemePref(prefs.includes(pref) ? pref : bad("theme"));
    main?.setBackgroundColor(THEME_BG[state.theme]);
    return state;
  });

  handle("store:get", () => store().get().renderer);
  handle("store:set", (_e, patch) => {
    if (typeof patch !== "object" || patch === null) bad("patch");
    const known = Object.keys(RENDERER_DEFAULTS);
    patchRenderer(Object.fromEntries(Object.entries(patch).filter(([k]) => known.includes(k))) as Partial<RendererState>);
  });

  handle("shell:open", (_e, url) => {
    const target = new URL(str(url, "url"));
    if (target.protocol === "https:") void shell.openExternal(target.href);
  });

  ipcMain.on("boot:theme", (e) => {
    e.returnValue = themeState();
  });
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

app.on("second-instance", () => {
  if (!main) return;
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => store().flush());

void app.whenReady().then(async () => {
  scSession().setUserAgent(chromeUserAgent());
  allowAudioCors();
  registerIpc();
  await auth.restore();
  main = createMainWindow();
  main.on("closed", () => (main = null));
  onSystemTheme((state) => {
    main?.setBackgroundColor(THEME_BG[state.theme]);
    send(main, "theme:changed", state);
  });
});
