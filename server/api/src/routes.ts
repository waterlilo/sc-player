import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { createReadStream, statSync, unlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { all, DATA, one, run, tx, type Row } from "./db.ts";
import { fail, HttpError, int, limit, readBody, readJson, send, text, url } from "./http.ts";
import { roomRoutes, rooms } from "./room-routes.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  ip: string;
  params: string[];
  query: URLSearchParams;
}

// ---- devices ------------------------------------------------------------------------------------------------------

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O, 1/I

function newCode() {
  for (;;) {
    let c = "SKY-";
    for (let i = 0; i < 5; i++) c += CODE_CHARS[randomInt(CODE_CHARS.length)];
    if (!one("SELECT 1 FROM devices WHERE code = ?", c)) return c;
  }
}

const normCode = (v: unknown) => {
  const s = text(v, 16, "code").toUpperCase().replace(/\s+/g, "");
  const c = s.startsWith("SKY-") ? s : `SKY-${s}`;
  if (!/^SKY-[2-9A-HJ-NP-Z]{5}$/.test(c)) fail(400, "bad code");
  return c;
};

/** The device making the request (Authorization: Bearer <secret>); 401 without a known one. */
function me(c: Ctx): Row {
  const auth = String(c.req.headers.authorization ?? "");
  const secret = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (secret.length < 20 || secret.length > 100) return fail(401, "who are you");
  const d = one("SELECT * FROM devices WHERE secret = ?", sha(secret));
  if (!d) return fail(401, "who are you");
  if (Date.now() - Number(d.seen) > MIN) run("UPDATE devices SET seen = ? WHERE id = ?", Date.now(), d.id);
  // what this app can do (an update may add to it): only words from a short list are kept
  const features = String(c.req.headers["x-sc-features"] ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f === "rooms")
    .join(",");
  if (features !== d.features) {
    run("UPDATE devices SET features = ? WHERE id = ?", features, d.id);
    d.features = features;
  }
  limit(`dev:${d.id}`, 600, MIN);
  return d;
}

function deviceByCode(code: string) {
  return one("SELECT * FROM devices WHERE code = ?", code) ?? fail(404, "no one has this code");
}

const pair = (x: number, y: number): [number, number] => (x < y ? [x, y] : [y, x]);
const bump = (...ids: number[]) => ids.forEach((id) => run("UPDATE devices SET friends_v = friends_v + 1 WHERE id = ?", id));

/** The track a message carries: only what is needed to show and open it, from SoundCloud only. */
function track(v: unknown) {
  if (!v || typeof v !== "object") return fail(400, "track missing");
  const t = v as Record<string, unknown>;
  return {
    id: int(t.id, 1, Number.MAX_SAFE_INTEGER, "track.id"),
    title: text(t.title, 300, "track.title"),
    artist: text(t.artist, 200, "track.artist"),
    artworkUrl: url(t.artworkUrl, /(^|\.)sndcdn\.com$/, "track.artworkUrl"),
    permalinkUrl: url(t.permalinkUrl, /^(www\.|m\.)?soundcloud\.com$/, "track.permalinkUrl") ?? fail(400, "track.permalinkUrl missing"),
    durationMs: int(t.durationMs, 0, 24 * HOUR, "track.durationMs"),
  };
}

async function register(c: Ctx) {
  limit(`reg:${c.ip}`, 5, HOUR);
  const body = await readJson(c.req);
  const name = text(body.name, 32, "name", false);
  const secret = randomBytes(32).toString("base64url");
  const code = newCode();
  const now = Date.now();
  run("INSERT INTO devices (code, secret, name, created, seen) VALUES (?, ?, ?, ?, ?)", code, sha(secret), name, now, now);
  send(c.res, 201, { code, secret, name });
}

function getMe(c: Ctx) {
  const d = me(c);
  send(c.res, 200, { code: d.code, name: d.name, shareNow: !!d.share_now });
}

async function putMe(c: Ctx) {
  const d = me(c);
  const body = await readJson(c.req);
  if (body.name !== undefined) run("UPDATE devices SET name = ? WHERE id = ?", text(body.name, 32, "name", false), d.id);
  if (body.shareNow !== undefined) {
    const on = body.shareNow === true;
    run("UPDATE devices SET share_now = ?, now_track = CASE WHEN ? THEN now_track ELSE NULL END WHERE id = ?", on ? 1 : 0, on ? 1 : 0, d.id);
  }
  if (body.name !== undefined) bumpFriendsOf(Number(d.id));
  getMe(c);
}

async function putNow(c: Ctx) {
  const d = me(c);
  limit(`now:${d.id}`, 30, MIN);
  const body = await readJson(c.req);
  if (!d.share_now) return send(c.res, 204, null);
  const t = body.track ? JSON.stringify(track(body.track)) : null;
  run("UPDATE devices SET now_track = ?, now_at = ? WHERE id = ?", t, Date.now(), d.id);
  send(c.res, 204, null);
}

/** Forget this device and everything it sent or shared. */
function deleteMe(c: Ctx) {
  const d = me(c);
  const room = rooms.roomOf(Number(d.id));
  if (room) rooms.leave(room.id, Number(d.id));
  for (const t of all("SELECT id FROM themes WHERE author = ?", d.id)) removeThemeFiles(String(t.id));
  const friends = all("SELECT a, b FROM friends WHERE a = ? OR b = ?", d.id, d.id).map((f) => (f.a === d.id ? Number(f.b) : Number(f.a)));
  run("DELETE FROM devices WHERE id = ?", d.id);
  bump(...friends);
  send(c.res, 204, null);
}

// ---- friends ------------------------------------------------------------------------------------------------------

function bumpFriendsOf(id: number) {
  bump(...all("SELECT a, b FROM friends WHERE a = ? OR b = ?", id, id).map((f) => (f.a === id ? Number(f.b) : Number(f.a))));
}

const LIVE_MS = 10 * MIN;

function friendsOf(d: Row) {
  const rows = all(
    `SELECT f.asked_by, f.accepted, f.created, o.id, o.code, o.name, o.share_now, o.now_track, o.now_at, o.features
       FROM friends f JOIN devices o ON o.id = CASE WHEN f.a = ? THEN f.b ELSE f.a END
      WHERE f.a = ? OR f.b = ? ORDER BY o.name COLLATE NOCASE`,
    d.id,
    d.id,
    d.id,
  );
  const live = (r: Row) => (r.share_now && r.now_track && Date.now() - Number(r.now_at) < LIVE_MS ? JSON.parse(String(r.now_track)) : null);
  return {
    v: Number(d.friends_v),
    friends: rows.filter((r) => r.accepted).map((r) => ({ code: r.code, name: r.name, since: r.created, now: live(r), rooms: String(r.features).split(",").includes("rooms") })),
    incoming: rows.filter((r) => !r.accepted && r.asked_by !== d.id).map((r) => ({ code: r.code, name: r.name, at: r.created })),
    outgoing: rows.filter((r) => !r.accepted && r.asked_by === d.id).map((r) => ({ code: r.code, name: r.name, at: r.created })),
  };
}

function getFriends(c: Ctx) {
  send(c.res, 200, friendsOf(me(c)));
}

/** Add by code: a request, or — if they already asked — friends at once. */
async function addFriend(c: Ctx) {
  const d = me(c);
  limit(`add:${d.id}`, 30, HOUR);
  const body = await readJson(c.req);
  const other = deviceByCode(normCode(body.code));
  if (other.id === d.id) fail(400, "that is your own code");
  const [a, b] = pair(Number(d.id), Number(other.id));
  const f = one("SELECT * FROM friends WHERE a = ? AND b = ?", a, b);
  if (!f) {
    const pending = one("SELECT COUNT(*) n FROM friends WHERE asked_by = ? AND accepted = 0", d.id);
    if (Number(pending?.n) >= 50) fail(429, "too many open requests");
    run("INSERT INTO friends (a, b, asked_by, created) VALUES (?, ?, ?, ?)", a, b, d.id, Date.now());
  } else if (!f.accepted && f.asked_by !== d.id) run("UPDATE friends SET accepted = 1 WHERE a = ? AND b = ?", a, b);
  bump(Number(d.id), Number(other.id));
  send(c.res, 200, friendsOf(one("SELECT * FROM devices WHERE id = ?", d.id)!));
}

function acceptFriend(c: Ctx) {
  const d = me(c);
  const other = deviceByCode(normCode(c.params[0]));
  const [a, b] = pair(Number(d.id), Number(other.id));
  const r = run("UPDATE friends SET accepted = 1 WHERE a = ? AND b = ? AND asked_by = ?", a, b, other.id);
  if (!r.changes) fail(404, "no such request");
  bump(Number(d.id), Number(other.id));
  send(c.res, 200, friendsOf(one("SELECT * FROM devices WHERE id = ?", d.id)!));
}

/** Decline, cancel or unfriend; the messages between the two go too. */
function removeFriend(c: Ctx) {
  const d = me(c);
  const other = deviceByCode(normCode(c.params[0]));
  const [a, b] = pair(Number(d.id), Number(other.id));
  tx(() => {
    run("DELETE FROM friends WHERE a = ? AND b = ?", a, b);
    run("DELETE FROM messages WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)", d.id, other.id, other.id, d.id);
  });
  bump(Number(d.id), Number(other.id));
  send(c.res, 200, friendsOf(one("SELECT * FROM devices WHERE id = ?", d.id)!));
}

function friendOrFail(d: Row, code: string) {
  const other = deviceByCode(code);
  const [a, b] = pair(Number(d.id), Number(other.id));
  if (!one("SELECT 1 FROM friends WHERE a = ? AND b = ? AND accepted = 1", a, b)) fail(403, `not friends with ${code}`);
  return other;
}

// ---- messages -----------------------------------------------------------------------------------------------------

const msgOut = (m: Row, mine: boolean, code?: string) => ({
  id: m.id,
  ...(code ? { from: code } : {}),
  mine,
  track: JSON.parse(String(m.track)),
  sent: m.sent,
  seen: !!m.seen,
  state: m.state,
});

async function sendTrack(c: Ctx) {
  const d = me(c);
  const body = await readJson(c.req);
  if (!Array.isArray(body.to) || !body.to.length || body.to.length > 20) fail(400, "to: 1..20 friend codes");
  const to = [...new Set((body.to as unknown[]).map(normCode))].map((code) => friendOrFail(d, code));
  limit(`send:${d.id}`, 200, HOUR);
  const t = JSON.stringify(track(body.track));
  const now = Date.now();
  const ids = tx(() => to.map((o) => Number(run("INSERT INTO messages (sender, recipient, track, sent) VALUES (?, ?, ?, ?)", d.id, o.id, t, now).lastInsertRowid)));
  send(c.res, 201, { ids });
}

/**
 * What changed since the last poll: new tracks sent to me (after message id `since`), unread counts per friend, what
 * friends are playing, and the friend list itself when its version moved past `v`.
 */
function updates(c: Ctx) {
  const d = me(c);
  const since = Math.max(0, Number(c.query.get("since") ?? 0) || 0);
  const v = Number(c.query.get("v") ?? -1);
  const messages = all(
    "SELECT m.*, s.code FROM messages m JOIN devices s ON s.id = m.sender WHERE m.recipient = ? AND m.id > ? ORDER BY m.id LIMIT 200",
    d.id,
    since,
  ).map((m) => msgOut(m, false, String(m.code)));
  const unread = Object.fromEntries(
    all("SELECT s.code, COUNT(*) n FROM messages m JOIN devices s ON s.id = m.sender WHERE m.recipient = ? AND m.seen = 0 GROUP BY s.code", d.id).map((r) => [r.code, r.n]),
  );
  // states my friends set on what I sent (heard / liked / queued) change too: the newest few
  const states = all("SELECT id, state FROM messages WHERE sender = ? AND state != '' ORDER BY id DESC LIMIT 200", d.id);
  const f = friendsOf(d);
  // invitations to listening rooms (a field older apps don't read)
  const names = new Map(f.friends.map((x) => [x.code, x.name]));
  const invites = rooms.invitesFor(Number(d.id)).map((i) => ({ ...i, name: names.get(i.by) ?? "" }));
  send(c.res, 200, {
    messages,
    invites,
    unread,
    states: Object.fromEntries(states.map((s) => [s.id, s.state])),
    now: Object.fromEntries(f.friends.filter((x) => x.now).map((x) => [x.code, x.now])),
    ...(v !== f.v ? { friends: f } : {}),
  });
}

/** The newest tracks friends sent me, across friends (the home screen). */
function recent(c: Ctx) {
  const d = me(c);
  const rows = all("SELECT m.*, s.code FROM messages m JOIN devices s ON s.id = m.sender WHERE m.recipient = ? ORDER BY m.id DESC LIMIT 20", d.id);
  send(c.res, 200, { messages: rows.map((m) => msgOut(m, false, String(m.code))) });
}

function chat(c: Ctx) {
  const d = me(c);
  const other = friendOrFail(d, normCode(c.params[0]));
  const before = Number(c.query.get("before") ?? 0) || Number.MAX_SAFE_INTEGER;
  const rows = all(
    `SELECT * FROM messages WHERE ((sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)) AND id < ?
      ORDER BY id DESC LIMIT 60`,
    d.id,
    other.id,
    other.id,
    d.id,
    before,
  );
  send(c.res, 200, { messages: rows.reverse().map((m) => msgOut(m, m.sender === d.id)) });
}

function chatSeen(c: Ctx) {
  const d = me(c);
  const other = deviceByCode(normCode(c.params[0]));
  run("UPDATE messages SET seen = 1 WHERE recipient = ? AND sender = ? AND seen = 0", d.id, other.id);
  send(c.res, 204, null);
}

async function messageState(c: Ctx) {
  const d = me(c);
  const body = await readJson(c.req);
  const state = String(body.state ?? "");
  if (!["heard", "liked", "queued"].includes(state)) fail(400, "state: heard | liked | queued");
  const r = run("UPDATE messages SET state = ? WHERE id = ? AND recipient = ?", state, Number(c.params[0]), d.id);
  if (!r.changes) fail(404, "no such message");
  send(c.res, 204, null);
}

// ---- what sc player is playing ------------------------------------------------------------------------------------

/**
 * An app played a track for a while (Settings → Messenger → "Share what I play, anonymously", on by default): its
 * SoundCloud id, nothing else — no device, no address kept (the address only meets the rate limit, in memory).
 */
async function listened(c: Ctx) {
  limit(`listen:${c.ip}`, 60, HOUR);
  const body = await readJson(c.req, 256);
  const id = int(body.id, 1, Number.MAX_SAFE_INTEGER, "id");
  const now = Date.now();
  run(
    `INSERT INTO listening (track_id, at, plays) VALUES (?, ?, 1)
     ON CONFLICT(track_id) DO UPDATE SET plays = CASE WHEN at > ? THEN plays + 1 ELSE 1 END, at = excluded.at`,
    id,
    now,
    now - DAY,
  );
  // a week is plenty to keep
  if (Math.random() < 0.01) run("DELETE FROM listening WHERE at < ?", now - 7 * DAY);
  listeningCache = null;
  send(c.res, 204, null);
}

let listeningCache: { at: number; body: unknown } | null = null;

/** The latest tracks played in sc player (the last two days), newest first. */
function listening(c: Ctx) {
  if (!listeningCache || Date.now() - listeningCache.at > 30_000) {
    const rows = all("SELECT track_id, at, plays FROM listening WHERE at > ? ORDER BY at DESC LIMIT 30", Date.now() - 2 * DAY);
    listeningCache = { at: Date.now(), body: { tracks: rows.map((r) => ({ id: r.track_id, at: r.at, plays: r.plays })) } };
  }
  send(c.res, 200, listeningCache.body, { "cache-control": "public, max-age=30" });
}

// ---- the user counter ---------------------------------------------------------------------------------------------

async function ping(c: Ctx) {
  limit(`ping:${c.ip}`, 20, HOUR);
  const body = await readJson(c.req, 1024);
  const install = text(body.install, 64, "install");
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(install)) fail(400, "bad install id");
  const version = text(body.version, 24, "version");
  if (!/^[0-9a-z.+-]+$/i.test(version)) fail(400, "bad version");
  run("INSERT OR REPLACE INTO pings (day, install, version) VALUES (?, ?, ?)", new Date().toISOString().slice(0, 10), install, version);
  send(c.res, 204, null);
}

let statsCache: { at: number; body: unknown } | null = null;

function stats(c: Ctx) {
  if (!statsCache || Date.now() - statsCache.at > 5 * MIN) {
    const day = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
    const count = (from: string) => Number(one("SELECT COUNT(DISTINCT install) n FROM pings WHERE day >= ?", from)?.n ?? 0);
    statsCache = {
      at: Date.now(),
      body: {
        today: count(day(0)),
        week: count(day(6)),
        month: count(day(29)),
        versions: all("SELECT version, COUNT(*) n FROM pings WHERE day = ? GROUP BY version ORDER BY n DESC LIMIT 10", day(0)),
        themes: Number(one("SELECT COUNT(*) n FROM themes WHERE published = 1 AND hidden = 0")?.n ?? 0),
      },
    };
  }
  send(c.res, 200, statsCache.body, { "cache-control": "public, max-age=300" });
}

// ---- the workshop -------------------------------------------------------------------------------------------------

/** The appearance a theme sets: the same knobs as Settings → Appearance (per-machine ones like "lite" left out). */
function look(v: unknown) {
  if (!v || typeof v !== "object") return fail(400, "look missing");
  const l = v as Record<string, unknown>;
  const pick = <T extends string>(x: unknown, ok: readonly T[], field: string): T => (ok.includes(x as T) ? (x as T) : fail(400, `look.${field} bad`));
  const colour = (x: unknown, field: string) => (x === undefined || x === "" ? "" : typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x) ? x : fail(400, `look.${field} bad`));
  return {
    design: pick(l.design, ["studio", "og"] as const, "design"),
    bg: pick(l.bg, ["liquid", "cover", "file", "none"] as const, "bg"),
    bgBlur: int(l.bgBlur, 0, 40, "look.bgBlur"),
    bgDim: int(l.bgDim, 0, 100, "look.bgDim"),
    bgReact: int(l.bgReact, 0, 100, "look.bgReact"),
    panelOpacity: int(l.panelOpacity, 10, 100, "look.panelOpacity"),
    panelBlur: int(l.panelBlur, 0, 60, "look.panelBlur"),
    accent: colour(l.accent, "accent"),
    surface: colour(l.surface, "surface"),
  };
}

/**
 * A theme's own CSS: style only. Nothing that loads from elsewhere or runs code — no url(), @import, @font-face,
 * expressions, bindings, or markup. The app checks it again before using it.
 */
export function checkCss(v: unknown): string {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v !== "string") return fail(400, "css must be text");
  if (v.length > 20_000) fail(400, "css too long (20 000 characters)");
  // read it the way a browser would: comments out, escapes (\70 = p) decoded, so "@im\70ort" is still @import
  const flat = v
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h: string) => {
      const n = parseInt(h, 16);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "?";
    })
    .replace(/\\(.)/g, "$1")
    .toLowerCase();
  const bad = [/url\s*\(/, /@import/, /@font-face/, /@namespace/, /expression\s*\(/, /javascript:/, /behavior\s*:/, /-moz-binding/, /<\/?\s*(style|script)/, /image-set\s*\(/, /src\s*\(/];
  for (const re of bad) if (re.test(flat)) fail(400, `css: ${re.source.replace(/\\s\*|\\/g, "")} is not allowed`);
  return v;
}

const THEME_PAGE = 24;
const themeOut = (t: Row, extra: Record<string, unknown> = {}) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  author: t.author_name ?? "",
  likes: t.likes,
  installs: t.installs,
  created: t.created,
  background: t.bg ? String(t.bg_type) : "",
  ...extra,
});

function optionalMe(c: Ctx): Row | null {
  return c.req.headers.authorization ? me(c) : null;
}

function listThemes(c: Ctx) {
  const d = optionalMe(c);
  const sort = c.query.get("sort") === "top" ? "t.likes DESC, t.created DESC" : "t.created DESC";
  const page = Math.max(0, Math.min(200, Number(c.query.get("page") ?? 0) || 0));
  const mine = c.query.get("mine") === "1" && d;
  const q = (c.query.get("q") ?? "").slice(0, 40).replace(/[%_]/g, "");
  const rows = all(
    `SELECT t.*, a.name author_name FROM themes t JOIN devices a ON a.id = t.author
      WHERE ${mine ? "t.author = ?" : "t.published = 1 AND t.hidden = 0 AND ? = ?"} AND t.name LIKE ?
      ORDER BY ${sort} LIMIT ? OFFSET ?`,
    ...(mine ? [d.id] : [1, 1]),
    `%${q}%`,
    THEME_PAGE + 1,
    page * THEME_PAGE,
  );
  const liked = new Set(d ? all("SELECT theme FROM theme_votes WHERE device = ? AND kind = 'like'", d.id).map((r) => r.theme) : []);
  send(c.res, 200, {
    themes: rows.slice(0, THEME_PAGE).map((t) => themeOut(t, { liked: liked.has(t.id), ...(mine ? { published: !!t.published, hidden: !!t.hidden } : {}) })),
    more: rows.length > THEME_PAGE,
  });
}

function themeRow(id: string) {
  if (!/^[a-zA-Z0-9_-]{10}$/.test(id)) fail(404, "no such theme");
  return one("SELECT t.*, a.name author_name FROM themes t JOIN devices a ON a.id = t.author WHERE t.id = ?", id) ?? fail(404, "no such theme");
}

function getTheme(c: Ctx) {
  const t = themeRow(c.params[0]!);
  const d = optionalMe(c);
  if ((!t.published || t.hidden) && t.author !== d?.id && !isAdmin(c)) fail(404, "no such theme");
  const liked = d ? !!one("SELECT 1 FROM theme_votes WHERE theme = ? AND device = ? AND kind = 'like'", t.id, d.id) : false;
  send(c.res, 200, themeOut(t, { look: JSON.parse(String(t.look)), css: t.css, mine: t.author === d?.id, liked }));
}

async function createTheme(c: Ctx) {
  const d = me(c);
  limit(`theme:${d.id}`, 10, DAY);
  const body = await readJson(c.req, 64 * 1024);
  const id = randomBytes(8).toString("base64url").slice(0, 10);
  run(
    "INSERT INTO themes (id, author, name, description, look, css, created) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id,
    d.id,
    text(body.name, 40, "name"),
    text(body.description, 300, "description", false),
    JSON.stringify(look(body.look)),
    checkCss(body.css),
    Date.now(),
  );
  send(c.res, 201, { id });
}

/** Files the workshop keeps: the type from the first bytes, not from what the client says. */
function sniff(b: Buffer): string | null {
  const hex = b.subarray(0, 12).toString("hex");
  if (hex.startsWith("89504e47")) return "image/png";
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (hex.startsWith("47494638")) return "image/gif";
  if (hex.startsWith("52494646") && b.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (b.subarray(4, 8).toString() === "ftyp") return "video/mp4";
  if (hex.startsWith("1a45dfa3")) return "video/webm";
  return null;
}
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm" };

function ownTheme(c: Ctx) {
  const d = me(c);
  const t = themeRow(c.params[0]!);
  if (t.author !== d.id) fail(403, "not your theme");
  return t;
}

async function putBackground(c: Ctx) {
  const t = ownTheme(c);
  const body = await readBody(c.req, 25 * 1024 * 1024);
  const type = sniff(body) ?? fail(415, "png, jpeg, gif, webp, mp4 or webm only");
  if (t.bg) safeUnlink(String(t.bg));
  const name = `${t.id}-bg-${Date.now().toString(36)}.${EXT[type]}`;
  writeFileSync(join(DATA, "themes", name), body);
  run("UPDATE themes SET bg = ?, bg_type = ? WHERE id = ?", name, type, t.id);
  send(c.res, 204, null);
}

/** The preview is the last step of making a theme: with it the theme shows in the workshop. */
async function putPreview(c: Ctx) {
  const t = ownTheme(c);
  const body = await readBody(c.req, 1.5 * 1024 * 1024);
  const type = sniff(body);
  if (!type?.startsWith("image/") || type === "image/gif") fail(415, "png, jpeg or webp only");
  if (t.preview) safeUnlink(String(t.preview));
  const name = `${t.id}-pv-${Date.now().toString(36)}.${EXT[type!]}`;
  writeFileSync(join(DATA, "themes", name), body);
  run("UPDATE themes SET preview = ?, published = 1 WHERE id = ?", name, t.id);
  send(c.res, 204, null);
}

function themeFile(c: Ctx, which: "bg" | "preview") {
  const t = themeRow(c.params[0]!);
  if (t.hidden && !isAdmin(c)) fail(404, "no such theme");
  const name = String(t[which] ?? "");
  if (!name) fail(404, "none");
  const path = join(DATA, "themes", name);
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    fail(404, "none");
  }
  const type = which === "bg" ? String(t.bg_type) : `image/${name.split(".").pop() === "jpg" ? "jpeg" : name.split(".").pop()}`;
  c.res.writeHead(200, {
    "content-type": type,
    "content-length": String(size),
    // the file name changes with every upload, so the old one can be cached for good
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'",
  });
  createReadStream(path).pipe(c.res);
}

async function vote(c: Ctx, kind: "like" | "install" | "report") {
  const d = me(c);
  limit(`vote:${d.id}`, 120, HOUR);
  const t = themeRow(c.params[0]!);
  if (!t.published || t.hidden) fail(404, "no such theme");
  const had = !!one("SELECT 1 FROM theme_votes WHERE theme = ? AND device = ? AND kind = ?", t.id, d.id, kind);
  const reason = kind === "report" ? text((await readJson(c.req)).reason, 300, "reason", false) : "";
  tx(() => {
    if (kind === "like" && had) {
      run("DELETE FROM theme_votes WHERE theme = ? AND device = ? AND kind = 'like'", t.id, d.id);
      run("UPDATE themes SET likes = likes - 1 WHERE id = ?", t.id);
    } else if (!had) {
      run("INSERT INTO theme_votes (theme, device, kind, reason, created) VALUES (?, ?, ?, ?, ?)", t.id, d.id, kind, reason, Date.now());
      const col = kind === "like" ? "likes" : kind === "install" ? "installs" : "reports";
      run(`UPDATE themes SET ${col} = ${col} + 1 WHERE id = ?`, t.id);
      // three reports take it down until a moderator looks
      if (kind === "report") run("UPDATE themes SET hidden = 1 WHERE id = ? AND reports >= 3", t.id);
    }
  });
  const now = one("SELECT likes, installs FROM themes WHERE id = ?", t.id)!;
  send(c.res, 200, { likes: now.likes, installs: now.installs, liked: kind === "like" ? !had : undefined });
}

function safeUnlink(name: string) {
  try {
    unlinkSync(join(DATA, "themes", name));
  } catch {
    /* already gone */
  }
}

function removeThemeFiles(id: string) {
  const t = one("SELECT bg, preview FROM themes WHERE id = ?", id);
  if (t?.bg) safeUnlink(String(t.bg));
  if (t?.preview) safeUnlink(String(t.preview));
}

function deleteTheme(c: Ctx) {
  const t = themeRow(c.params[0]!);
  if (!isAdmin(c) && t.author !== me(c).id) fail(403, "not your theme");
  removeThemeFiles(String(t.id));
  run("DELETE FROM themes WHERE id = ?", t.id);
  send(c.res, 204, null);
}

// ---- moderation ---------------------------------------------------------------------------------------------------

function isAdmin(c: Ctx) {
  const token = process.env.ADMIN_TOKEN ?? "";
  const auth = String(c.req.headers.authorization ?? "");
  if (token.length < 24 || !auth.startsWith("Admin ")) return false;
  const a = Buffer.from(sha(auth.slice(6).trim()));
  const b = Buffer.from(sha(token));
  return timingSafeEqual(a, b);
}

function admin(c: Ctx) {
  if (!isAdmin(c)) {
    limit(`admin-miss:${c.ip}`, 10, HOUR);
    fail(404, "not found");
  }
}

function adminThemes(c: Ctx) {
  admin(c);
  const rows = all(
    `SELECT t.*, a.name author_name, a.code author_code,
            (SELECT group_concat(reason, ' | ') FROM theme_votes v WHERE v.theme = t.id AND v.kind = 'report') reasons
       FROM themes t JOIN devices a ON a.id = t.author
      WHERE t.reports > 0 OR t.hidden = 1 OR ? = 1 ORDER BY t.reports DESC, t.created DESC LIMIT 200`,
    c.query.get("all") === "1" ? 1 : 0,
  );
  send(c.res, 200, { themes: rows.map((t) => themeOut(t, { authorCode: t.author_code, reports: t.reports, hidden: !!t.hidden, reasons: t.reasons ?? "", css: t.css })) });
}

function adminSet(c: Ctx, hidden: boolean) {
  admin(c);
  const t = themeRow(c.params[0]!);
  tx(() => {
    run("UPDATE themes SET hidden = ? WHERE id = ?", hidden ? 1 : 0, t.id);
    // kept after a look: the old reports are settled
    if (!hidden) {
      run("DELETE FROM theme_votes WHERE theme = ? AND kind = 'report'", t.id);
      run("UPDATE themes SET reports = 0 WHERE id = ?", t.id);
    }
  });
  send(c.res, 204, null);
}

// ---- the routes ---------------------------------------------------------------------------------------------------

type Handler = (c: Ctx) => unknown;
const CODE = "([A-Za-z0-9-]{4,16})";
const TID = "([A-Za-z0-9_-]{10})";

const ROUTES: [string, RegExp, Handler][] = [
  ["GET", /^\/v1\/health$/, (c) => send(c.res, 200, { ok: true })],
  ["POST", /^\/v1\/register$/, register],
  ["GET", /^\/v1\/me$/, getMe],
  ["PUT", /^\/v1\/me$/, putMe],
  ["DELETE", /^\/v1\/me$/, deleteMe],
  ["PUT", /^\/v1\/me\/now$/, putNow],
  ["GET", /^\/v1\/friends$/, getFriends],
  ["POST", /^\/v1\/friends$/, addFriend],
  ["POST", new RegExp(`^/v1/friends/${CODE}/accept$`), acceptFriend],
  ["DELETE", new RegExp(`^/v1/friends/${CODE}$`), removeFriend],
  ["POST", /^\/v1\/send$/, sendTrack],
  ["GET", /^\/v1\/updates$/, updates],
  ["GET", /^\/v1\/recent$/, recent],
  ["GET", new RegExp(`^/v1/chat/${CODE}$`), chat],
  ["POST", new RegExp(`^/v1/chat/${CODE}/seen$`), chatSeen],
  ["POST", /^\/v1\/messages\/(\d{1,15})\/state$/, messageState],
  ["POST", /^\/v1\/ping$/, ping],
  ["POST", /^\/v1\/listening$/, listened],
  ["GET", /^\/v1\/listening$/, listening],
  ["GET", /^\/v1\/stats$/, stats],
  ["GET", /^\/v1\/themes$/, listThemes],
  ["POST", /^\/v1\/themes$/, createTheme],
  ["GET", new RegExp(`^/v1/themes/${TID}$`), getTheme],
  ["DELETE", new RegExp(`^/v1/themes/${TID}$`), deleteTheme],
  ["PUT", new RegExp(`^/v1/themes/${TID}/background$`), putBackground],
  ["GET", new RegExp(`^/v1/themes/${TID}/background$`), (c) => themeFile(c, "bg")],
  ["PUT", new RegExp(`^/v1/themes/${TID}/preview$`), putPreview],
  ["GET", new RegExp(`^/v1/themes/${TID}/preview$`), (c) => themeFile(c, "preview")],
  ["POST", new RegExp(`^/v1/themes/${TID}/like$`), (c) => vote(c, "like")],
  ["POST", new RegExp(`^/v1/themes/${TID}/install$`), (c) => vote(c, "install")],
  ["POST", new RegExp(`^/v1/themes/${TID}/report$`), (c) => vote(c, "report")],
  ["GET", /^\/v1\/admin\/themes$/, adminThemes],
  ["POST", new RegExp(`^/v1/admin/themes/${TID}/hide$`), (c) => adminSet(c, true)],
  ["POST", new RegExp(`^/v1/admin/themes/${TID}/keep$`), (c) => adminSet(c, false)],
  ...roomRoutes({ me, friend: friendOrFail, code: normCode, track }),
];

export async function route(c: Omit<Ctx, "params" | "query">) {
  const u = new URL(c.req.url ?? "/", "http://x");
  let pathMatched = false;
  for (const [method, re, handler] of ROUTES) {
    const m = re.exec(u.pathname);
    if (!m) continue;
    pathMatched = true;
    if (method !== c.req.method) continue;
    await handler({ ...c, params: m.slice(1), query: u.searchParams });
    return;
  }
  throw new HttpError(pathMatched ? 405 : 404, pathMatched ? "method not allowed" : "not found");
}
