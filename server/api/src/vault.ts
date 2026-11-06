import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { all, db, one, run, tx, type Row } from "./db.ts";
import { fail, limit, readBody, readJson, send } from "./http.ts";

/**
 * Two-way sync (design "sc player — аккаунты и синхронизация", §8–9). A vault is a set of documents an app sealed on
 * its side (likes, a playlist, own lyrics…): the server keeps bytes it can't read, under names it can't read either
 * (an HMAC of the real one). Each write bumps the vault's sequence, and a document's version is the sequence at its
 * write: apps ask for what changed since the version they saw, and write with If-Match, so two devices never silently
 * overwrite each other — the loser gets 409 with the current document, merges and tries again.
 *
 * A vault is opened by an account session (X-Account-Session), or, while no account owns it, by the hash of the
 * recovery code (X-Vault-Write: today's transfer keys). Its name is today's backup id, so a backup becomes a vault.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const DOC_MAX = 1024 * 1024;
const VAULT_BYTES = 16 * 1024 * 1024;
const VAULT_DOCS = 2000;
const BATCH_MAX = 6 * 1024 * 1024; // 4 MiB of documents, as base64
/** deleted documents stay this long as a note in the changes, then go (a device away longer syncs in full) */
const DOC_TOMB_KEEP = 180 * DAY;
/** a vault (and its account) nobody opened for a year goes */
const VAULT_KEEP = 365 * DAY;
/** sessions unused this long end */
export const SESSION_KEEP = 180 * DAY;

db.exec(`
CREATE TABLE IF NOT EXISTS vaults (
  id TEXT PRIMARY KEY,                  -- 64 hex: sha256("scp-backup-id:" + code), = backups.id for a backup's key
  write_hash TEXT NOT NULL,             -- sha256 of the write token
  seq INTEGER NOT NULL DEFAULT 0,       -- up by one on every write of any document
  purged_seq INTEGER NOT NULL DEFAULT 0,-- deleted documents up to this version are forgotten
  bytes INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS vault_docs (
  vault TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  doc TEXT NOT NULL,                    -- 32 hex: an HMAC of the document's name, made on the device
  version INTEGER NOT NULL,             -- the vault's seq when written
  data BLOB,                            -- NULL: deleted
  updated INTEGER NOT NULL,
  PRIMARY KEY (vault, doc)
);
CREATE INDEX IF NOT EXISTS vault_docs_seq ON vault_docs (vault, version);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,           -- lower case
  salt BLOB NOT NULL,                   -- 16 bytes, for Argon2id on the device
  kdf TEXT NOT NULL,                    -- JSON of the Argon2id parameters
  auth_hash TEXT NOT NULL,              -- HMAC-SHA256(pepper from .env, authKey)
  wrapped_key BLOB NOT NULL,            -- the data key sealed with a key only the password gives
  vault TEXT NOT NULL UNIQUE REFERENCES vaults(id),
  key_epoch INTEGER NOT NULL DEFAULT 1,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS account_sessions (
  id INTEGER PRIMARY KEY,
  account INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,      -- sha256 of the session token
  name TEXT NOT NULL DEFAULT '',        -- the device's name, as the person set it
  platform TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS account_devices (  -- "device cookies": a device that signed in before skips the login's delay
  account INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  cookie_hash TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (account, cookie_hash)
);
CREATE TABLE IF NOT EXISTS login_failures (   -- kept in the database: a restart must not reset the brakes
  key TEXT PRIMARY KEY,                 -- 'login:<login>' | 'ip:<sha256 of pepper + address>' | 'cookie:<hash>'
  fails INTEGER NOT NULL,
  last INTEGER NOT NULL,
  until INTEGER NOT NULL
);
`);

export const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const header = (req: IncomingMessage, name: string) => String(req.headers[name] ?? "").trim();
const b64 = (data: unknown) => (data === null ? null : Buffer.from(data as Uint8Array).toString("base64"));

// ---- who may open a vault ------------------------------------------------------------------------------------------

/** The account session of a request (X-Account-Session), with its account; 401 for an unknown or expired one. */
export function sessionOf(req: IncomingMessage): Row {
  const token = header(req, "x-account-session");
  if (!/^[\w-]{40,64}$/.test(token)) return fail(401, "session_gone");
  const s = one(
    "SELECT s.id, s.account, s.seen, s.name, s.platform, s.created, a.login, a.vault, a.key_epoch FROM account_sessions s JOIN accounts a ON a.id = s.account WHERE s.token_hash = ?",
    sha(token),
  );
  if (!s) return fail(401, "session_gone");
  const now = Date.now();
  if (now - Number(s.seen) > SESSION_KEEP) {
    run("DELETE FROM account_sessions WHERE id = ?", s.id);
    return fail(401, "session_gone");
  }
  if (now - Number(s.seen) > MIN) {
    run("UPDATE account_sessions SET seen = ? WHERE id = ?", now, s.id);
    run("UPDATE accounts SET seen = ? WHERE id = ?", now, s.account);
  }
  return s;
}

export const accountOfVault = (vid: string) => one("SELECT id, login, key_epoch FROM accounts WHERE vault = ?", vid);

/**
 * The vault, if this request may open it: a session whose account owns it, or the write token of a vault no account
 * owns. A vault with an account answers the token with 423 and the login, so an app holding the code can offer to
 * sign in; a session of an account that moved to a new vault (a new code) gets 410.
 */
export function openVault(req: IncomingMessage, vid: string): Row {
  if (header(req, "x-account-session")) {
    const s = sessionOf(req);
    if (s.vault !== vid) return fail(410, "vault_moved");
  } else {
    const token = header(req, "x-vault-write");
    if (!/^[0-9a-f]{64}$/.test(token)) return fail(401, "write token missing");
    const v = one("SELECT write_hash FROM vaults WHERE id = ?", vid);
    if (!v) return fail(404, "no vault");
    if (v.write_hash !== sha(token)) return fail(403, "not your vault");
    const acc = accountOfVault(vid);
    if (acc) return fail(423, "vault_has_account", { login: acc.login });
  }
  const v = one("SELECT * FROM vaults WHERE id = ?", vid);
  if (!v) return fail(404, "no vault");
  const now = Date.now();
  if (now - Number(v.seen) > HOUR) run("UPDATE vaults SET seen = ? WHERE id = ?", now, vid);
  return v;
}

/**
 * A vault for this code's hashes: made now, or raised from the backup under the same name (whose write token must be
 * the same). Returns whether it was made. Throws 403 for a different token, 409 when an account already owns it.
 */
export function makeVault(id: string, writeToken: string, opts: { forAccount: boolean }): boolean {
  const v = one("SELECT write_hash FROM vaults WHERE id = ?", id);
  if (v) {
    if (v.write_hash !== sha(writeToken)) fail(403, "not your vault");
    if (opts.forAccount && accountOfVault(id)) fail(409, "vault_bound");
    return false;
  }
  const b = one("SELECT write_hash FROM backups WHERE id = ?", id);
  if (b && b.write_hash !== sha(writeToken)) fail(403, "not your vault");
  const now = Date.now();
  run("INSERT INTO vaults (id, write_hash, created, updated, seen) VALUES (?, ?, ?, ?, ?)", id, sha(writeToken), now, now, now);
  return true;
}

/** When the old backup of this vault last changed (older apps still write it): null without one. */
const legacyOf = (vid: string) => {
  const b = one("SELECT updated FROM backups WHERE id = ?", vid);
  return b ? Number(b.updated) : null;
};

// ---- endpoints -----------------------------------------------------------------------------------------------------

interface C {
  req: IncomingMessage;
  res: import("node:http").ServerResponse;
  ip: string;
  params: string[];
  query: URLSearchParams;
}

const hex64 = (v: unknown, field: string) => (typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : fail(400, `${field} bad`));

/** POST /v1/vault {id, writeToken}: a vault by a code alone (no account), or the backup of that code as one. */
async function postVault(c: C) {
  limit(`vault-post:${c.ip}`, 30, HOUR);
  const body = await readJson(c.req);
  const id = hex64(body.id, "id");
  const token = hex64(body.writeToken, "writeToken");
  const exists = !!one("SELECT 1 FROM vaults WHERE id = ?", id);
  if (!exists) limit(`vault-new:${c.ip}`, 10, DAY);
  const created = makeVault(id, token, { forAccount: false });
  const acc = accountOfVault(id);
  if (acc) fail(423, "vault_has_account", { login: acc.login });
  send(c.res, created ? 201 : 200, { created, legacy: legacyOf(id) });
}

/** GET …/head: the vault's sequence (nothing new when it's the one the app saw), cheap enough to ask every minute. */
function head(c: C) {
  const vid = c.params[0]!;
  const v = openVault(c.req, vid);
  limit(`head:${vid}`, 30, MIN);
  const acc = accountOfVault(vid);
  send(c.res, 200, { seq: Number(v.seq), serverTime: Date.now(), keyEpoch: acc ? Number(acc.key_epoch) : null, legacy: legacyOf(vid) });
}

/** GET …/changes?since=&limit=: documents written after `since`, oldest first; `reset` when deleted ones were forgotten. */
function changes(c: C) {
  const vid = c.params[0]!;
  const v = openVault(c.req, vid);
  limit(`changes:${vid}`, 300, HOUR);
  const since = Math.max(0, Number(c.query.get("since")) || 0);
  const max = Math.min(200, Math.max(1, Number(c.query.get("limit")) || 200));
  const rows = all("SELECT doc, version, data FROM vault_docs WHERE vault = ? AND version > ? ORDER BY version LIMIT ?", vid, since, max + 1);
  const docs: { doc: string; version: number; data: string | null }[] = [];
  let bytes = 0;
  for (const r of rows.slice(0, max)) {
    // answers stay a few megabytes: the rest comes with the next call
    if (docs.length && bytes > 4 * 1024 * 1024) break;
    const data = b64(r.data);
    bytes += data?.length ?? 0;
    docs.push({ doc: String(r.doc), version: Number(r.version), data });
  }
  const more = docs.length < rows.length;
  send(c.res, 200, { seq: more ? docs[docs.length - 1]!.version : Number(v.seq), docs, more, reset: since > 0 && since < Number(v.purged_seq), serverTime: Date.now() });
}

/** If-Match: "<version>" (0: a document not there yet) or If-None-Match: *. */
function precondition(req: IncomingMessage): number {
  if (header(req, "if-none-match") === "*") return 0;
  const m = /^"?(\d{1,15})"?$/.exec(header(req, "if-match"));
  return m ? Number(m[1]) : fail(428, "If-Match missing");
}

const isSealed = (b: Buffer) => b.length >= 33 && b.subarray(0, 4).toString("latin1") === "SCS1";

interface Write {
  doc: string;
  expect: number;
  data: Buffer | null;
}

/**
 * Writes all or nothing, in one transaction: the documents whose version isn't the expected one come back as
 * conflicts (with what is there now) and nothing is written.
 */
function writeDocs(vid: string, writes: Write[]): { versions: Record<string, number>; seq: number } {
  return tx(() => {
    const v = one("SELECT seq, bytes FROM vaults WHERE id = ?", vid)!;
    const conflicts: { doc: string; version: number; data: string | null }[] = [];
    let bytes = Number(v.bytes);
    let added = 0;
    const current = writes.map((w) => {
      const cur = one("SELECT version, data FROM vault_docs WHERE vault = ? AND doc = ?", vid, w.doc);
      if ((cur ? Number(cur.version) : 0) !== w.expect) conflicts.push({ doc: w.doc, version: cur ? Number(cur.version) : 0, data: cur ? b64(cur.data) : null });
      bytes += (w.data?.length ?? 0) - (cur?.data ? (cur.data as unknown as Uint8Array).length : 0);
      if (!cur && w.data) added++;
      return cur;
    });
    if (conflicts.length) fail(409, "conflict", { conflicts });
    if (bytes > VAULT_BYTES) fail(413, "vault full");
    if (added && Number(one("SELECT COUNT(*) AS n FROM vault_docs WHERE vault = ?", vid)!.n) + added > VAULT_DOCS) fail(413, "too many documents");
    let seq = Number(v.seq);
    const now = Date.now();
    const versions: Record<string, number> = {};
    writes.forEach((w, i) => {
      if (!w.data && !current[i]) return; // deleting what isn't there
      seq++;
      run(
        "INSERT INTO vault_docs (vault, doc, version, data, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT(vault, doc) DO UPDATE SET version = excluded.version, data = excluded.data, updated = excluded.updated",
        vid,
        w.doc,
        seq,
        w.data,
        now,
      );
      versions[w.doc] = seq;
    });
    run("UPDATE vaults SET seq = ?, bytes = ?, updated = ?, seen = ? WHERE id = ?", seq, Math.max(0, bytes), now, now, vid);
    return { versions, seq };
  });
}

function writeLimits(vid: string, n = 1) {
  for (let i = 0; i < n; i++) {
    limit(`put:${vid}`, 30, MIN);
    limit(`put-hour:${vid}`, 300, HOUR);
  }
}

/** One write's conflict as the single-document answer: 409 {version, data}. */
function single(vid: string, w: Write) {
  try {
    return writeDocs(vid, [w]);
  } catch (e) {
    const conflicts = (e as { extra?: { conflicts?: { version: number; data: string | null }[] } }).extra?.conflicts;
    if (conflicts?.[0]) fail(409, "conflict", { version: conflicts[0].version, data: conflicts[0].data });
    throw e;
  }
}

/** PUT …/docs/<doc>: a document's new sealed bytes, If-Match the version the app merged over. */
async function putDoc(c: C) {
  const [vid, doc] = c.params as [string, string];
  openVault(c.req, vid);
  writeLimits(vid);
  const expect = precondition(c.req);
  const data = await readBody(c.req, DOC_MAX);
  if (!isSealed(data)) fail(400, "not a sync document");
  const r = single(vid, { doc, expect, data });
  send(c.res, 200, { version: r.versions[doc] ?? 0, seq: r.seq });
}

/** DELETE …/docs/<doc>: gone (a note stays in the changes for a while, so other devices learn of it). */
function deleteDoc(c: C) {
  const [vid, doc] = c.params as [string, string];
  openVault(c.req, vid);
  writeLimits(vid);
  const r = single(vid, { doc, expect: precondition(c.req), data: null });
  send(c.res, 200, { version: r.versions[doc] ?? 0, seq: r.seq });
}

/** POST …/batch {docs: [{doc, ifMatch, data (base64) | null}]}: several documents at once (a first sync), all or none. */
async function batch(c: C) {
  const vid = c.params[0]!;
  openVault(c.req, vid);
  const body = await readJson(c.req, BATCH_MAX);
  if (!Array.isArray(body.docs) || !body.docs.length || body.docs.length > 500) fail(400, "docs bad");
  const writes = (body.docs as Record<string, unknown>[]).map((d): Write => {
    const doc = typeof d?.doc === "string" && /^[0-9a-f]{32}$/.test(d.doc) ? d.doc : fail(400, "doc bad");
    const expect = typeof d.ifMatch === "number" && Number.isSafeInteger(d.ifMatch) && d.ifMatch >= 0 ? d.ifMatch : fail(400, "ifMatch bad");
    const data = d.data === null ? null : typeof d.data === "string" ? Buffer.from(d.data, "base64") : fail(400, "data bad");
    if (data && (data.length > DOC_MAX || !isSealed(data))) fail(400, "not a sync document");
    return { doc, expect, data };
  });
  if (new Set(writes.map((w) => w.doc)).size !== writes.length) fail(400, "a document twice");
  writeLimits(vid, Math.ceil(writes.length / 20));
  send(c.res, 200, writeDocs(vid, writes));
}

export const vaultRoutes = (): [string, RegExp, (c: C) => unknown][] => [
  ["POST", /^\/v1\/vault$/, postVault],
  ["GET", /^\/v1\/vault\/([0-9a-f]{64})\/head$/, head],
  ["GET", /^\/v1\/vault\/([0-9a-f]{64})\/changes$/, changes],
  ["PUT", /^\/v1\/vault\/([0-9a-f]{64})\/docs\/([0-9a-f]{32})$/, putDoc],
  ["DELETE", /^\/v1\/vault\/([0-9a-f]{64})\/docs\/([0-9a-f]{32})$/, deleteDoc],
  ["POST", /^\/v1\/vault\/([0-9a-f]{64})\/batch$/, batch],
];

/** The old backup by its id: the name alone opens it, unless an account owns the vault (then the write token too). */
export function backupLocked(id: string, req: IncomingMessage): boolean {
  if (!accountOfVault(id)) return false;
  const v = one("SELECT write_hash FROM vaults WHERE id = ?", id);
  return !v || v.write_hash !== sha(header(req, "x-backup-write"));
}

// ---- housekeeping --------------------------------------------------------------------------------------------------

/** Forgets deleted documents after half a year, and vaults (with their accounts) nobody opened for a year. */
export function sweepVaults(now = Date.now()) {
  tx(() => {
    for (const r of all("SELECT vault, MAX(version) AS v FROM vault_docs WHERE data IS NULL AND updated < ? GROUP BY vault", now - DOC_TOMB_KEEP))
      run("UPDATE vaults SET purged_seq = MAX(purged_seq, ?) WHERE id = ?", r.v, r.vault);
    run("DELETE FROM vault_docs WHERE data IS NULL AND updated < ?", now - DOC_TOMB_KEEP);
    const old = all("SELECT id FROM vaults WHERE seen < ?", now - VAULT_KEEP).map((r) => String(r.id));
    for (const id of old) {
      run("DELETE FROM accounts WHERE vault = ?", id);
      run("DELETE FROM vaults WHERE id = ?", id);
    }
    run("DELETE FROM account_sessions WHERE seen < ?", now - SESSION_KEEP);
    run("DELETE FROM login_failures WHERE last < ?", now - DAY);
  });
}
setInterval(() => sweepVaults(), HOUR).unref();
