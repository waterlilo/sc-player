import { randomBytes } from "node:crypto";
import type { AccountDevice } from "@shared/types";
import { ScError } from "../soundcloud";
import { getSecret, setSecret } from "../store/secrets";
import { argon2 } from "./argon2";
import { checkKdf, cleanCode, codeKeys, formatCode, KDF_V1, loginProblem, newCode, normalizeLogin, passwordKeys, unwrapDek, wrapDek, type Kdf } from "./crypto";
import { accountInfo, request, setAccount, syncNow, type Answer } from "./engine";

/**
 * sc player accounts on this computer (design §5–7): a login and a password instead of the 32-letter key. The
 * password runs through Argon2id here and never leaves; the server gets one derived key (to check) and keeps the data
 * key wrapped with the other. The recovery code is today's transfer key, and making it is part of signing up: the
 * page doesn't let anyone through until two groups of it are typed back.
 */

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const PLATFORM = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";
/** the device's name in the account's list: the system, not the computer's name (that often holds a person's name) */
const DEVICE = { name: PLATFORM === "windows" ? "Windows" : PLATFORM === "mac" ? "macOS" : "Linux", platform: PLATFORM };

/** An answer that isn't a success, as the error the page shows (its code says which). */
function failed(a: Answer): never {
  const e = String(a.body?.error ?? `HTTP ${a.status}`);
  if (a.status === 429) throw new ScError("rate_limited", `retry:${Number(a.body?.retryAfter) || 60}`);
  if (a.status === 401) throw new ScError("unauthorized", e);
  throw new ScError("unknown", e);
}

const sessionHeaders = () => {
  const s = getSecret("accountSession");
  if (!s || !accountInfo()) throw new ScError("unauthorized", "not signed in");
  return { "x-account-session": s };
};

/** Signed in: the session and the data key kept sealed here, the account remembered, the first sync started. */
function signedIn(login: string, vault: string, session: string, cookie: string, dek: Buffer, dropKey: boolean) {
  setSecret("vaultKey", dek.toString("hex"));
  setSecret("accountSession", session);
  setSecret("deviceCookie", cookie);
  setAccount({ login, vault }, { dropKeyAfterSync: dropKey });
  void syncNow();
}

/**
 * The recovery code for signing up: this computer's transfer key when it has one (it becomes the code, nothing is
 * re-encrypted), a new one otherwise. Shown once, to be written down.
 */
let offered: string | null = null;
export function recoveryCodeForSignUp(): { code: string; existing: boolean } {
  const key = getSecret("backupKey");
  const clean = key ? cleanCode(key) : null;
  if (clean) return { code: formatCode(clean), existing: true };
  offered ??= formatCode(newCode());
  return { code: offered, existing: false };
}

export async function loginFree(login: string): Promise<boolean> {
  const l = normalizeLogin(login);
  if (loginProblem(l)) return false;
  const a = await request("GET", `/v1/account/available?login=${encodeURIComponent(l)}`);
  if (a.status !== 200) failed(a);
  return a.body?.free === true;
}

/** A new account: the login, the password (checked on the page) and the recovery code it was shown. */
export async function register(login: string, password: string, code: string) {
  const l = normalizeLogin(login);
  if (loginProblem(l)) throw new ScError("unknown", "bad login");
  const clean = cleanCode(code);
  if (!clean) throw new ScError("unknown", "bad code");
  const k = codeKeys(clean);
  const salt = randomBytes(16);
  const { authKey, kek } = await passwordKeys(password, salt, KDF_V1, argon2);
  const a = await request("POST", "/v1/account", {
    json: { login: l, kdf: KDF_V1, salt: b64(salt), authKey: b64(authKey), wrappedKey: b64(wrapDek(kek, k.dek, k.vaultId)), vault: { id: k.vaultId, writeToken: k.writeToken }, device: DEVICE },
  });
  if (a.status !== 201) failed(a);
  offered = null;
  // the code was this computer's key: it goes after the first sync under the account (it is written down now)
  const hadKey = cleanCode(getSecret("backupKey") ?? "") === clean;
  if (!hadKey) setSecret("backupKey", null);
  signedIn(l, k.vaultId, String(a.body!.session), String(a.body!.deviceCookie), k.dek, hadKey);
}

/** The salt and parameters for a login (made-up ones for a login that doesn't exist: the server doesn't tell). */
async function prelogin(login: string): Promise<{ salt: Buffer; kdf: Kdf }> {
  const a = await request("POST", "/v1/account/prelogin", { json: { login } });
  if (a.status !== 200) failed(a);
  const salt = Buffer.from(String(a.body!.salt), "base64");
  // parameters below the floor would make a stolen database easy to guess: not used
  return { salt, kdf: checkKdf(a.body!.kdf) };
}

/** Sign in on this computer. What's here is added to the account (a first sync only adds). */
export async function signIn(login: string, password: string) {
  const l = normalizeLogin(login);
  if (loginProblem(l)) throw new ScError("unauthorized", "wrong");
  const { salt, kdf } = await prelogin(l);
  const { authKey, kek } = await passwordKeys(password, salt, kdf, argon2);
  const a = await request("POST", "/v1/account/login", { json: { login: l, authKey: b64(authKey), deviceCookie: getSecret("deviceCookie") ?? undefined, device: DEVICE } });
  if (a.status !== 200) failed(a);
  const vault = String(a.body!.vaultId);
  const dek = unwrapDek(kek, Buffer.from(String(a.body!.wrappedKey), "base64"), vault);
  if (!dek) throw new ScError("unknown", "the account's key didn't open");
  // a transfer key here: its data comes along in the first sync; the key itself isn't needed any more
  signedIn(l, vault, String(a.body!.session), String(a.body!.deviceCookie), dek, !!getSecret("backupKey"));
}

/** A forgotten password: the recovery code and a new password. Every other device is signed out. Returns the login. */
export async function recover(code: string, password: string): Promise<string> {
  const clean = cleanCode(code);
  if (!clean) throw new ScError("unknown", "bad code");
  const k = codeKeys(clean);
  const salt = randomBytes(16);
  const { authKey, kek } = await passwordKeys(password, salt, KDF_V1, argon2);
  const a = await request("POST", "/v1/account/recover", {
    json: { vaultId: k.vaultId, writeToken: k.writeToken, kdf: KDF_V1, salt: b64(salt), authKey: b64(authKey), wrappedKey: b64(wrapDek(kek, k.dek, k.vaultId)), device: DEVICE },
  });
  if (a.status === 404) throw new ScError("not_found", "no_account");
  if (a.status !== 200) failed(a);
  const login = String(a.body!.login);
  signedIn(login, k.vaultId, String(a.body!.session), String(a.body!.deviceCookie), k.dek, !!getSecret("backupKey"));
  return login;
}

/** A new password (the old one proves it's the owner). The data stays as it is: only the key's wrapping changes. */
export async function changePassword(old: string, password: string, signOutOthers: boolean) {
  const acc = accountInfo();
  const dek = getSecret("vaultKey");
  if (!acc || !dek) throw new ScError("unauthorized", "not signed in");
  const was = await prelogin(acc.login);
  const proof = await passwordKeys(old, was.salt, was.kdf, argon2);
  const salt = randomBytes(16);
  const next = await passwordKeys(password, salt, KDF_V1, argon2);
  const a = await request("POST", "/v1/account/password", {
    headers: sessionHeaders(),
    json: { proof: { authKey: b64(proof.authKey) }, kdf: KDF_V1, salt: b64(salt), authKey: b64(next.authKey), wrappedKey: b64(wrapDek(next.kek, Buffer.from(dek, "hex"), acc.vault)), signOutOthers },
  });
  if (a.status !== 204) failed(a);
}

export async function devices(): Promise<AccountDevice[]> {
  const a = await request("GET", "/v1/account", { headers: sessionHeaders() });
  if (a.status !== 200) failed(a);
  return a.body!.sessions as AccountDevice[];
}

/** Sign one device out (null: all but this one). */
export async function revoke(id: number | null) {
  const a = await request("DELETE", id === null ? "/v1/account/sessions" : `/v1/account/sessions/${id}`, { headers: sessionHeaders() });
  if (a.status !== 204) failed(a);
}

/** Signed out here: this computer keeps its likes and playlists, they just stop syncing. */
export async function signOut() {
  try {
    await request("POST", "/v1/account/logout", { headers: sessionHeaders() });
  } catch {
    /* offline: the session ends by itself after half a year */
  }
  setSecret("vaultKey", null);
  setAccount(null, { noAutoKey: true });
}

/** The account and everything in it on the server, gone (the password proves it). What's on this computer stays. */
export async function deleteAccount(password: string) {
  const acc = accountInfo();
  if (!acc) throw new ScError("unauthorized", "not signed in");
  const was = await prelogin(acc.login);
  const proof = await passwordKeys(password, was.salt, was.kdf, argon2);
  const a = await request("DELETE", "/v1/account", { headers: sessionHeaders(), json: { proof: { authKey: b64(proof.authKey) } } });
  if (a.status !== 204) failed(a);
  setSecret("vaultKey", null);
  setAccount(null, { noAutoKey: true });
}
