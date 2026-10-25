import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { app, nativeImage, net, Notification, type BrowserWindow } from "electron";
import type { Look } from "@shared/ipc";
import type { Friends, Message, RoomInvite, SocialProfile, SocialStatus, SocialTrack, SocialUpdate, ThemeLook, WsPage, WsSort, WsThemeFull } from "@shared/social";
import { ScError } from "./soundcloud";
import { prefs } from "./store";
import { getSecret, setSecret } from "./store/secrets";
import { readBackground, saveBackground } from "./system/background";
import { log } from "./system/log";
import { appIcon, showWindow } from "./system/tray";
import { send } from "./windows/main-window";

/**
 * sc player's own server (server/README.md): the messenger, the workshop, the user count. The address comes with the
 * build (server.local.json); in development SC_API may point at a local one. The device's secret is kept encrypted;
 * the page never sees it or the server's address beyond picture links.
 */
const BASE = (!app.isPackaged && process.env.SC_API?.replace(/\/$/, "")) || __SC_API__;

let win: () => BrowserWindow | null = () => null;
let profile: SocialProfile | null = null;
let friends: Friends | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

// ---- small local state: where the last poll stopped, the install id for the count -------------------------------

interface Local {
  since: number;
  v: number;
  install: string;
  pinged: string;
}
const localPath = () => joinPath(app.getPath("userData"), "social.json");
let local: Local | null = null;

function loc(): Local {
  if (local) return local;
  try {
    local = { since: 0, v: -1, install: "", pinged: "", ...(JSON.parse(readFileSync(localPath(), "utf8")) as Partial<Local>) };
  } catch {
    local = { since: 0, v: -1, install: "", pinged: "" };
  }
  if (!local.install) {
    local.install = randomUUID();
    saveLocal();
  }
  return local;
}
function saveLocal() {
  try {
    writeFileSync(localPath(), JSON.stringify(local));
  } catch {
    /* next time */
  }
}

// ---- requests -----------------------------------------------------------------------------------------------------

export async function api<T>(method: string, path: string, opts: { body?: unknown; raw?: Buffer; auth?: boolean; timeout?: number } = {}): Promise<T> {
  if (!BASE) throw new ScError("unavailable", "no server in this build");
  // what this app can do: the server sends room invitations only to apps that can join
  const headers: Record<string, string> = { "user-agent": `scplayer/${app.getVersion()}`, "x-sc-features": "rooms" };
  const secret = getSecret("socialSecret");
  if (opts.auth !== false && secret) headers.authorization = `Bearer ${secret}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await net.fetch(BASE + path, {
      method,
      headers,
      body: opts.raw ? new Uint8Array(opts.raw) : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeout ?? 15_000),
    });
  } catch {
    throw new ScError("offline", "sc player's server didn't answer");
  }
  const text = await res.text();
  const data = text && res.headers.get("content-type")?.includes("json") ? (JSON.parse(text) as unknown) : null;
  if (res.ok) return data as T;
  const message = (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
  if (res.status === 401 && secret) {
    // the server doesn't know this device (its data was reset, or the profile was deleted elsewhere)
    setSecret("socialSecret", null);
    profile = null;
  }
  throw new ScError(res.status === 401 ? "unauthorized" : res.status === 429 ? "rate_limited" : res.status === 404 ? "not_found" : "unknown", message);
}

export const joined = () => !!BASE && !!getSecret("socialSecret");
/** the server's address and the device's secret, for a room's event stream (main/rooms.ts) */
export const serverBase = () => BASE;
export const myCode = () => profile?.code ?? "";
export const friendName = (code: string) => friends?.friends.find((f) => f.code === code)?.name || code;
const needProfile = () => {
  if (!joined()) throw new ScError("unauthorized", "no profile yet");
};

// ---- the messenger ------------------------------------------------------------------------------------------------

export async function status(): Promise<SocialStatus> {
  if (!BASE) return { available: false, profile: null };
  if (joined() && !profile) {
    try {
      profile = await api<SocialProfile>("GET", "/v1/me");
    } catch (e) {
      // offline: show what we know (the code is in the secret's profile cache next time)
      if (!(e instanceof ScError) || e.code !== "unauthorized") throw e;
    }
  }
  return { available: true, profile };
}

export async function join(name: string): Promise<SocialStatus> {
  if (joined()) return status();
  const r = await api<{ code: string; secret: string; name: string }>("POST", "/v1/register", { body: { name }, auth: false });
  setSecret("socialSecret", r.secret);
  profile = { code: r.code, name: r.name, shareNow: false };
  Object.assign(loc(), { since: 0, v: -1 });
  saveLocal();
  startPolling();
  return { available: true, profile };
}

export async function updateProfile(patch: { name?: string; shareNow?: boolean }): Promise<SocialStatus> {
  needProfile();
  profile = await api<SocialProfile>("PUT", "/v1/me", { body: patch });
  return { available: true, profile };
}

export async function leave(): Promise<SocialStatus> {
  if (joined()) await api("DELETE", "/v1/me");
  setSecret("socialSecret", null);
  profile = null;
  friends = null;
  Object.assign(loc(), { since: 0, v: -1 });
  saveLocal();
  return { available: !!BASE, profile: null };
}

export async function getFriends(): Promise<Friends> {
  needProfile();
  return (friends = await api<Friends>("GET", "/v1/friends"));
}

export async function friendAction(kind: "add" | "accept" | "remove", code: string): Promise<Friends> {
  needProfile();
  const c = encodeURIComponent(code.trim());
  friends =
    kind === "add"
      ? await api<Friends>("POST", "/v1/friends", { body: { code } })
      : kind === "accept"
        ? await api<Friends>("POST", `/v1/friends/${c}/accept`)
        : await api<Friends>("DELETE", `/v1/friends/${c}`);
  return friends;
}

export async function sendTrack(codes: string[], track: SocialTrack): Promise<number[]> {
  needProfile();
  return (await api<{ ids: number[] }>("POST", "/v1/send", { body: { to: codes, track } })).ids;
}

export async function chat(code: string, before?: number): Promise<Message[]> {
  needProfile();
  const r = await api<{ messages: Message[] }>("GET", `/v1/chat/${encodeURIComponent(code)}${before ? `?before=${before}` : ""}`);
  return r.messages;
}

export async function recent(): Promise<Message[]> {
  if (!joined()) return [];
  return (await api<{ messages: Message[] }>("GET", "/v1/recent")).messages;
}

export async function seen(code: string) {
  needProfile();
  await api("POST", `/v1/chat/${encodeURIComponent(code)}/seen`);
}

export async function setState(id: number, state: "heard" | "liked" | "queued") {
  needProfile();
  await api("POST", `/v1/messages/${id}/state`, { body: { state } });
}

let lastNow = "";
export async function now(track: SocialTrack | null) {
  if (!joined() || !profile?.shareNow) return;
  const key = track ? String(track.id) : "";
  if (key === lastNow) return;
  lastNow = key;
  await api("PUT", "/v1/me/now", { body: { track } }).catch(() => undefined);
}

// ---- polling and pop-ups ------------------------------------------------------------------------------------------

let polling = false;

export async function poll() {
  if (!joined() || polling) return;
  polling = true;
  try {
    const s = loc();
    const first = s.v === -1;
    const u = await api<SocialUpdate>("GET", `/v1/updates?since=${s.since}&v=${s.v}`);
    if (u.friends) {
      friends = u.friends;
      s.v = u.friends.v;
    }
    if (u.messages.length) {
      s.since = Math.max(s.since, ...u.messages.map((m) => m.id));
      // the very first poll after joining or reinstalling only catches up, without pop-ups
      if (!first) void popups(u.messages);
    }
    for (const inv of u.invites ?? []) {
      if (shownInvites.has(`${inv.room}:${inv.at}`)) continue;
      shownInvites.add(`${inv.room}:${inv.at}`);
      if (!first) invitePopup(inv);
    }
    saveLocal();
    send(win(), "social:update", u);
  } catch (e) {
    if (!(e instanceof ScError) || e.code !== "offline") log("main", `social poll: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    polling = false;
  }
}

async function popups(messages: Message[]) {
  const w = win();
  if (!prefs().socialPopups || !Notification.isSupported() || (w?.isVisible() && w.isFocused())) return;
  const byFriend = new Map<string, Message[]>();
  for (const m of messages) if (m.from) byFriend.set(m.from, [...(byFriend.get(m.from) ?? []), m]);
  for (const [code, list] of byFriend) {
    const who = friends?.friends.find((f) => f.code === code)?.name || code;
    const first = list[0]!.track;
    let icon = appIcon();
    if (first.artworkUrl && /^https:\/\/[a-z0-9.-]+\.sndcdn\.com\//.test(first.artworkUrl)) {
      try {
        const r = await net.fetch(first.artworkUrl.replace(/-(large|t\d+x\d+)\./, "-t300x300."), { signal: AbortSignal.timeout(4000) });
        if (r.ok) icon = nativeImage.createFromBuffer(Buffer.from(await r.arrayBuffer()));
      } catch {
        /* the app icon then */
      }
    }
    const n = new Notification({
      title: list.length > 1 ? `${who} sent you ${list.length} tracks` : `${who} sent you a track`,
      body: `${first.title} — ${first.artist}`,
      icon,
      silent: false,
    });
    n.on("click", () => {
      showWindow(win());
      send(win(), "social:open", code);
    });
    n.show();
  }
}

/** invitations already announced (this run): each pops up once */
const shownInvites = new Set<string>();

function invitePopup(inv: RoomInvite) {
  const w = win();
  if (!prefs().socialPopups || !Notification.isSupported() || (w?.isVisible() && w.isFocused())) return;
  const n = new Notification({
    title: `${inv.name || inv.by} invites you to listen together`,
    body: inv.track ? `Now: ${inv.track.title} — ${inv.track.artist}` : "Open sc player to join",
    icon: appIcon(),
  });
  n.on("click", () => {
    showWindow(win());
    send(win(), "social:open", inv.by);
  });
  n.show();
}

// ---- what sc player is playing --------------------------------------------------------------------------------------

/** A track played for a while: its id to the server, anonymously (no device secret goes with it). */
export async function listened(trackId: number) {
  if (!BASE || !prefs().shareListening) return;
  await api("POST", "/v1/listening", { body: { id: trackId }, auth: false }).catch(() => undefined);
}

export async function listening(): Promise<{ id: number; at: number; plays: number }[]> {
  if (!BASE) return [];
  return (await api<{ tracks: { id: number; at: number; plays: number }[] }>("GET", "/v1/listening", { auth: false })).tracks;
}

/** Polls a little sooner when something is expected (an invitation just sent, a room just left). */
export function pollSoon() {
  setTimeout(() => void poll(), 1500);
}

function startPolling() {
  if (timer || !joined()) return;
  timer = setInterval(() => void poll(), 20_000);
  void poll();
}

// ---- the anonymous count ------------------------------------------------------------------------------------------

async function ping() {
  if (!BASE || !prefs().countMe) return;
  const s = loc();
  const today = new Date().toISOString().slice(0, 10);
  if (s.pinged === today) return;
  try {
    await api("POST", "/v1/ping", { body: { install: s.install, version: app.getVersion() }, auth: false });
    s.pinged = today;
    saveLocal();
  } catch {
    /* tomorrow, or on the next start */
  }
}

// ---- the workshop -------------------------------------------------------------------------------------------------

const withPreview = <T extends { id: string }>(t: T) => ({ ...t, previewUrl: `${BASE}/v1/themes/${t.id}/preview` });

export async function wsList(sort: WsSort, page: number, q: string, mine: boolean): Promise<WsPage> {
  const qs = new URLSearchParams({ sort, page: String(page), q, ...(mine ? { mine: "1" } : {}) });
  const r = await api<WsPage>("GET", `/v1/themes?${qs}`);
  return { ...r, themes: r.themes.map(withPreview) };
}

export async function wsGet(id: string): Promise<WsThemeFull> {
  return withPreview(await api<WsThemeFull>("GET", `/v1/themes/${encodeURIComponent(id)}`));
}

function themeLook(l: Look): ThemeLook {
  return { design: l.design, bg: l.bg, bgBlur: l.bgBlur, bgDim: l.bgDim, bgReact: l.bgReact, panelOpacity: l.panelOpacity, panelBlur: l.panelBlur, accent: l.accent, surface: l.surface };
}

/** Publish the current look: the theme, its background (optional), then a picture of the window as its preview. */
export async function wsPublish(t: { name: string; description: string; withBackground: boolean }): Promise<string> {
  needProfile();
  const look = prefs().look;
  const bg = t.withBackground && look.bg === "file" ? readBackground(look.bgFile) : null;
  if (bg && bg.data.length > 25 * 1024 * 1024) throw new ScError("unknown", "The background is too big for the workshop (25 MB at most)");
  const w = win();
  if (!w) throw new ScError("unknown", "no window");
  const shot = await w.webContents.capturePage();
  const preview = shot.resize({ width: Math.min(1200, shot.getSize().width) }).toJPEG(84);
  const { id } = await api<{ id: string }>("POST", "/v1/themes", { body: { name: t.name, description: t.description, look: { ...themeLook(look), bg: look.bg === "file" && !bg ? "liquid" : look.bg }, css: "" } });
  if (bg) await api("PUT", `/v1/themes/${id}/background`, { raw: bg.data, timeout: 120_000 });
  await api("PUT", `/v1/themes/${id}/preview`, { raw: preview, timeout: 60_000 });
  return id;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm" };

/** Download a theme and its background; the look to apply (the machine's own "lite" stays). */
export async function wsInstall(id: string): Promise<Look> {
  const t = await wsGet(id);
  const current = prefs().look;
  let file = { bgFile: current.bgFile, bgFileType: current.bgFileType };
  let bg = t.look.bg;
  if (t.background && EXT[t.background]) {
    const res = await net.fetch(`${BASE}/v1/themes/${encodeURIComponent(id)}/background`, { signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new ScError("unknown", "The theme's background didn't download");
    const saved = saveBackground(Buffer.from(await res.arrayBuffer()), EXT[t.background]!);
    file = { bgFile: saved.file, bgFileType: saved.type };
  } else if (bg === "file") bg = "liquid";
  if (joined()) void api("POST", `/v1/themes/${encodeURIComponent(id)}/install`).catch(() => undefined);
  return { ...current, ...t.look, surface: t.look.surface ?? "", bg, ...file, lite: current.lite };
}

export async function wsLike(id: string) {
  needProfile();
  const r = await api<{ likes: number; liked: boolean }>("POST", `/v1/themes/${encodeURIComponent(id)}/like`);
  return { likes: r.likes, liked: r.liked };
}

export async function wsReport(id: string, reason: string) {
  needProfile();
  await api("POST", `/v1/themes/${encodeURIComponent(id)}/report`, { body: { reason } });
}

export async function wsDelete(id: string) {
  needProfile();
  await api("DELETE", `/v1/themes/${encodeURIComponent(id)}`);
}

// ---- start --------------------------------------------------------------------------------------------------------

export function initSocial(getWindow: () => BrowserWindow | null) {
  win = getWindow;
  if (!BASE) return;
  startPolling();
  setTimeout(() => void ping(), 30_000);
  setInterval(() => void ping(), 6 * 60 * 60_000);
}
