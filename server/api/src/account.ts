import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { DATA, one, run, tx, all, type Row } from "./db.ts";
import { fail, limit, readJson, send, text } from "./http.ts";
import { accountOfVault, makeVault, sessionOf, sha } from "./vault.ts";

/**
 * sc player accounts (design §5–6): a login and a password, no e-mail or phone. The password never reaches the
 * server: the device runs Argon2id on it and sends `authKey`, one of two keys it gives; the server keeps only an
 * HMAC of that under a pepper from .env (not in the database). The other key stays on the device and unwraps the data
 * key, which the server keeps wrapped. Forgetting the password leaves the recovery code (= the transfer key), whose
 * hash the vault already knows.
 *
 * Guessing is slowed per login (5 tries, then a doubling wait up to an hour), per address and overall, with the
 * counters in the database so a restart doesn't reset them. There is no lock-out: a device that signed in before
 * shows its device cookie and skips the login's wait, so a stranger can't keep the owner out.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

interface C {
  req: IncomingMessage;
  res: ServerResponse;
  ip: string;
  params: string[];
  query: URLSearchParams;
}

// ---- the pepper ----------------------------------------------------------------------------------------------------

/**
 * SCP_ACCOUNT_PEPPER from .env. Without it a production server keeps accounts off (a pepper made up on the spot and
 * lost on the next restart would lock everybody out); a development one makes one in its data folder.
 */
function loadPepper(): Buffer | null {
  const env = process.env.SCP_ACCOUNT_PEPPER ?? "";
  if (env.length >= 32) return Buffer.from(env, "utf8");
  if (process.env.NODE_ENV === "production") {
    console.error("accounts are off: SCP_ACCOUNT_PEPPER (32+ characters) is missing in .env");
    return null;
  }
  const file = join(DATA, "dev-account-pepper");
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  console.warn("accounts: development pepper from the data folder (set SCP_ACCOUNT_PEPPER in production)");
  return Buffer.from(readFileSync(file, "utf8").trim(), "utf8");
}
const PEPPER = loadPepper();
const pepper = () => PEPPER ?? fail(503, "accounts off");
const hmac = (label: string, data: string | Buffer) => createHmac("sha256", pepper()).update(label).update(data).digest();

// ---- input ---------------------------------------------------------------------------------------------------------

const RESERVED = new Set(["admin", "root", "support", "moderator", "sc", "scplayer", "sky", "system", "api"]);
const DEFAULT_KDF = { alg: "argon2id", ver: 19, m: 65536, t: 3, p: 1, len: 32 };

function login(v: unknown): string {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(s) || RESERVED.has(s)) fail(400, "bad login");
  return s;
}

function bytes(v: unknown, len: number, field: string): Buffer {
  const b = typeof v === "string" && /^[A-Za-z0-9+/_-]+={0,2}$/.test(v) ? Buffer.from(v, "base64") : null;
  if (!b || b.length !== len) fail(400, `${field} bad`);
  return b!;
}

/** Argon2id parameters a device may choose: never below OWASP's floor (19 MiB, 2 passes), never absurd. */
function kdf(v: unknown): string {
  const k = (v ?? {}) as Record<string, unknown>;
  const ok = k.alg === "argon2id" && k.ver === 19 && k.p === 1 && k.len === 32 && Number.isInteger(k.m) && Number.isInteger(k.t);
  if (!ok || (k.m as number) < 19456 || (k.m as number) > 1048576 || (k.t as number) < 2 || (k.t as number) > 10) fail(400, "kdf bad");
  return JSON.stringify({ alg: "argon2id", ver: 19, m: k.m, t: k.t, p: 1, len: 32 });
}

const PLATFORMS = new Set(["windows", "mac", "linux", "android", "ios"]);
function device(v: unknown) {
  const d = (v ?? {}) as Record<string, unknown>;
  return { name: text(d.name, 40, "device.name", false), platform: typeof d.platform === "string" && PLATFORMS.has(d.platform) ? d.platform : "" };
}

const hex64 = (v: unknown, field: string) => (typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : fail(400, `${field} bad`));
const token = () => randomBytes(32).toString("base64url");

// ---- slowing down guessing ------------------------------------------------------------------------------------------

/** An address as a counter key: IPv6 by its /64 (one home gets a whole one), hashed with the pepper (no address kept). */
function ipKey(ip: string): string {
  const a = ip.replace(/^::ffff:/, "");
  const net = a.includes(":") ? a.split(":").slice(0, 4).join(":") : a;
  return `ip:${hmac("ip:", net).toString("hex").slice(0, 32)}`;
}

/** Failures that wear off: one less per hour since the last. */
function fails(key: string, now = Date.now()) {
  const r = one("SELECT fails, last, until FROM login_failures WHERE key = ?", key);
  if (!r) return { fails: 0, until: 0 };
  return { fails: Math.max(0, Number(r.fails) - Math.floor((now - Number(r.last)) / HOUR)), until: Number(r.until) };
}

/** 429 with Retry-After while a key waits. */
function mustWait(key: string, now = Date.now()) {
  const until = fails(key, now).until;
  if (until > now) {
    const s = Math.ceil((until - now) / 1000);
    fail(429, "slow down", { retryAfter: s }, { "retry-after": String(s) });
  }
}

/**
 * One more failure. A login waits 2^(n−5) minutes (up to an hour) after its fifth; an address or a device cookie
 * gets `perHour` tries, then waits out the hour.
 */
function noteFail(key: string, perHour?: number) {
  const now = Date.now();
  const n = fails(key, now).fails + 1;
  const until = perHour ? (n >= perHour ? now + HOUR : 0) : n >= 5 ? now + Math.min(2 ** (n - 5), 60) * MIN : 0;
  run("INSERT INTO login_failures (key, fails, last, until) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET fails = excluded.fails, last = excluded.last, until = excluded.until", key, n, now, until);
  failsThisHour.n++;
}
const clearFails = (key: string) => run("DELETE FROM login_failures WHERE key = ?", key);

/** All failed sign-ins this hour: past 300, someone is guessing at scale — said once in the log. */
const failsThisHour = { n: 0, hour: 0, told: false };
setInterval(() => {
  if (failsThisHour.n > 300 && !failsThisHour.told) console.warn(new Date().toISOString(), `accounts: ${failsThisHour.n} failed sign-ins this hour`);
  const h = Math.floor(Date.now() / HOUR);
  if (h !== failsThisHour.hour) Object.assign(failsThisHour, { n: 0, hour: h, told: false });
  else if (failsThisHour.n > 300) failsThisHour.told = true;
}, MIN).unref();

// ---- sessions ------------------------------------------------------------------------------------------------------

function newSession(account: number, d: { name: string; platform: string }) {
  const s = token();
  const now = Date.now();
  run("INSERT INTO account_sessions (account, token_hash, name, platform, created, seen) VALUES (?, ?, ?, ?, ?, ?)", account, sha(s), d.name, d.platform, now, now);
  run("UPDATE accounts SET seen = ? WHERE id = ?", now, account);
  return s;
}

/** The device cookie it showed, if it is this account's; otherwise a new one. */
function deviceCookie(account: number, shown?: string | null) {
  if (shown && one("SELECT 1 FROM account_devices WHERE account = ? AND cookie_hash = ?", account, sha(shown))) return shown;
  const c = token();
  run("INSERT INTO account_devices (account, cookie_hash, created) VALUES (?, ?, ?)", account, sha(c), Date.now());
  // a few dozen devices at most: the oldest cookies go
  run("DELETE FROM account_devices WHERE account = ? AND cookie_hash NOT IN (SELECT cookie_hash FROM account_devices WHERE account = ? ORDER BY created DESC LIMIT 50)", account, account);
  return c;
}

const accountRow = (id: number) => one("SELECT * FROM accounts WHERE id = ?", id) ?? fail(401, "session_gone");
const b64 = (v: unknown) => Buffer.from(v as Uint8Array).toString("base64");
const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

/**
 * Proof for changing what guards the account: the current authKey (the old password) or the write token (the
 * recovery code). A wrong one counts as a failed sign-in.
 */
function checkProof(acc: Row, proof: unknown, ip: string) {
  const p = (proof ?? {}) as Record<string, unknown>;
  mustWait(`login:${acc.login}`);
  mustWait(ipKey(ip));
  let ok = false;
  if (p.authKey !== undefined) ok = same(hmac("auth:", bytes(p.authKey, 32, "proof.authKey")), Buffer.from(String(acc.auth_hash), "hex"));
  else if (p.writeToken !== undefined) ok = sha(hex64(p.writeToken, "proof.writeToken")) === String(one("SELECT write_hash FROM vaults WHERE id = ?", acc.vault)?.write_hash);
  if (!ok) {
    noteFail(`login:${acc.login}`);
    noteFail(ipKey(ip), 30);
    fail(401, "wrong");
  }
}

// ---- endpoints -----------------------------------------------------------------------------------------------------

/** GET /v1/account/available?login=: free or taken (heavily limited: it does tell whether a login exists). */
function available(c: C) {
  pepper();
  limit(`available:${c.ip}`, 20, HOUR);
  const l = login(c.query.get("login"));
  send(c.res, 200, { free: !one("SELECT 1 FROM accounts WHERE login = ?", l) });
}

/**
 * POST /v1/account/prelogin {login}: the salt and parameters for Argon2id. A login that doesn't exist gets a salt that
 * looks just as real (an HMAC of the login), so asking doesn't tell who has an account.
 */
async function prelogin(c: C) {
  pepper();
  limit(`prelogin:${c.ip}`, 30, HOUR);
  const l = login((await readJson(c.req)).login);
  limit(`prelogin-login:${l}`, 20, HOUR);
  const a = one("SELECT salt, kdf FROM accounts WHERE login = ?", l);
  if (a) return send(c.res, 200, { salt: b64(a.salt), kdf: JSON.parse(String(a.kdf)) });
  send(c.res, 200, { salt: hmac("fake-salt:", l).subarray(0, 16).toString("base64"), kdf: DEFAULT_KDF });
}

/**
 * POST /v1/account: a new account over a vault — a new one, or the one of a transfer key the person already has
 * (its old backup becomes the vault). Nothing exists before this call, so abandoned sign-ups leave nothing behind.
 */
async function register(c: C) {
  pepper();
  limit(`account-new:${c.ip}`, 5, DAY);
  const body = await readJson(c.req);
  const l = login(body.login);
  const k = kdf(body.kdf);
  const salt = bytes(body.salt, 16, "salt");
  const authKey = bytes(body.authKey, 32, "authKey");
  const wrapped = bytes(body.wrappedKey, 60, "wrappedKey");
  const v = (body.vault ?? {}) as Record<string, unknown>;
  const vid = hex64(v.id, "vault.id");
  const write = hex64(v.writeToken, "vault.writeToken");
  const d = device(body.device);
  const out = tx(() => {
    if (one("SELECT 1 FROM accounts WHERE login = ?", l)) fail(409, "login_taken");
    makeVault(vid, write, { forAccount: true });
    const now = Date.now();
    const id = Number(
      run("INSERT INTO accounts (login, salt, kdf, auth_hash, wrapped_key, vault, created, updated, seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", l, salt, k, hmac("auth:", authKey).toString("hex"), wrapped, vid, now, now, now)
        .lastInsertRowid,
    );
    return { session: newSession(id, d), deviceCookie: deviceCookie(id), account: { login: l }, vaultId: vid, keyEpoch: 1 };
  });
  send(c.res, 201, out);
}

/** POST /v1/account/login {login, authKey, deviceCookie?, device}: a session and the wrapped data key. */
async function signIn(c: C) {
  pepper();
  limit(`login-any:${c.ip}`, 60, HOUR);
  const body = await readJson(c.req);
  const l = login(body.login);
  const authKey = bytes(body.authKey, 32, "authKey");
  const cookie = typeof body.deviceCookie === "string" && /^[\w-]{40,64}$/.test(body.deviceCookie) ? body.deviceCookie : null;
  const ip = ipKey(c.ip);
  mustWait(ip);
  const acc = one("SELECT * FROM accounts WHERE login = ?", l);
  const known = !!acc && !!cookie && !!one("SELECT 1 FROM account_devices WHERE account = ? AND cookie_hash = ?", acc.id, sha(cookie));
  // a device that signed in here before skips the login's wait (its own tries are counted instead)
  const brake = known ? `cookie:${sha(cookie!)}` : `login:${l}`;
  mustWait(brake);
  // the same work for a login that doesn't exist, so the time doesn't tell
  const expected = acc ? Buffer.from(String(acc.auth_hash), "hex") : hmac("no-such-login:", l);
  const ok = same(hmac("auth:", authKey), expected) && !!acc;
  if (!ok) {
    noteFail(ip, 30);
    noteFail(brake, known ? 10 : undefined);
    fail(401, "wrong");
  }
  clearFails(`login:${l}`);
  const d = device(body.device);
  send(c.res, 200, {
    session: newSession(Number(acc!.id), d),
    deviceCookie: deviceCookie(Number(acc!.id), cookie),
    login: l,
    vaultId: acc!.vault,
    wrappedKey: b64(acc!.wrapped_key),
    kdf: JSON.parse(String(acc!.kdf)),
    keyEpoch: Number(acc!.key_epoch),
  });
}

/** POST /v1/account/logout: this session ends. */
function signOut(c: C) {
  const s = sessionOf(c.req);
  run("DELETE FROM account_sessions WHERE id = ?", s.id);
  send(c.res, 204, null);
}

/** GET /v1/account: the login and the devices signed in. */
function getAccount(c: C) {
  const s = sessionOf(c.req);
  const a = accountRow(Number(s.account));
  const sessions = all("SELECT id, name, platform, created, seen FROM account_sessions WHERE account = ? ORDER BY seen DESC", a.id).map((r) => ({
    id: Number(r.id),
    name: r.name,
    platform: r.platform,
    created: Number(r.created),
    seen: Number(r.seen),
    current: r.id === s.id,
  }));
  send(c.res, 200, { login: a.login, created: Number(a.created), kdf: JSON.parse(String(a.kdf)), keyEpoch: Number(a.key_epoch), sessions });
}

/** PUT /v1/account/device {name}: this device's name in the list. */
async function nameDevice(c: C) {
  const s = sessionOf(c.req);
  const d = device({ ...(await readJson(c.req)).device as object, platform: s.platform });
  run("UPDATE account_sessions SET name = ? WHERE id = ?", d.name, s.id);
  send(c.res, 204, null);
}

/** DELETE /v1/account/sessions/<id>: one device signed out; without an id, every device but this one. */
function revoke(c: C) {
  const s = sessionOf(c.req);
  if (c.params[0]) run("DELETE FROM account_sessions WHERE id = ? AND account = ?", Number(c.params[0]), s.account);
  else run("DELETE FROM account_sessions WHERE account = ? AND id <> ?", s.account, s.id);
  send(c.res, 204, null);
}

/** POST /v1/account/sessions {name, platform}: a session for another device this one brings in (the QR sign-in). */
async function addSession(c: C) {
  const s = sessionOf(c.req);
  limit(`add-session:${s.account}`, 10, HOUR);
  const d = device(await readJson(c.req));
  send(c.res, 201, { session: newSession(Number(s.account), d), deviceCookie: deviceCookie(Number(s.account)) });
}

/**
 * POST /v1/account/password {proof, kdf, salt, authKey, wrappedKey, signOutOthers}: a new password. The data key
 * stays: only its wrapping changes, nothing gets re-encrypted.
 */
async function changePassword(c: C) {
  const s = sessionOf(c.req);
  limit(`password:${s.account}`, 10, DAY);
  const body = await readJson(c.req);
  const acc = accountRow(Number(s.account));
  checkProof(acc, body.proof, c.ip);
  const k = kdf(body.kdf);
  const salt = bytes(body.salt, 16, "salt");
  const authKey = bytes(body.authKey, 32, "authKey");
  const wrapped = bytes(body.wrappedKey, 60, "wrappedKey");
  tx(() => {
    run("UPDATE accounts SET kdf = ?, salt = ?, auth_hash = ?, wrapped_key = ?, updated = ? WHERE id = ?", k, salt, hmac("auth:", authKey).toString("hex"), wrapped, Date.now(), acc.id);
    if (body.signOutOthers !== false) run("DELETE FROM account_sessions WHERE account = ? AND id <> ?", acc.id, s.id);
  });
  clearFails(`login:${acc.login}`);
  send(c.res, 204, null);
}

/**
 * POST /v1/account/recover {vaultId, writeToken, kdf, salt, authKey, wrappedKey, device}: a forgotten password, by
 * the recovery code. No login needed (the code names the vault); the login comes back in the answer. Every other
 * device is signed out.
 */
async function recover(c: C) {
  pepper();
  limit(`recover:${c.ip}`, 10, HOUR);
  const body = await readJson(c.req);
  const vid = hex64(body.vaultId, "vaultId");
  const write = hex64(body.writeToken, "writeToken");
  const k = kdf(body.kdf);
  const salt = bytes(body.salt, 16, "salt");
  const authKey = bytes(body.authKey, 32, "authKey");
  const wrapped = bytes(body.wrappedKey, 60, "wrappedKey");
  const d = device(body.device);
  const v = one("SELECT write_hash FROM vaults WHERE id = ?", vid);
  if (!v || v.write_hash !== sha(write)) fail(404, "no_account");
  const acc = accountOfVault(vid) ?? fail(404, "no_account");
  const out = tx(() => {
    run("UPDATE accounts SET kdf = ?, salt = ?, auth_hash = ?, wrapped_key = ?, updated = ? WHERE id = ?", k, salt, hmac("auth:", authKey).toString("hex"), wrapped, Date.now(), acc.id);
    run("DELETE FROM account_sessions WHERE account = ?", acc.id);
    return { login: acc.login, session: newSession(Number(acc.id), d), deviceCookie: deviceCookie(Number(acc.id)), vaultId: vid, keyEpoch: Number(acc.key_epoch) };
  });
  clearFails(`login:${acc.login}`);
  send(c.res, 200, out);
}

/** DELETE /v1/account {proof}: the account, its sessions, its vault and the old backup — gone. */
async function deleteAccount(c: C) {
  const s = sessionOf(c.req);
  const acc = accountRow(Number(s.account));
  checkProof(acc, (await readJson(c.req)).proof, c.ip);
  tx(() => {
    run("DELETE FROM accounts WHERE id = ?", acc.id);
    run("DELETE FROM vaults WHERE id = ?", acc.vault);
    run("DELETE FROM backups WHERE id = ?", acc.vault);
  });
  send(c.res, 204, null);
}

export const accountRoutes = (): [string, RegExp, (c: C) => unknown][] => [
  ["GET", /^\/v1\/account\/available$/, available],
  ["POST", /^\/v1\/account\/prelogin$/, prelogin],
  ["POST", /^\/v1\/account\/login$/, signIn],
  ["POST", /^\/v1\/account\/logout$/, signOut],
  ["POST", /^\/v1\/account\/password$/, changePassword],
  ["POST", /^\/v1\/account\/recover$/, recover],
  ["PUT", /^\/v1\/account\/device$/, nameDevice],
  ["POST", /^\/v1\/account\/sessions$/, addSession],
  ["DELETE", /^\/v1\/account\/sessions$/, revoke],
  ["DELETE", /^\/v1\/account\/sessions\/(\d{1,15})$/, revoke],
  ["GET", /^\/v1\/account$/, getAccount],
  ["POST", /^\/v1\/account$/, register],
  ["DELETE", /^\/v1\/account$/, deleteAccount],
];
