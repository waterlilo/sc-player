import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { release } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell, type IpcMainInvokeEvent } from "electron";
import { RENDERER_DEFAULTS, type AuthStatus, type InvokeChannel, type InvokeMap, type PlayerCommand, type PlayerInfo, type RendererState, type Result } from "@shared/ipc";
import type { MusicProvider, SearchKind } from "@shared/provider";
import type { RoomOp, SocialTrack } from "@shared/social";
import type { QueueSource, SyncRequest, Track, LyricsSuggestionState } from "@shared/types";
import { DemoProvider } from "./demo";
import { addLocal, createLocal, deleteLocal, exportLocal, importLocal, flushLocalPlaylists, isLocal, localIds, localPlaylist, localPlaylists, localTracks, MAX_TRACKS, renameLocal, setLocalTracks } from "./local-playlists";
import { communityLyrics, flushLyrics, forgetLyrics, lyricsFor, ownText, pickLyrics, searchLyrics, setCommunityLyrics, setOwnLyrics } from "./lyrics";
import { deleteModel, downloadModel, flushLyricsSync, onSyncStatus, syncedBefore, syncStatus, syncWords } from "./lyrics-sync";
import { auth, authStatus, chromeUserAgent, provider, ScError, scSession, finishBrowserSignIn, friendFromArgs, registerLinks, startBrowserSignIn, stopBrowserSignIn, toErrorInfo, tokenFromArgs, waitingForBrowser } from "./soundcloud";
import { flushAlternatives } from "./soundcloud/alternatives";
import * as rooms from "./rooms";
import * as social from "./social";
import { patchRenderer, prefs, store } from "./store";
import { getSecret, setSecret, unopenedSecrets } from "./store/secrets";
import { applyAutostart, startedHidden } from "./system/autostart";
import { backgroundSize, dropBackgrounds, keepImport, pickBackground, registerBackgroundScheme, saveBackground, serveBackgrounds } from "./system/background";
import { findWallpaper, workshopId } from "./system/steam-wallpaper";
import { applyHotkeys, initHotkeys, suspendHotkeys } from "./system/hotkeys";
import { log, logsDir } from "./system/log";
import { netCheck } from "./system/netcheck";
import { applyProxy, hasBuiltinProxy, initProxyAuth, initProxyAuto, proxyRoute } from "./system/proxy";
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
const signedIn = () => DEMO || !!auth.token();
/** full tracks for any number of ids, in their order (the provider takes 200 at a time) */
async function tracksOf(ids: number[]): Promise<Track[]> {
  const out: Track[] = [];
  for (let i = 0; i < ids.length; i += 200) out.push(...(await data.getTracks(ids.slice(i, i + 200))));
  return out;
}
const status = async (): Promise<AuthStatus> => (DEMO ? { mode: "session", user: await data.getMe() } : authStatus());

if (!app.requestSingleInstanceLock()) app.quit();
setCommunityLyrics((t) => social.approvedLyrics(t));
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
function syncRequest(v: unknown): SyncRequest {
  const q = (typeof v === "object" && v !== null ? v : bad("request")) as Record<string, unknown>;
  const source = q.source === "lrclib" || q.source === "betterlyrics" || q.source === "unison" || q.source === "own" ? q.source : bad("source");
  const plain = typeof q.plain === "string" && q.plain.length < 50_000 ? q.plain : bad("words");
  const times = q.times === undefined ? undefined : Array.isArray(q.times) && q.times.length <= 2000 && q.times.every((t) => typeof t === "number" && Number.isFinite(t)) ? (q.times as number[]) : bad("times");
  return { trackId: id(q.trackId), source, lyricsId: typeof q.lyricsId === "number" && Number.isSafeInteger(q.lyricsId) && q.lyricsId >= 0 ? q.lyricsId : bad("lyrics id"), plain, ...(times ? { times } : {}) };
}
/** a command for the room: only the known ones, with their arguments checked (the server checks again) */
function roomOp(v: unknown): RoomOp {
  const o = (typeof v === "object" && v !== null ? v : bad("op")) as Record<string, unknown>;
  const num = (x: unknown, what: string) => (typeof x === "number" && Number.isFinite(x) ? x : bad(what));
  const item = () => str(o.item, "item").slice(0, 16);
  switch (o.op) {
    case "play":
      return { op: "play", track: socialTrack(o.track), position: o.position === undefined ? 0 : Math.max(0, num(o.position, "position")) };
    case "playing":
      return { op: "playing", playing: o.playing === true };
    case "seek":
      return { op: "seek", position: Math.max(0, num(o.position, "position")) };
    case "next":
      return { op: "next" };
    case "queueAdd":
      return { op: "queueAdd", track: socialTrack(o.track), next: o.next === true, auto: o.auto === true };
    case "queueRemove":
      return { op: "queueRemove", item: item() };
    case "queueMove":
      return { op: "queueMove", item: item(), to: Math.max(0, Math.floor(num(o.to, "to"))) };
    case "suggest":
      return { op: "suggest", track: socialTrack(o.track) };
    case "decide":
      return { op: "decide", item: item(), take: o.take === true };
    case "ready":
      return { op: "ready", trackId: id(o.trackId) };
    case "playList": {
      if (!Array.isArray(o.tracks) || !o.tracks.length || o.tracks.length > 501) return bad("tracks");
      return { op: "playList", tracks: o.tracks.map(socialTrack), title: typeof o.title === "string" ? o.title.slice(0, 200) : "" };
    }
    case "listAppend": {
      if (!Array.isArray(o.tracks) || !o.tracks.length || o.tracks.length > 500) return bad("tracks");
      return { op: "listAppend", tracks: o.tracks.map(socialTrack) };
    }
    case "listRemove":
      return { op: "listRemove", item: item() };
    case "listClear":
      return { op: "listClear" };
    case "handOver":
      return { op: "handOver", to: str(o.to, "to").slice(0, 16) };
    default:
      return bad("op");
  }
}
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
  // playlists: SoundCloud's for the signed in, ones on this computer (local-playlists.ts) for everyone
  handle("data:playlists", async (_e, c) => {
    const from = cursor(c);
    if (!signedIn()) return { items: from ? [] : localPlaylists(), next: null };
    const page = await data.getPlaylists(from);
    return from ? page : { ...page, items: [...localPlaylists(), ...page.items] };
  });
  handle("data:playlist", (_e, p) => {
    const pid = str(p, "playlist id");
    return isLocal(pid) ? localPlaylist(pid) : data.getPlaylist(pid);
  });
  handle("data:playlistTracks", (_e, p, c) => {
    const pid = str(p, "playlist id");
    return isLocal(pid) ? localTracks(pid, cursor(c), (ids) => data.getTracks(ids)) : data.getPlaylistTracks(pid, cursor(c));
  });
  handle("data:user", (_e, u) => data.getUser(id(u)));
  handle("data:userLikes", (_e, u, c) => data.getUserLikes(id(u), cursor(c)));
  handle("data:userTracks", (_e, u, c) => data.getUserTracks(id(u), cursor(c)));
  handle("data:userPlaylists", (_e, u, c) => data.getUserPlaylists(id(u), cursor(c)));
  handle("data:followings", (_e, u, c) => data.getFollowings(u === "me" ? "me" : id(u), cursor(c)));
  handle("data:tracks", (_e, ids) => data.getTracks(Array.isArray(ids) ? ids.map(id) : bad("ids")));
  handle("data:sourceIds", (_e, source) => {
    const s = queueSource(source);
    return s.kind === "playlist" && isLocal(s.playlistId) ? localIds(s.playlistId) : data.getSourceIds(s);
  });
  handle("data:related", (_e, t) => data.getRelated(id(t)));
  handle("data:trackDetails", (_e, t) => data.getTrackDetails(id(t)));
  handle("data:alternatives", (_e, t, deep) => data.getAlternatives(id(t), deep === true));
  handle("lyrics:get", (_e, q) => {
    const o = (q ?? {}) as Record<string, unknown>;
    return lyricsFor({ trackId: id(o.trackId), artist: str(o.artist, "artist"), title: str(o.title, "title"), durationMs: typeof o.durationMs === "number" ? o.durationMs : 0 });
  });
  handle("lyrics:search", (_e, text) => searchLyrics(str(text, "text")));
  handle("lyrics:pick", (_e, t, l) => pickLyrics(id(t), id(l)));
  handle("lyrics:setOwn", (_e, q, text) => {
    const o = (q ?? {}) as Record<string, unknown>;
    // a whole song is longer than the usual argument
    const words = text === null ? null : typeof text === "string" && text.length <= 30_000 ? text : bad("text");
    return setOwnLyrics({ trackId: id(o.trackId), artist: str(o.artist, "artist"), title: str(o.title, "title") }, words);
  });
  const suggestion = (s: string): LyricsSuggestionState => (s === "pending" || s === "approved" || s === "rejected" || s === "replaced" ? s : "");
  handle("lyrics:suggest", async (_e, q) => {
    const o = (q ?? {}) as Record<string, unknown>;
    const trackId = id(o.trackId);
    const lrc = ownText(trackId) ?? bad("lyrics");
    const durationMs = typeof o.durationMs === "number" && Number.isFinite(o.durationMs) ? Math.max(0, Math.round(o.durationMs)) : 0;
    return suggestion(await social.suggestLyrics({ track: trackId, title: str(o.title, "title").slice(0, 300), artist: str(o.artist, "artist").slice(0, 200), durationMs, lrc }));
  });
  handle("lyrics:suggestion", async (_e, t) => suggestion(await social.lyricsStatus(id(t))));
  handle("lyrics:review", async () => (await social.reviewLyrics()).map(({ lrc, ...r }) => ({ ...r, lyrics: communityLyrics(r, lrc, r.by) })));
  handle("lyrics:decide", async (_e, l, approve, t) => {
    await social.decideLyrics(id(l), approve === true);
    forgetLyrics(id(t));
  });
  handle("lyricsSync:status", () => syncStatus());
  handle("lyricsSync:download", () => downloadModel());
  handle("lyricsSync:deleteModel", () => deleteModel());
  handle("lyricsSync:before", (_e, q) => syncedBefore(syncRequest(q)));
  // up to 20 minutes of 16 kHz sound
  handle("lyricsSync:run", (_e, q, pcm) => syncWords(syncRequest(q), pcm instanceof Float32Array && pcm.length > 0 && pcm.length <= 20 * 60 * 16000 ? pcm : bad("sound")));
  handle("data:feed", (_e, c) => data.getFeed(cursor(c)));
  handle("data:likedIds", (_e, refresh) => data.getLikedIds(refresh === true));
  handle("data:setLiked", (_e, t, on) => (on === true ? data.like(id(t)) : data.unlike(id(t))));
  // own playlists are made and changed on this computer: SoundCloud's bot protection refuses playlist changes from
  // the app (POST and PUT /playlists, tested 2026-10-25); SoundCloud's own playlists are for listening here
  const localId = (p: unknown) => {
    const pid = str(p, "playlist id");
    return isLocal(pid) ? pid : bad("playlist id");
  };
  handle("data:myPlaylists", () => localPlaylists());
  handle("data:addToPlaylist", async (_e, p, t) => {
    const pid = localId(p);
    const [track] = await data.getTracks([id(t)]);
    if (track) addLocal(pid, track);
  });
  handle("data:createPlaylist", async (_e, title, ids) => {
    const list = Array.isArray(ids) ? ids.slice(0, MAX_TRACKS).map(id) : bad("ids");
    return createLocal(str(title, "title").slice(0, 100), await tracksOf(list));
  });
  handle("data:setPlaylistTracks", (_e, p, ids) => setLocalTracks(localId(p), Array.isArray(ids) ? ids.slice(0, MAX_TRACKS).map(id) : bad("ids")));
  handle("data:renamePlaylist", (_e, p, title) => renameLocal(localId(p), str(title, "title").slice(0, 100)));
  handle("data:deletePlaylist", (_e, p) => deleteLocal(localId(p)));
  /** a file with all of them (a backup, another PC): how many were saved, or null when the save was cancelled */
  handle("data:exportPlaylists", async () => {
    const { text, count } = exportLocal();
    const date = new Date().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog(...((main ? [main] : []) as [BrowserWindow]), {
      defaultPath: join(app.getPath("documents"), `sc player playlists ${date}.json`),
      filters: [{ name: "sc player playlists", extensions: ["json"] }],
    });
    if (r.canceled || !r.filePath) return null;
    await writeFile(r.filePath, text, "utf8");
    return count;
  });
  /** playlists from such a file, added next to these: how many, or null when none was picked */
  handle("data:importPlaylists", async () => {
    const r = await dialog.showOpenDialog(...((main ? [main] : []) as [BrowserWindow]), { properties: ["openFile"], filters: [{ name: "sc player playlists", extensions: ["json"] }] });
    const path = r.filePaths[0];
    if (r.canceled || !path) return null;
    const text = await readFile(path, "utf8");
    if (text.length > 20 * 1024 * 1024) return bad("file");
    return importLocal(text);
  });
  handle("data:resolve", (_e, url) => data.resolve(str(url, "url")));
  handle("data:search", (_e, q, kind, c) => data.search(str(q, "query"), kinds.includes(kind) ? kind : bad("kind"), cursor(c)));
  handle("data:suggest", (_e, q) => data.searchSuggestions(str(q, "query")));
  handle("data:stream", (_e, t) => data.getStreamUrl(id(t)));
  handle("data:waveform", (_e, url) => data.getWaveform(str(url, "url")));

  handle("bg:pick", () => pickBackground(main));
  handle("bg:steamFind", (_e, link) => {
    const wid = workshopId(str(link, "link"));
    return wid ? findWallpaper(wid) : { found: false as const, id: "", reason: "link" as const };
  });
  handle("bg:steamOpen", (_e, wid) => {
    const item = workshopId(str(wid, "id")) ?? bad("id");
    // Steam opens the page itself (subscribing there downloads it); without Steam, the page on the web
    void shell.openExternal(`steam://url/CommunityFilePage/${item}`).catch(() => shell.openExternal(`https://steamcommunity.com/sharedfiles/filedetails/?id=${item}`));
  });
  handle("bg:keepImport", (_e, url) => keepImport(str(url, "url")));
  handle("bg:saveVideo", (_e, data) => (data instanceof Uint8Array && data.length > 0 && data.length <= 300 * 1024 * 1024 ? saveBackground(Buffer.from(data), "mp4") : bad("video")) as { file: string; type: "video" });
  handle("bg:size", (_e, file) => backgroundSize(str(file, "file")));

  handle("social:status", () => social.status());
  handle("social:join", (_e, name) => social.join(str(name, "name").slice(0, 32)));
  handle("social:profile", (_e, patch) => {
    const p = (typeof patch === "object" && patch !== null ? patch : bad("patch")) as Record<string, unknown>;
    return social.updateProfile({ ...(p.name !== undefined ? { name: str(p.name, "name").slice(0, 32) } : {}), ...(p.shareNow !== undefined ? { shareNow: p.shareNow === true } : {}) });
  });
  handle("social:leave", () => social.leave());
  handle("social:inviteLink", () => {
    const code = social.myCode();
    return code && social.serverBase() ? `${social.serverBase()}/v1/invite/${code}` : "";
  });
  handle("social:friends", () => social.getFriends());
  handle("social:addFriend", (_e, code) => social.friendAction("add", str(code, "code").slice(0, 16)));
  handle("social:accept", (_e, code) => social.friendAction("accept", str(code, "code").slice(0, 16)));
  handle("social:removeFriend", (_e, code) => social.friendAction("remove", str(code, "code").slice(0, 16)));
  handle("social:send", (_e, codes, track) => social.sendTrack(Array.isArray(codes) ? codes.slice(0, 20).map((c) => str(c, "code").slice(0, 16)) : bad("codes"), socialTrack(track)));
  handle("social:sendPlaylist", async (_e, codes, p) => {
    const to = Array.isArray(codes) ? codes.slice(0, 20).map((c) => str(c, "code").slice(0, 16)) : bad("codes");
    const list = localPlaylist(localId(p));
    const ids = localIds(list.id).slice(0, MAX_TRACKS);
    // the first track SoundCloud still has stands in for the playlist in older apps
    const [first] = await data.getTracks(ids.slice(0, 20));
    if (!first) return bad("playlist");
    const track = socialTrack(first);
    const playlist = { title: list.title, ids };
    return { ids: await social.sendTrack(to, track, playlist), track, playlist };
  });
  handle("social:chat", (_e, code, before) => social.chat(str(code, "code").slice(0, 16), before === undefined ? undefined : id(before)));
  handle("social:seen", (_e, code) => social.seen(str(code, "code").slice(0, 16)));
  handle("social:state", (_e, m, state) => social.setState(id(m), state === "heard" || state === "liked" || state === "queued" || state === "saved" ? state : bad("state")));
  handle("social:now", (_e, track) => social.now(track === null ? null : socialTrack(track)));
  handle("social:poll", () => social.poll());
  handle("social:listened", (_e, t) => social.listened(id(t)));
  handle("social:listening", () => social.listening());
  handle("room:state", () => rooms.roomState());
  handle("room:create", (_e, o) => {
    const v = (typeof o === "object" && o !== null ? o : bad("room")) as Record<string, unknown>;
    return rooms.createRoom({
      startTogether: v.startTogether === true,
      invite: Array.isArray(v.invite) ? v.invite.slice(0, 20).map((c) => str(c, "code").slice(0, 16)) : [],
      track: v.track ? socialTrack(v.track) : null,
      position: typeof v.position === "number" && Number.isFinite(v.position) ? Math.max(0, v.position) : 0,
      playing: v.playing !== false,
    });
  });
  handle("room:invite", (_e, codes) => rooms.invite(Array.isArray(codes) ? codes.slice(0, 20).map((c) => str(c, "code").slice(0, 16)) : bad("codes")));
  handle("room:join", (_e, id) => rooms.joinRoom(typeof id === "string" && /^[\w-]{8}$/.test(id) ? id : bad("room id")));
  handle("room:leave", () => rooms.leaveRoom());
  handle("room:do", (_e, op) => rooms.act(roomOp(op)));
  handle("room:history", () => rooms.history());
  handle("social:recent", () => social.recent());
  handle("ws:list", (_e, sort, page, q, mine) => social.wsList(sort === "top" ? "top" : "new", typeof page === "number" && page >= 0 && page < 1000 ? Math.floor(page) : 0, str(q ?? "", "query").slice(0, 40), mine === true));
  handle("ws:get", (_e, t) => social.wsGet(themeId(t)));
  handle("ws:capture", () => social.wsCapture());
  handle("ws:publish", (_e, t) => {
    const o = (typeof t === "object" && t !== null ? t : bad("theme")) as Record<string, unknown>;
    const video = o.video === undefined ? undefined : o.video instanceof Uint8Array && o.video.length > 0 && o.video.length <= 25 * 1024 * 1024 ? o.video : bad("video");
    return social.wsPublish({ name: str(o.name, "name").slice(0, 40), description: str(o.description ?? "", "description").slice(0, 300), withBackground: o.withBackground === true, video });
  });
  handle("ws:install", (_e, t) => social.wsInstall(themeId(t)));
  handle("ws:like", (_e, t) => social.wsLike(themeId(t)));
  handle("ws:report", (_e, t, reason) => social.wsReport(themeId(t), str(reason ?? "", "reason").slice(0, 300)));
  handle("ws:delete", (_e, t, moderator) => social.wsDelete(themeId(t), moderator === true));
  handle("ws:moderator", () => social.isModerator());
  handle("ws:setModerator", (_e, key) => social.setModerator(key === null ? null : str(key, "key").trim().slice(0, 200) || null));
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
  handle("app:info", () => ({ version: app.getVersion(), portable: !!process.env.PORTABLE_EXECUTABLE_DIR, packaged: app.isPackaged, logsDir: logsDir(), builtinProxy: hasBuiltinProxy(), proxyRoute: proxyRoute() }));
  handle("log:write", (_e, message) => log("page", str(message, "message")));
  handle("diag:openLogs", async () => {
    await shell.openPath(logsDir());
  });
  handle("diag:netcheck", () => netCheck());
  /**
   * "Report a problem": what the app knows that helps (version, Windows, a few settings, the end of the log) in a file
   * the person saves and attaches; then the page to write on opens. Nothing secret: no tokens, codes or names — only
   * whether one is signed in — and anything token-like in the log is blanked.
   */
  handle("diag:report", async () => {
    const p = prefs();
    const read = async (name: string) => (await readFile(join(logsDir(), name), "utf8").catch(() => "")).split(/\r?\n/);
    const lines = [...(await read("main.old.log")), ...(await read("main.log"))].filter(Boolean).slice(-400);
    const version = app.getVersion();
    const text = [
      `sc player ${version}${app.isPackaged ? "" : " (development)"}${process.env.PORTABLE_EXECUTABLE_DIR ? " portable" : ""}`,
      `Windows ${release()}`,
      `signed in to SoundCloud: ${signedIn() ? "yes" : "no"}; messenger: ${social.myCode() ? "yes" : "no"}`,
      `proxy: ${p.proxy.mode}${proxyRoute() ? ` (${proxyRoute()})` : ""}; stream quality: ${p.streamQuality}; lyrics auto-sync: ${p.autoSyncLyrics ? "on" : "off"}`,
      "",
      "--- the end of the log ---",
      ...lines.map((l) => l.replace(/[A-Za-z0-9_-]{24,}/g, "…")),
    ].join("\n");
    const date = new Date().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog(...((main ? [main] : []) as [BrowserWindow]), {
      defaultPath: join(app.getPath("documents"), `sc player report ${date}.txt`),
      filters: [{ name: "Text", extensions: ["txt"] }],
    });
    if (r.canceled || !r.filePath) return false;
    await writeFile(r.filePath, text, "utf8");
    shell.showItemInFolder(r.filePath);
    const body = `sc player ${version}, Windows ${release()}\n\nWhat happened:\n\n\nWhat I expected:\n\n\n(The report file ${r.filePath.split(/[\\/]/).pop()} is attached.)`;
    void shell.openExternal(`https://github.com/waterlilo/sc-player/issues/new?title=${encodeURIComponent("Problem: ")}&body=${encodeURIComponent(body)}`);
    return true;
  });
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
  // more than 15 minutes since "Sign in with your browser", or the app was started by the link: asked first, so
  // another page can't sign the app into someone else's account
  if (!waitingForBrowser()) {
    const ask: Electron.MessageBoxOptions = {
      type: "question",
      buttons: ["Sign in", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      message: "Sign in with the SoundCloud account from your browser?",
      detail: "A sign-in link came from your browser. Go on only if you just clicked the “sc player sign-in” bookmark.",
    };
    const { response } = await (main ? dialog.showMessageBox(main, ask) : dialog.showMessageBox(ask));
    if (response !== 0) {
      log("main", "login: browser link turned down");
      return;
    }
  }
  auth.useToken(token);
  provider.reset();
  const status = await authStatus();
  // a refused token is forgotten by authStatus: the app stays signed out and keeps waiting for another try
  if (status.mode === "session") {
    // the link stays registered: next time the bookmark alone signs in (after the question above)
    finishBrowserSignIn();
    log("main", "login: signed in through the browser");
  } else {
    log("main", "login: browser token refused");
    send(main, "auth:browserRefused", null);
  }
  send(main, "auth:changed", status);
}

/** A friend's link (scplayer://friend/SKY-XXXXX): the page opens the Inbox and asks before adding them. */
function friendLink(argv: string[]) {
  const code = friendFromArgs(argv);
  if (code) send(main, "social:friendLink", code);
}

app.on("second-instance", (_e, argv) => {
  showWindow(main);
  void signInFromBrowser(argv);
  friendLink(argv);
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  quitting = true;
  store().flush();
  flushAlternatives();
  flushLyrics();
  flushLyricsSync();
  flushLocalPlaylists();
});
process.on("uncaughtException", (err) => log("main", `uncaught: ${err.stack ?? err.message}`));

/**
 * Started with an encryption key other than the one on disk (seen right after an update, while the old copy was still
 * closing): nothing saved opens, so the friend code and the sign-in look gone. One restart reads the key again. Tried
 * once for the same values, so a key that is really gone (another Windows user) doesn't restart the app every time.
 */
function restartForKey(): boolean {
  const bad = unopenedSecrets();
  if (!bad.length) return false;
  const mark = join(app.getPath("userData"), "key-restart");
  const tried = createHash("sha1").update(bad.join("|")).digest("hex");
  let last = "";
  try {
    last = readFileSync(mark, "utf8");
  } catch {
    /* never restarted */
  }
  if (last === tried) {
    log("main", `${bad.length} saved secret(s) can't be opened, even after a restart`);
    return false;
  }
  writeFileSync(mark, tried);
  log("main", `${bad.length} saved secret(s) can't be opened: restarting once to read the key again`);
  app.relaunch({ args: process.argv.slice(1).filter((a) => a !== "--updated") });
  app.exit(0);
  return true;
}

void app.whenReady().then(async () => {
  if (restartForKey()) return;
  scSession().setUserAgent(chromeUserAgent());
  initProxyAuth(() => prefs().proxy.username);
  initProxyAuto();
  await applyProxy(prefs().proxy);
  allowAudioCors();
  serveBackgrounds();
  // backgrounds left over from a change while the old one was still playing
  dropBackgrounds(prefs().look.bgFile);
  registerIpc();
  await auth.restore();
  const p = prefs();
  main = createMainWindow({ startHidden: startedHidden() && p.startMinimized, closeToTray: () => prefs().closeToTray, quitting: () => quitting });
  onSyncStatus((s) => send(main, "lyricsSync:status", s));
  main.on("closed", () => (main = null));
  // started by the browser sign-in's link (the app wasn't running)
  main.webContents.once("did-finish-load", () => {
    void signInFromBrowser(process.argv);
    friendLink(process.argv);
  });
  // links open the installed app (in development they would point at this checkout)
  if (app.isPackaged) registerLinks();
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
  rooms.initRooms(() => main);
  // back in front: the messenger catches up at once
  main.on("focus", () => void social.poll());
});
