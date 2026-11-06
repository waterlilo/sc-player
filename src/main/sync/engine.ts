import { createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, net, type BrowserWindow } from "electron";
import { isLocalTrack, type SyncStatus } from "@shared/types";
import { applyLikes, likesData, mergeLikes, onLikesChange } from "../local-likes";
import { applyPlaylists, importLocal, onPlaylistsChange, playlistsData, renamePlaylistId, type LocalList } from "../local-playlists";
import { applyOwnLyrics, mergeOwnLyrics, onOwnLyricsChange, ownLyricsData } from "../lyrics";
import { adoptFriendSecret, friendSecret, serverBase } from "../social";
import { getSecret, setSecret } from "../store/secrets";
import { log } from "../system/log";
import { send } from "../windows/main-window";
import { cleanCode, codeKeys, docId, formatCode, newCode, openDoc, sealDoc } from "./crypto";
import { emptyDoc, friendFrom, likesChanges, likesFrom, listKey, LYRICS_SHARDS, lyricsChanges, lyricsFrom, lyricsShard, playlistChanges, playlistFrom, secretsChanges } from "./docs";
import { canon, capFor, Clock, gcDoc, mergeDocs, SCHEMA_V, sameContent, stampsOf, TOMB_DAYS, type Doc } from "./merge";

/**
 * Two-way sync of likes, own playlists, own lyrics and the friend code between this computer and the user's other
 * devices (design §8). It works over the modules as they are: after a change here (3 s of quiet) or news on the
 * server, it reads what the modules hold, works out what changed here since the last sync (against the "shadow", the
 * document as last applied here), merges only that over the server's document, writes it back with If-Match, and
 * hands the result to the modules. A 409 means another device wrote first: its document comes in the answer, the same
 * changes go over it, and the write is tried again.
 *
 * The vault is opened by an account (main/sync/accounts) or, without one, by the transfer key as before — which is
 * also the recovery code. People without either get a key with their first like, as the backup did.
 */

const DEBOUNCE_MS = 3000;
const POLL_MS = 60_000;
const POLL_HIDDEN_MS = 5 * 60_000;

// ---- what this computer remembers ----------------------------------------------------------------------------------

interface DocState {
  name: string;
  version: number;
  /** the server's document as last seen (null: none, or deleted) */
  server: Doc | null;
  /** the document as last applied to this computer's data: what "changed here" is measured against */
  shadow: Doc | null;
  /** the highest rev seen: an older one from the server is a rollback, refused */
  rev: number;
}

interface State {
  /** this install's tag in the documents: breaks ties between equal stamps */
  tag: string;
  clock: number;
  offset: number;
  /** the vault the documents below belong to */
  vault: string | null;
  seq: number;
  docs: Record<string, DocState>;
  /** the old backup's time when last folded in */
  legacyAt: number;
  /** signed in: the login and its vault (the session and the data key are in secrets.bin) */
  account: { login: string; vault: string } | null;
  /** signed out on purpose: no new transfer key is made by itself */
  noAutoKey?: boolean;
  /** the transfer key goes once the account has synced (it is the recovery code now, written down) */
  dropKeyAfterSync?: boolean;
  lastAt: number | null;
}

const statePath = () => join(app.getPath("userData"), "sync-state.json");
let st: State | null = null;

function state(): State {
  if (st) return st;
  try {
    st = JSON.parse(readFileSync(statePath(), "utf8")) as State;
  } catch {
    st = null;
  }
  if (!st || typeof st.tag !== "string") st = { tag: "", clock: 0, offset: 0, vault: null, seq: 0, docs: {}, legacyAt: 0, account: null, lastAt: null };
  if (!/^[a-z0-9]{6}$/.test(st.tag)) st.tag = Array.from(randomBytes(6), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  return st;
}

function saveState() {
  const tmp = `${statePath()}.tmp`;
  writeFileSync(tmp, JSON.stringify(state()));
  renameSync(tmp, statePath());
}

/** Forget the documents (a different vault: everything here is new to it, so the next sync is a first one). */
function resetDocs(vault: string | null) {
  const s = state();
  Object.assign(s, { vault, seq: 0, docs: {}, legacyAt: 0 });
}

export const accountInfo = () => state().account;

/** Signed in (or out) from main/sync/accounts. */
export function setAccount(a: { login: string; vault: string } | null, opts: { noAutoKey?: boolean; dropKeyAfterSync?: boolean } = {}) {
  const s = state();
  s.account = a;
  s.noAutoKey = opts.noAutoKey ?? false;
  s.dropKeyAfterSync = opts.dropKeyAfterSync ?? false;
  if (!a) setSecret("accountSession", null);
  saveState();
}

// ---- who opens the vault -------------------------------------------------------------------------------------------

interface Creds {
  vault: string;
  dek: Buffer;
  headers: Record<string, string>;
  /** the transfer key's write token (key mode only) */
  write?: string;
}

function creds(): Creds | null {
  const s = state();
  const session = getSecret("accountSession");
  const dek = getSecret("vaultKey");
  if (s.account && session && dek) return { vault: s.account.vault, dek: Buffer.from(dek, "hex"), headers: { "x-account-session": session } };
  const key = getSecret("backupKey");
  const clean = key ? cleanCode(key) : null;
  if (!clean) return null;
  const k = codeKeys(clean);
  return { vault: k.vaultId, dek: k.dek, headers: { "x-vault-write": k.writeToken }, write: k.writeToken };
}

// ---- requests ------------------------------------------------------------------------------------------------------

/** Not an HTTP error: the server didn't answer. */
export class Offline extends Error {}

export interface Answer {
  status: number;
  body: Record<string, unknown> | null;
  bytes?: Buffer;
  headers: Headers;
}

/** A request to sc player's server; any HTTP status comes back (the caller decides), no answer throws Offline. */
export async function request(method: string, path: string, o: { json?: unknown; raw?: Buffer; headers?: Record<string, string>; binary?: boolean; timeout?: number } = {}): Promise<Answer> {
  const base = serverBase();
  if (!base) throw new Offline("no server in this build");
  const headers: Record<string, string> = { "user-agent": `scplayer/${app.getVersion()}`, ...o.headers };
  if (o.json !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await net.fetch(base + path, {
      method,
      headers,
      body: o.raw ? new Uint8Array(o.raw) : o.json !== undefined ? JSON.stringify(o.json) : undefined,
      signal: AbortSignal.timeout(o.timeout ?? 30_000),
    });
  } catch {
    throw new Offline("sc player's server didn't answer");
  }
  if (o.binary && res.ok) return { status: res.status, body: null, bytes: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, body, headers: res.headers };
}

const errorOf = (a: Answer) => String(a.body?.error ?? `HTTP ${a.status}`);

// ---- status --------------------------------------------------------------------------------------------------------

let win: () => BrowserWindow | null = () => null;
let status: Omit<SyncStatus, "available" | "mode" | "login" | "key"> = { state: "idle", at: null, error: null, accountLogin: null, needsUpdate: false, signedOut: false, brought: null };

export function syncStatus(): SyncStatus {
  const s = state();
  const signedIn = !!s.account && !!getSecret("accountSession");
  return {
    available: !!serverBase(),
    mode: signedIn ? "account" : getSecret("backupKey") ? "key" : "none",
    login: signedIn ? s.account!.login : null,
    key: signedIn ? null : getSecret("backupKey"),
    ...status,
    at: s.lastAt,
  };
}

function setStatus(patch: Partial<typeof status>) {
  status = { ...status, ...patch };
  send(win(), "sync:status", syncStatus());
}

/** The session ended on the server (signed out elsewhere, a new password, a new code): sign-in needed here. */
function sessionEnded(why: string) {
  log("main", `sync: signed out (${why})`);
  setSecret("accountSession", null);
  setSecret("vaultKey", null);
  const s = state();
  s.account = null;
  s.noAutoKey = true;
  saveState();
  setStatus({ state: "idle", signedOut: true, error: null });
}

// ---- documents in and out ------------------------------------------------------------------------------------------

/** The kind a name says, for the documents a device may know without having read them. */
const knownName = (name: string) => name === "likes" || name === "secrets" || /^pl:local-[0-9a-f]{16}$/.test(name) || /^lyrics:[0-9a-f]$/.test(name);

/** A sealed document from the server: its JSON, if it opens and its name (inside) matches the id it was stored under. */
function readDoc(c: Creds, id: string, b64: string): Doc | null {
  try {
    const d = JSON.parse(openDoc(c.dek, c.vault, id, Buffer.from(b64, "base64"))) as Doc;
    if (!d || typeof d.name !== "string" || typeof d.kind !== "string" || docId(c.dek, d.name) !== id) return null;
    return d;
  } catch (e) {
    log("main", `sync: a document didn't open: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** What changed on the server since the last pull. */
async function pull(c: Creds) {
  const s = state();
  for (let guard = 0; guard < 100; guard++) {
    const a = await request("GET", `/v1/vault/${c.vault}/changes?since=${s.seq}`, { headers: c.headers });
    check(a);
    const body = a.body as { seq: number; docs: { doc: string; version: number; data: string | null }[]; more: boolean; reset: boolean; serverTime: number };
    s.offset = body.serverTime - Date.now();
    if (body.reset) {
      // away longer than deleted things are remembered: start over (a first sync, which only ever adds)
      log("main", "sync: away too long, syncing everything again");
      resetDocs(c.vault);
      continue;
    }
    for (const d of body.docs) {
      const was = s.docs[d.doc];
      const doc = d.data ? readDoc(c, d.doc, d.data) : null;
      if (doc && was && doc.rev < was.rev) {
        log("main", `sync: refused an older version of ${was.name}`);
        continue;
      }
      if (d.data && !doc) {
        // can't read it (a newer app's, or damaged): remember its version only, so it is never overwritten blindly
        s.docs[d.doc] = { name: was?.name ?? "", version: d.version, server: was?.server ?? null, shadow: was?.shadow ?? null, rev: was?.rev ?? 0 };
        continue;
      }
      s.docs[d.doc] = { name: doc?.name ?? was?.name ?? "", version: d.version, server: doc, shadow: was?.shadow ?? null, rev: Math.max(was?.rev ?? 0, doc?.rev ?? 0) };
    }
    s.seq = body.seq;
    if (!body.more) return;
  }
}

/** Throws for answers a sync can't go on from (and handles a session that ended). */
function check(a: Answer) {
  if (a.status < 400) return;
  if (a.status === 401 && state().account) {
    sessionEnded(errorOf(a));
    throw new Error("signed out");
  }
  if (a.status === 410) {
    sessionEnded("the account has a new recovery code");
    throw new Error("signed out");
  }
  if (a.status === 423) {
    setStatus({ accountLogin: String(a.body?.login ?? "") });
    throw new Error("vault_has_account");
  }
  throw new Error(errorOf(a));
}

// ---- the old backup ------------------------------------------------------------------------------------------------

/**
 * What older apps still write to the old backup, folded in like a restore did — only what they added after the last
 * time (a like un-♥-ed elsewhere since then stays un-♥-ed). The first time, everything in it comes, with its own times.
 */
async function foldLegacy(c: Creds, updated: number | null) {
  const s = state();
  if (!updated || updated <= s.legacyAt) return;
  const a = await request("GET", `/v1/vault/${c.vault}/legacy`, { headers: c.headers, binary: true });
  if (a.status === 404) return void (s.legacyAt = updated);
  if (!a.bytes) return check(a);
  try {
    const data = a.bytes;
    if (data.subarray(0, 4).toString("latin1") !== "SCB1") throw new Error("not a backup");
    const d = createDecipheriv("aes-256-gcm", c.dek, data.subarray(4, 16));
    d.setAuthTag(data.subarray(data.length - 16));
    const p = JSON.parse(Buffer.concat([d.update(data.subarray(16, data.length - 16)), d.final()]).toString("utf8")) as {
      likes?: { liked?: { id: number; at: number }[]; playlists?: { at: number }[] };
      playlists?: string;
      ownLyrics?: Record<string, { text: string; at: number }>;
      friend?: string | null;
    };
    const after = s.legacyAt;
    const newer = <T extends { at?: number; created?: number }>(xs: T[] | undefined) => (xs ?? []).filter((x) => Number(x.at ?? x.created ?? 0) > after);
    mergeLikes({ liked: newer(p.likes?.liked), hidden: [], playlists: newer(p.likes?.playlists) as never });
    if (p.playlists) {
      const file = JSON.parse(p.playlists) as { playlists?: { created?: number }[] };
      importLocal(JSON.stringify({ ...file, playlists: newer(file.playlists) }));
    }
    mergeOwnLyrics(Object.fromEntries(Object.entries(p.ownLyrics ?? {}).filter(([, v]) => Number(v?.at) > after)));
    if (p.friend && !friendSecret()) await adoptFriendSecret(p.friend);
    s.legacyAt = updated;
    log("main", "sync: folded in the old backup");
  } catch (e) {
    log("main", `sync: the old backup didn't open: ${e instanceof Error ? e.message : e}`);
    s.legacyAt = updated;
  }
}

// ---- one sync ------------------------------------------------------------------------------------------------------

/** Changes here since the last read of each module; a sync applies only to modules that didn't change meanwhile. */
const dirty = { likes: 0, playlists: 0, lyrics: 0 };

interface Plan {
  id: string;
  name: string;
  changes: Doc | null;
  merged: Doc;
}

const isEmpty = (d: Doc) => Object.entries(d).every(([k, v]) => ["v", "kind", "name", "rev", "by"].includes(k) || (v && typeof v === "object" && !Object.keys(v).length));

/** A local playlist restored from a backup (new id) that the vault already has (same name and tracks) takes its id. */
function matchPlaylists() {
  const s = state();
  const known = new Set(Object.values(s.docs).map((d) => d.name));
  const byKey = new Map<string, string>();
  for (const d of Object.values(s.docs)) {
    const l = d.server && d.server.kind === "playlist" ? playlistFrom(d.server) : null;
    if (l) byKey.set(listKey(l.title, l.items.map((i) => i.id)), l.id);
  }
  for (const l of playlistsData()) {
    if (known.has(`pl:${l.id}`)) continue;
    const match = byKey.get(listKey(l.title, l.items.filter((i) => !isLocalTrack(i.id)).map((i) => i.id)));
    if (match && !playlistsData().some((x) => x.id === match)) renamePlaylistId(l.id, match);
  }
}

/** What this computer would write, document by document. */
function plan(c: Creds, clock: Clock): Plan[] {
  const s = state();
  const cap = capFor(Date.now() + s.offset);
  const stamp = () => ({ at: clock.now(), by: s.tag });
  const byName = new Map(Object.entries(s.docs).map(([id, d]) => [d.name, { id, d }]));
  const out: Plan[] = [];
  const add = (name: string, changes: (shadow: Doc | null, server: Doc | null) => Doc | null, kind: string) => {
    const id = docId(c.dek, name);
    const d = byName.get(name)?.d ?? s.docs[id];
    const server = d?.server ?? null;
    // a document from a newer app is read, never written: it could hold what this version doesn't know
    if (server && server.v > SCHEMA_V) return void (status.needsUpdate = true);
    const ch = changes(d?.shadow ?? null, server);
    const merged = gcDoc(mergeDocs(server ?? emptyDoc(kind, name), ch ?? emptyDoc(kind, name), cap), (Date.now() + s.offset - TOMB_DAYS * 86_400_000) * 1000);
    out.push({ id, name, changes: ch, merged });
  };

  const likes = likesData();
  const shareable = { ...likes, liked: likes.liked.filter((l) => !isLocalTrack(l.id)) };
  add("likes", (shadow) => likesChanges(shareable, shadow, stamp, !shadow), "likes");

  const own = ownLyricsData();
  const shards = new Set([...Object.keys(own).map(lyricsShard), ...[...byName.keys()].filter((n) => n.startsWith("lyrics:")).map((n) => n.slice(7))]);
  for (const shard of LYRICS_SHARDS) if (shards.has(shard)) add(`lyrics:${shard}`, (shadow) => lyricsChanges(own, shard, shadow, stamp, !shadow), "lyrics");

  const lists = new Map(playlistsData().map((l) => [l.id, l]));
  const names = new Set([...[...lists.keys()].map((id) => `pl:${id}`), ...[...byName.keys()].filter((n) => n.startsWith("pl:"))]);
  for (const name of names) {
    const l = lists.get(name.slice(3));
    const list = l ? { ...l, items: l.items.filter((i) => !isLocalTrack(i.id)) } : null;
    add(name, (shadow, server) => (list || shadow ? playlistChanges(list, shadow ?? (list ? null : server), stamp, !shadow) : null), "playlist");
  }

  add("secrets", (shadow, server) => secretsChanges(friendSecret(), shadow, server, stamp), "secrets");
  return out.filter((p) => p.name && knownName(p.name));
}

/** The documents that differ from the server's, written (several at once in a batch); conflicts merged and retried. */
async function write(c: Creds, plans: Plan[]) {
  const s = state();
  const sealOf = (p: Plan) => {
    const d = s.docs[p.id];
    const doc = { ...p.merged, rev: Math.max(d?.rev ?? 0, p.merged.rev) + 1, by: s.tag };
    return { doc, data: sealDoc(c.dek, c.vault, p.id, JSON.stringify(doc), { compress: doc.kind !== "secrets" }) };
  };
  let todo = plans.filter((p) => !sameContent(p.merged, s.docs[p.id]?.server ?? null) && !(isEmpty(p.merged) && !s.docs[p.id]?.server));
  for (let attempt = 0; todo.length && attempt < 6; attempt++) {
    const sealed = todo.map((p) => ({ p, ...sealOf(p) }));
    const conflicts: { doc: string; version: number; data: string | null }[] = [];
    for (let i = 0; i < sealed.length; i += 40) {
      const part = sealed.slice(i, i + 40);
      let a: Answer;
      if (part.length === 1) {
        const x = part[0]!;
        a = await request("PUT", `/v1/vault/${c.vault}/docs/${x.p.id}`, { raw: x.data, headers: { ...c.headers, "if-match": `"${s.docs[x.p.id]?.version ?? 0}"` } });
        if (a.status === 409) conflicts.push({ doc: x.p.id, version: Number(a.body?.version), data: (a.body?.data as string | null) ?? null });
        else check(a);
        if (a.status === 200) done(x.p.id, x.p.name, x.doc, Number(a.body?.version));
      } else {
        a = await request("POST", `/v1/vault/${c.vault}/batch`, { json: { docs: part.map((x) => ({ doc: x.p.id, ifMatch: s.docs[x.p.id]?.version ?? 0, data: x.data.toString("base64") })) }, headers: c.headers, timeout: 60_000 });
        if (a.status === 409) conflicts.push(...(a.body?.conflicts as typeof conflicts));
        else check(a);
        if (a.status === 200) for (const x of part) done(x.p.id, x.p.name, x.doc, Number((a.body?.versions as Record<string, number>)[x.p.id]));
      }
    }
    if (!conflicts.length) return;
    // another device wrote first: its document is the new base, the same changes go over it
    const cap = capFor(Date.now() + s.offset);
    for (const k of conflicts) {
      const was = s.docs[k.doc];
      const doc = k.data ? readDoc(c, k.doc, k.data) : null;
      s.docs[k.doc] = { name: was?.name ?? doc?.name ?? "", version: k.version, server: doc, shadow: was?.shadow ?? null, rev: Math.max(was?.rev ?? 0, doc?.rev ?? 0) };
    }
    todo = todo
      .filter((p) => conflicts.some((k) => k.doc === p.id))
      .map((p) => {
        const server = s.docs[p.id]!.server;
        return { ...p, merged: mergeDocs(server ?? emptyDoc(p.merged.kind, p.name), p.changes ?? emptyDoc(p.merged.kind, p.name), cap) };
      })
      .filter((p) => !sameContent(p.merged, s.docs[p.id]!.server));
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  if (todo.length) throw new Error("other devices keep writing: will try again");

  function done(id: string, name: string, doc: Doc, version: number) {
    const was = s.docs[id];
    s.docs[id] = { name, version, server: doc, shadow: was?.shadow ?? null, rev: doc.rev };
  }
}

/** The merged documents into the modules (each only if nothing changed there while the sync ran). */
function apply(plans: Plan[], seen: typeof dirty): { likes: number; playlists: number; lyrics: number } {
  const s = state();
  const brought = { likes: 0, playlists: 0, lyrics: 0 };
  const docOf = (p: Plan) => s.docs[p.id]?.server ?? p.merged;
  const settle = (ps: Plan[]) => ps.forEach((p) => s.docs[p.id] && (s.docs[p.id]!.shadow = docOf(p)));

  const likesP = plans.filter((p) => p.name === "likes");
  if (seen.likes === dirty.likes && likesP[0]) {
    const before = likesData().liked.length;
    applyLikes(likesFrom(docOf(likesP[0])) as unknown as Parameters<typeof applyLikes>[0], isLocalTrack);
    brought.likes = Math.max(0, likesData().liked.length - before);
    settle(likesP);
  }
  const listP = plans.filter((p) => p.name.startsWith("pl:"));
  if (seen.playlists === dirty.playlists) {
    const here = new Map(playlistsData().map((l) => [l.id, l]));
    const next: LocalList[] = [];
    for (const p of listP) {
      const l = playlistFrom(docOf(p));
      if (!l) continue;
      // files from this computer stay in the playlist, after the rest
      const files = (here.get(l.id)?.items ?? []).filter((i) => isLocalTrack(i.id));
      next.push({ ...l, items: [...l.items, ...files] });
    }
    brought.playlists = Math.max(0, next.length - here.size);
    if (canon(next) !== canon([...here.values()])) applyPlaylists(next.sort((a, b) => a.created - b.created));
    settle(listP);
  }
  const lyricsP = plans.filter((p) => p.name.startsWith("lyrics:"));
  if (seen.lyrics === dirty.lyrics) {
    const before = Object.keys(ownLyricsData()).length;
    const all = Object.assign({}, ...lyricsP.map((p) => lyricsFrom(docOf(p)))) as ReturnType<typeof lyricsFrom>;
    if (canon(all) !== canon(ownLyricsData())) applyOwnLyrics(all);
    brought.lyrics = Math.max(0, Object.keys(all).length - before);
    settle(lyricsP);
  }
  const secretsP = plans.find((p) => p.name === "secrets");
  if (secretsP) {
    const friend = friendFrom(docOf(secretsP));
    if (friend && !friendSecret()) void adoptFriendSecret(friend);
    settle([secretsP]);
  }
  return brought;
}

let running: Promise<void> | null = null;
let again = false;

/** One sync now (or right after the one running). */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = run()
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "signed out" && msg !== "vault_has_account") {
        log("main", `sync: ${msg}`);
        setStatus({ state: e instanceof Offline ? "offline" : "error", error: msg });
      } else if (msg === "vault_has_account") setStatus({ state: "idle", error: null });
    })
    .finally(() => {
      running = null;
      saveState();
      if (again) {
        again = false;
        void syncNow();
      }
    });
  return running;
}

async function run() {
  if (!serverBase()) return;
  const s = state();
  // nobody here has a key yet: the first thing worth keeping makes one, as the backup did
  if (!creds() && !s.noAutoKey && !s.account && hasData()) setSecret("backupKey", formatCode(newCode()));
  const c = creds();
  if (!c) return;
  if (s.vault !== c.vault) resetDocs(c.vault);
  setStatus({ state: "syncing", error: null, accountLogin: null });
  let head = await request("GET", `/v1/vault/${c.vault}/head`, { headers: c.headers });
  if (head.status === 404 && c.write) {
    // a key's first sync: its vault is made (from its old backup, when there is one)
    check(await request("POST", "/v1/vault", { json: { id: c.vault, writeToken: c.write } }));
    head = await request("GET", `/v1/vault/${c.vault}/head`, { headers: c.headers });
  }
  check(head);
  const legacy = (head.body?.legacy as number | null) ?? null;
  // nothing applied here yet from this vault: what comes from it is news worth a line
  const first = !Object.values(s.docs).some((d) => d.shadow);
  await pull(c);
  await foldLegacy(c, legacy);
  matchPlaylists();
  const clock = new Clock(s.clock, s.offset);
  for (const d of Object.values(s.docs)) if (d.server) for (const at of stampsOf(d.server)) clock.see(at);
  const seen = { ...dirty };
  status.needsUpdate = false;
  const plans = plan(c, clock);
  await write(c, plans);
  s.clock = clock.last;
  const brought = apply(plans, seen);
  s.lastAt = Date.now();
  if (s.dropKeyAfterSync && s.account) {
    // the account synced: the transfer key is its recovery code now, and isn't kept on this computer any more
    setSecret("backupKey", null);
    s.dropKeyAfterSync = false;
  }
  saveState();
  setStatus({ state: "idle", error: null, signedOut: false, ...(first && (brought.likes || brought.playlists || brought.lyrics) ? { brought } : {}) });
  if (brought.likes || brought.playlists || brought.lyrics || plans.length) send(win(), "sync:changed", null);
  if (seen.likes !== dirty.likes || seen.playlists !== dirty.playlists || seen.lyrics !== dirty.lyrics) again = true;
}

const hasData = () => {
  const l = likesData();
  return l.liked.some((x) => !isLocalTrack(x.id)) || !!l.playlists?.length || playlistsData().length > 0 || Object.keys(ownLyricsData()).length > 0;
};

// ---- when ----------------------------------------------------------------------------------------------------------

let soon: ReturnType<typeof setTimeout> | null = null;
/** A change here: a sync after 3 s of quiet. */
function changed(kind: keyof typeof dirty) {
  dirty[kind]++;
  if (soon) clearTimeout(soon);
  soon = setTimeout(() => void syncNow(), DEBOUNCE_MS);
}

/** Anything new on the server? (A cheap question; the full sync only when the answer is yes.) */
async function poll() {
  if (running) return;
  const c = creds();
  if (!c) {
    // no key yet: one is made once there is something to keep
    if (!state().noAutoKey && !state().account && hasData()) await syncNow();
    return;
  }
  try {
    const s = state();
    const a = await request("GET", `/v1/vault/${c.vault}/head`, { headers: c.headers });
    if (a.status === 200 && s.vault === c.vault && a.body?.seq === s.seq && Number(a.body?.legacy ?? 0) <= s.legacyAt && status.state !== "error") return;
    await syncNow();
  } catch {
    /* offline: next time */
  }
}

/** A code (transfer key) typed on this computer: from now on it syncs with that vault, what's here added to it. */
export async function useCode(typed: string) {
  const clean = cleanCode(typed);
  if (!clean) throw new Error("A transfer key is 32 letters and digits");
  setSecret("backupKey", formatCode(clean));
  state().noAutoKey = false;
  await syncNow();
}

export function initSync(w: () => BrowserWindow | null) {
  win = w;
  if (!serverBase()) return;
  onLikesChange(() => changed("likes"));
  onPlaylistsChange(() => changed("playlists"));
  onOwnLyricsChange(() => changed("lyrics"));
  setTimeout(() => void syncNow(), 5000);
  let last = Date.now();
  setInterval(() => {
    const visible = win()?.isVisible() && !win()?.isMinimized();
    if (Date.now() - last < (visible ? POLL_MS : POLL_HIDDEN_MS) - 1000) return;
    last = Date.now();
    void poll();
  }, 15_000).unref();
  w()?.on("focus", () => {
    if (Date.now() - last < 15_000) return;
    last = Date.now();
    void poll();
  });
}
