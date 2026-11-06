/**
 * End-to-end check of the API against a running server: node test/smoke.ts [base]  (default http://127.0.0.1:8080).
 * Uses a throwaway data dir when you start the server for it (DATA_DIR=./data-test).
 */
import assert from "node:assert/strict";

const BASE = process.argv[2] ?? "http://127.0.0.1:8080";

async function api(method: string, path: string, opts: { secret?: string; admin?: string; body?: unknown; raw?: Buffer } = {}) {
  const headers: Record<string, string> = {};
  if (opts.secret) headers.authorization = `Bearer ${opts.secret}`;
  if (opts.admin) headers.authorization = `Admin ${opts.admin}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(BASE + path, { method, headers, body: opts.raw ? new Uint8Array(opts.raw) : (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
  const t = await r.text();
  return { status: r.status, body: t && r.headers.get("content-type")?.includes("json") ? JSON.parse(t) : t };
}

const track = { id: 123, title: "Orbit", artist: "ночная смена", artworkUrl: "https://i1.sndcdn.com/artworks-x-t500x500.jpg", permalinkUrl: "https://soundcloud.com/a/orbit", durationMs: 200000 };

const a = (await api("POST", "/v1/register", { body: { name: "sky" } })).body;
const b = (await api("POST", "/v1/register", { body: { name: "mira" } })).body;
assert.match(a.code, /^SKY-[2-9A-HJ-NP-Z]{5}$/);

// friends: a asks, b sees it, b accepts
assert.equal((await api("POST", "/v1/friends", { secret: a.secret, body: { code: b.code } })).body.outgoing.length, 1);
// a request doesn't reveal the name behind the code until it's accepted
assert.equal((await api("GET", "/v1/friends", { secret: a.secret })).body.outgoing[0].name, "");
assert.equal((await api("POST", "/v1/friends", { secret: a.secret, body: { code: a.code } })).status, 400);
assert.equal((await api("GET", "/v1/friends", { secret: b.secret })).body.incoming[0].name, "sky");
assert.equal((await api("POST", "/v1/send", { secret: a.secret, body: { to: [b.code], track } })).status, 403);
assert.equal((await api("POST", `/v1/friends/${a.code}/accept`, { secret: b.secret })).body.friends[0].code, a.code);

// a track goes over; b polls it, opens the chat, marks it heard; a sees the state
assert.equal((await api("POST", "/v1/send", { secret: a.secret, body: { to: [b.code], track: { ...track, artworkUrl: "https://evil.example/x.jpg" } } })).status, 400);
const sent = (await api("POST", "/v1/send", { secret: a.secret, body: { to: [b.code], track } })).body;
const up = (await api("GET", "/v1/updates?since=0&v=-1", { secret: b.secret })).body;
assert.equal(up.messages[0].track.title, "Orbit");
assert.equal(up.unread[a.code], 1);
assert.ok(up.friends);
assert.equal((await api("GET", `/v1/updates?since=${up.messages[0].id}&v=${up.friends.v}`, { secret: b.secret })).body.friends, undefined);
assert.equal((await api("GET", `/v1/chat/${a.code}`, { secret: b.secret })).body.messages.length, 1);
await api("POST", `/v1/chat/${a.code}/seen`, { secret: b.secret });
assert.equal((await api("POST", `/v1/messages/${sent.ids[0]}/state`, { secret: b.secret, body: { state: "heard" } })).status, 204);
assert.equal((await api("POST", `/v1/messages/${sent.ids[0]}/state`, { secret: a.secret, body: { state: "heard" } })).status, 404);
assert.equal((await api("GET", "/v1/updates?since=0", { secret: a.secret })).body.states[sent.ids[0]], "heard");

// a playlist from a's computer: its name and ids ride along, the first track stands in for older apps; b saves it
assert.equal((await api("POST", "/v1/send", { secret: a.secret, body: { to: [b.code], track, playlist: { title: "Night", ids: [] } } })).status, 400);
assert.equal((await api("POST", "/v1/send", { secret: a.secret, body: { to: [b.code], track, playlist: { title: "Night", ids: [1, "x"] } } })).status, 400);
const plSent = (await api("POST", "/v1/send", { secret: a.secret, body: { to: [b.code], track, playlist: { title: "Night", ids: [track.id, 7, 7, 9] } } })).body;
const plMsg = (await api("GET", `/v1/chat/${a.code}`, { secret: b.secret })).body.messages.at(-1);
assert.deepEqual(plMsg.playlist, { title: "Night", ids: [track.id, 7, 9] });
assert.equal(plMsg.track.title, "Orbit");
assert.equal((await api("GET", `/v1/chat/${a.code}`, { secret: b.secret })).body.messages[0].playlist, undefined);
assert.equal((await api("POST", `/v1/messages/${plSent.ids[0]}/state`, { secret: b.secret, body: { state: "saved" } })).status, 204);
assert.equal((await api("POST", `/v1/messages/${plSent.ids[0]}/state`, { secret: b.secret, body: { state: "heard" } })).status, 204);
assert.equal((await api("GET", "/v1/updates?since=0", { secret: a.secret })).body.states[plSent.ids[0]], "saved");

// lyrics people made: sent, waiting, approved by the moderator, shown to everyone with the maker's name
const lrc = "[00:01.00] first line\n[00:04.50] second line";
assert.equal((await api("POST", "/v1/lyrics", { secret: a.secret, body: { track: 555, title: "Orbit", artist: "Sky", durationMs: 1000, lrc: "no times here" } })).status, 400);
assert.equal((await api("POST", "/v1/lyrics", { body: { track: 555, title: "Orbit", artist: "Sky", lrc } })).status, 401);
const sug = (await api("POST", "/v1/lyrics", { secret: a.secret, body: { track: 555, title: "Orbit", artist: "Sky", durationMs: 1000, lrc } })).body;
assert.equal(sug.status, "pending");
assert.equal((await api("GET", "/v1/lyrics/555")).status, 404);
assert.equal((await api("GET", "/v1/lyrics/mine?track=555", { secret: a.secret })).body.status, "pending");
assert.equal((await api("GET", "/v1/admin/lyrics", { secret: a.secret })).status, 404);
const ADMIN = process.env.ADMIN_TOKEN;
if (ADMIN) {
  const queue = (await api("GET", "/v1/admin/lyrics", { admin: ADMIN })).body.lyrics;
  assert.equal(queue.at(-1).by, "sky");
  assert.equal((await api("POST", `/v1/admin/lyrics/${sug.id}/approve`, { admin: ADMIN })).status, 204);
  const shown = (await api("GET", "/v1/lyrics/555")).body;
  assert.equal(shown.by, "sky");
  assert.equal(shown.lrc, lrc);
  assert.equal((await api("GET", "/v1/lyrics/mine?track=555", { secret: a.secret })).body.status, "approved");
  // a second version: rejected, the approved one stays
  const second = (await api("POST", "/v1/lyrics", { secret: b.secret, body: { track: 555, title: "Orbit", artist: "Sky", lrc: "[00:02] x\n[00:03] y" } })).body;
  assert.equal((await api("POST", `/v1/admin/lyrics/${second.id}/reject`, { admin: ADMIN })).status, 204);
  assert.equal((await api("GET", "/v1/lyrics/555")).body.lrc, lrc);
  assert.equal((await api("GET", "/v1/lyrics/mine?track=555", { secret: b.secret })).body.status, "rejected");
}

// listening now, only when shared
await api("PUT", "/v1/me/now", { secret: a.secret, body: { track } });
assert.deepEqual((await api("GET", "/v1/updates", { secret: b.secret })).body.now, {});
await api("PUT", "/v1/me", { secret: a.secret, body: { shareNow: true } });
await api("PUT", "/v1/me/now", { secret: a.secret, body: { track } });
assert.equal((await api("GET", "/v1/updates", { secret: b.secret })).body.now[a.code].title, "Orbit");

// counter
assert.equal((await api("POST", "/v1/ping", { body: { install: "abcdef12-3456", version: "2.0.0-beta.7" } })).status, 204);
assert.ok((await api("GET", "/v1/stats")).body.today >= 1);
assert.equal((await api("POST", "/v1/online", { body: { install: "abcdef12-3456" } })).status, 204);
assert.equal((await api("POST", "/v1/online", { body: { install: "no good!" } })).status, 400);

// backups: sealed bytes by a name, written only with the token that made them
{
  const id = "a".repeat(64);
  const put = (token: string, raw: Buffer) => fetch(BASE + "/v1/backup/" + id, { method: "PUT", headers: { "x-backup-write": token }, body: new Uint8Array(raw) });
  const blob = Buffer.concat([Buffer.from("SCB1"), Buffer.alloc(60, 7)]);
  assert.equal((await fetch(BASE + "/v1/backup/" + id)).status, 404);
  assert.equal((await put("b".repeat(64), Buffer.from("not a backup at all, really not one"))).status, 400);
  assert.equal((await put("b".repeat(64), blob)).status, 204);
  assert.equal((await put("c".repeat(64), blob)).status, 403);
  const got = Buffer.from(await (await fetch(BASE + "/v1/backup/" + id)).arrayBuffer());
  assert.ok(got.equals(blob));
}

// workshop
const look = { design: "studio", bg: "file", bgBlur: 10, bgDim: 60, bgReact: 30, panelOpacity: 50, panelBlur: 24, accent: "#aabbcc" };
assert.equal((await api("POST", "/v1/themes", { secret: a.secret, body: { name: "x", look, css: "body{background:url(https://evil)}" } })).status, 400);
assert.equal((await api("POST", "/v1/themes", { secret: a.secret, body: { name: "x", look, css: "@im\\70ort 'x';" } })).status, 400);
const th = (await api("POST", "/v1/themes", { secret: a.secret, body: { name: "Night drive", description: "calm", look, css: ".panel{border-radius:4px}" } })).body;
assert.equal((await api("GET", "/v1/themes")).body.themes.length, 0, "unpublished until it has a preview");
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex");
assert.equal((await api("PUT", `/v1/themes/${th.id}/preview`, { secret: b.secret, raw: png })).status, 403);
assert.equal((await api("PUT", `/v1/themes/${th.id}/background`, { secret: a.secret, raw: Buffer.from("<svg/>") })).status, 415);
assert.equal((await api("PUT", `/v1/themes/${th.id}/background`, { secret: a.secret, raw: png })).status, 204);
assert.equal((await api("PUT", `/v1/themes/${th.id}/preview`, { secret: a.secret, raw: png })).status, 204);
const list = (await api("GET", "/v1/themes?sort=top", { secret: b.secret })).body;
assert.equal(list.themes[0].name, "Night drive");
assert.equal(list.themes[0].background, "image/png");
assert.equal((await api("GET", `/v1/themes/${th.id}`)).body.look.accent, "#aabbcc");
const file = await fetch(`${BASE}/v1/themes/${th.id}/preview`);
assert.equal(file.headers.get("content-type"), "image/png");
assert.equal((await api("POST", `/v1/themes/${th.id}/like`, { secret: b.secret })).body.liked, true);
assert.equal((await api("POST", `/v1/themes/${th.id}/like`, { secret: b.secret })).body.liked, false);
await api("POST", `/v1/themes/${th.id}/install`, { secret: b.secret });
assert.equal((await api("POST", `/v1/themes/${th.id}/install`, { secret: b.secret })).body.installs, 1);

// three reports hide it
const c = (await api("POST", "/v1/register", { body: {} })).body;
const d = (await api("POST", "/v1/register", { body: {} })).body;
for (const s of [b, c, d]) await api("POST", `/v1/themes/${th.id}/report`, { secret: s.secret, body: { reason: "test" } });
assert.equal((await api("GET", "/v1/themes")).body.themes.length, 0);
if (process.env.ADMIN_TOKEN) {
  assert.equal((await api("GET", "/v1/admin/themes", { admin: process.env.ADMIN_TOKEN })).body.themes[0].reports, 3);
  await api("POST", `/v1/admin/themes/${th.id}/keep`, { admin: process.env.ADMIN_TOKEN });
  assert.equal((await api("GET", "/v1/themes")).body.themes.length, 1);
}
assert.equal((await api("GET", "/v1/admin/themes", { admin: "wrong-token-wrong-token-wrong" })).status, 404);

// what sc player is playing: anonymous ids, newest first, counted per day
assert.equal((await api("POST", "/v1/listening", { body: { id: 555 } })).status, 204);
assert.equal((await api("POST", "/v1/listening", { body: { id: 777 } })).status, 204);
assert.equal((await api("POST", "/v1/listening", { body: { id: 555 } })).status, 204);
assert.equal((await api("POST", "/v1/listening", { body: { id: "x" } })).status, 400);
const playing = (await api("GET", "/v1/listening")).body.tracks;
assert.deepEqual(
  playing.map((x: { id: number; plays: number }) => [x.id, x.plays]),
  [
    [555, 2],
    [777, 1],
  ],
);

// leaving removes everything
assert.equal((await api("DELETE", "/v1/me", { secret: a.secret })).status, 204);
assert.equal((await api("GET", "/v1/friends", { secret: b.secret })).body.friends.length, 0);
assert.equal((await api("GET", `/v1/themes/${th.id}`)).status, 404);
assert.equal((await api("GET", "/v1/me", { secret: a.secret })).status, 401);

// ---- sync and accounts: the app's own crypto against the server -----------------------------------------------------
{
  const { argon2Sync } = await import("node:crypto");
  const k = await import("../../../src/main/sync/crypto.ts");
  const argon2: import("../../../src/main/sync/crypto.ts").Argon2 = async (pw, salt, kdf) => argon2Sync("argon2id", { message: pw, nonce: salt, parallelism: 1, tagLength: 32, memory: kdf.m, passes: kdf.t });
  const req = async (method: string, path: string, o: { write?: string; session?: string; body?: unknown; raw?: Buffer; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...o.headers };
    if (o.write) headers["x-vault-write"] = o.write;
    if (o.session) headers["x-account-session"] = o.session;
    if (o.body !== undefined) headers["content-type"] = "application/json";
    const r = await fetch(BASE + path, { method, headers, body: o.raw ? new Uint8Array(o.raw) : o.body !== undefined ? JSON.stringify(o.body) : undefined });
    const t = await r.text();
    return { status: r.status, body: t && r.headers.get("content-type")?.includes("json") ? JSON.parse(t) : t };
  };
  const b64 = (x: Uint8Array) => Buffer.from(x).toString("base64");

  // a vault by a code alone; the token decides who writes
  const A = k.codeKeys(k.newCode());
  assert.equal((await req("POST", "/v1/vault", { body: { id: A.vaultId, writeToken: A.writeToken } })).status, 201);
  assert.equal((await req("POST", "/v1/vault", { body: { id: A.vaultId, writeToken: A.writeToken } })).status, 200);
  assert.equal((await req("POST", "/v1/vault", { body: { id: A.vaultId, writeToken: "0".repeat(64) } })).status, 403);
  const V = `/v1/vault/${A.vaultId}`;
  assert.equal((await req("GET", `${V}/head`)).status, 401);
  assert.equal((await req("GET", `${V}/head`, { write: "0".repeat(64) })).status, 403);
  assert.equal((await req("GET", `${V}/head`, { write: A.writeToken })).body.seq, 0);

  // documents: If-Match decides, a conflict brings the current one back
  const likesId = k.docId(A.dek, "likes");
  const seal = (json: string) => k.sealDoc(A.dek, A.vaultId, likesId, json, { compress: true });
  const put = (raw: Buffer, h: Record<string, string>) => req("PUT", `${V}/docs/${likesId}`, { write: A.writeToken, raw, headers: h });
  assert.equal((await put(Buffer.from("SCB1 not a sync document at all, no"), { "if-none-match": "*" })).status, 400);
  assert.equal((await put(seal('{"v":1}'), {})).status, 428);
  assert.equal((await put(seal('{"v":1}'), { "if-none-match": "*" })).body.version, 1);
  const lost = await put(seal('{"v":1,"x":2}'), { "if-match": '"0"' });
  assert.equal(lost.status, 409);
  assert.equal(lost.body.version, 1);
  assert.equal(k.openDoc(A.dek, A.vaultId, likesId, Buffer.from(lost.body.data, "base64")), '{"v":1}');
  assert.equal((await put(seal('{"v":1,"x":2}'), { "if-match": '"1"' })).body.version, 2);
  let ch = (await req("GET", `${V}/changes?since=0`, { write: A.writeToken })).body;
  assert.equal(ch.docs.length, 1);
  assert.equal(ch.seq, 2);
  assert.equal(k.openDoc(A.dek, A.vaultId, likesId, Buffer.from(ch.docs[0].data, "base64")), '{"v":1,"x":2}');
  assert.equal((await req("GET", `${V}/changes?since=2`, { write: A.writeToken })).body.docs.length, 0);

  // a batch is all or nothing
  const p1 = k.docId(A.dek, "pl:local-0000000000000001");
  const p2 = k.docId(A.dek, "pl:local-0000000000000002");
  const sealAs = (id: string) => b64(k.sealDoc(A.dek, A.vaultId, id, "{}", { compress: false }));
  const bad = await req("POST", `${V}/batch`, { write: A.writeToken, body: { docs: [{ doc: p1, ifMatch: 0, data: sealAs(p1) }, { doc: likesId, ifMatch: 1, data: sealAs(likesId) }] } });
  assert.equal(bad.status, 409);
  assert.equal(bad.body.conflicts[0].doc, likesId);
  assert.equal((await req("GET", `${V}/head`, { write: A.writeToken })).body.seq, 2);
  const ok = await req("POST", `${V}/batch`, { write: A.writeToken, body: { docs: [{ doc: p1, ifMatch: 0, data: sealAs(p1) }, { doc: p2, ifMatch: 0, data: sealAs(p2) }] } });
  assert.deepEqual(ok.body.versions, { [p1]: 3, [p2]: 4 });
  // deleting leaves a note in the changes
  assert.equal((await req("DELETE", `${V}/docs/${p2}`, { write: A.writeToken, headers: { "if-match": '"4"' } })).body.version, 5);
  ch = (await req("GET", `${V}/changes?since=4`, { write: A.writeToken })).body;
  assert.deepEqual(ch.docs, [{ doc: p2, version: 5, data: null }]);

  // an old backup becomes the vault of the same key; it says when the old copy last changed
  const B = k.codeKeys(k.newCode());
  const blob = Buffer.concat([Buffer.from("SCB1"), Buffer.alloc(60, 9)]);
  assert.equal((await fetch(`${BASE}/v1/backup/${B.vaultId}`, { method: "PUT", headers: { "x-backup-write": B.writeToken }, body: new Uint8Array(blob) })).status, 204);
  assert.equal((await req("POST", "/v1/vault", { body: { id: B.vaultId, writeToken: A.writeToken } })).status, 403);
  const vb = (await req("POST", "/v1/vault", { body: { id: B.vaultId, writeToken: B.writeToken } })).body;
  assert.equal(vb.created, true);
  assert.ok(vb.legacy > 0);

  // accounts: prelogin answers the same for a login that doesn't exist (and its salt doesn't change)
  const login = `smoke${Date.now().toString(36)}`;
  const pre1 = (await req("POST", "/v1/account/prelogin", { body: { login } })).body;
  const pre2 = (await req("POST", "/v1/account/prelogin", { body: { login } })).body;
  assert.equal(pre1.salt, pre2.salt);
  assert.deepEqual(pre1.kdf, k.KDF_V1);
  assert.equal((await req("GET", `/v1/account/available?login=${login}`)).body.free, true);
  assert.equal((await req("GET", "/v1/account/available?login=admin")).status, 400);

  // sign-up over the key's vault: the key alone opens it no more (423 says whose it is)
  const salt = Buffer.alloc(16, 1);
  const kdf = { ...k.KDF_V1, m: 19456, t: 2 }; // the floor: quick for a test
  const pw = await k.passwordKeys("correct horse battery", salt, kdf, argon2);
  const wrapped = k.wrapDek(pw.kek, A.dek, A.vaultId);
  const signUp = (l: string, v = A) =>
    req("POST", "/v1/account", { body: { login: l, kdf, salt: b64(salt), authKey: b64(pw.authKey), wrappedKey: b64(wrapped), vault: { id: v.vaultId, writeToken: v.writeToken }, device: { name: "Smoke PC", platform: "windows" } } });
  assert.equal((await req("POST", "/v1/account", { body: { login, kdf: { ...kdf, m: 1024 }, salt: b64(salt), authKey: b64(pw.authKey), wrappedKey: b64(wrapped), vault: { id: A.vaultId, writeToken: A.writeToken } } })).status, 400);
  const acc = await signUp(login);
  assert.equal(acc.status, 201);
  assert.equal((await signUp(login)).body.error, "login_taken");
  assert.equal((await signUp(`${login}x`)).body.error, "vault_bound");
  const locked = await req("GET", `${V}/head`, { write: A.writeToken });
  assert.equal(locked.status, 423);
  assert.equal(locked.body.login, login);
  assert.equal((await req("GET", `${V}/head`, { session: acc.body.session })).body.seq, 5);
  assert.equal((await req("GET", `/v1/vault/${B.vaultId}/head`, { session: acc.body.session })).status, 410);

  // signing in: the wrapped key opens with the password's key
  const prelogin = (await req("POST", "/v1/account/prelogin", { body: { login: login.toUpperCase() } })).body;
  assert.equal(prelogin.salt, b64(salt));
  const signIn = (authKey: Buffer, cookie?: string) => req("POST", "/v1/account/login", { body: { login, authKey: b64(authKey), deviceCookie: cookie, device: { name: "Phone", platform: "android" } } });
  assert.equal((await signIn(Buffer.alloc(32, 7))).status, 401);
  const inn = (await signIn(pw.authKey)).body;
  assert.equal(inn.vaultId, A.vaultId);
  assert.ok(k.unwrapDek(pw.kek, Buffer.from(inn.wrappedKey, "base64"), inn.vaultId)!.equals(A.dek));
  const me = (await req("GET", "/v1/account", { session: inn.session })).body;
  assert.equal(me.sessions.length, 2);
  assert.equal(me.sessions.find((s: { current: boolean }) => s.current).name, "Phone");

  // a new password: the same data key under a new wrapping; other devices signed out
  const salt2 = Buffer.alloc(16, 2);
  const pw2 = await k.passwordKeys("another long passphrase", salt2, kdf, argon2);
  const change = (proof: unknown) =>
    req("POST", "/v1/account/password", { session: inn.session, body: { proof, kdf, salt: b64(salt2), authKey: b64(pw2.authKey), wrappedKey: b64(k.wrapDek(pw2.kek, A.dek, A.vaultId)), signOutOthers: true } });
  assert.equal((await change({ authKey: b64(Buffer.alloc(32)) })).status, 401);
  assert.equal((await change({ authKey: b64(pw.authKey) })).status, 204);
  assert.equal((await req("GET", "/v1/account", { session: acc.body.session })).status, 401);
  assert.equal((await signIn(pw.authKey)).status, 401);
  const again = (await signIn(pw2.authKey)).body;
  assert.ok(k.unwrapDek(pw2.kek, Buffer.from(again.wrappedKey, "base64"), A.vaultId)!.equals(A.dek));

  // guessing: 5 tries, then the login waits — but a device that signed in before (its cookie) does not
  for (let i = 0; i < 5; i++) assert.equal((await signIn(Buffer.alloc(32, i))).status, 401);
  const slow = await signIn(pw2.authKey);
  assert.equal(slow.status, 429);
  assert.ok(slow.body.retryAfter > 0);
  assert.equal((await signIn(pw2.authKey, again.deviceCookie)).status, 200);

  // forgot the password: the recovery code is enough (no login), everyone else is signed out
  const salt3 = Buffer.alloc(16, 3);
  const pw3 = await k.passwordKeys("third time lucky ok", salt3, kdf, argon2);
  const rec = await req("POST", "/v1/account/recover", {
    body: { vaultId: A.vaultId, writeToken: A.writeToken, kdf, salt: b64(salt3), authKey: b64(pw3.authKey), wrappedKey: b64(k.wrapDek(pw3.kek, A.dek, A.vaultId)), device: { name: "New PC" } },
  });
  assert.equal(rec.body.login, login);
  assert.equal((await req("GET", "/v1/account", { session: again.session })).status, 401);
  assert.equal((await req("POST", "/v1/account/recover", { body: { vaultId: B.vaultId, writeToken: B.writeToken, kdf, salt: b64(salt3), authKey: b64(pw3.authKey), wrappedKey: b64(wrapped) } })).body.error, "no_account");
  assert.equal((await signIn(pw3.authKey)).status, 200);

  // an account over an old backup: its name alone no longer opens the copy
  const accB = await signUp(`${login}b`, B);
  assert.equal(accB.status, 201);
  assert.equal((await fetch(`${BASE}/v1/backup/${B.vaultId}`)).status, 404);
  assert.equal((await fetch(`${BASE}/v1/backup/${B.vaultId}`, { headers: { "x-backup-write": B.writeToken } })).status, 200);

  // deleting the account takes its vault along
  assert.equal((await req("DELETE", "/v1/account", { session: accB.body.session, body: { proof: { writeToken: B.writeToken } } })).status, 204);
  assert.equal((await req("POST", "/v1/vault", { body: { id: B.vaultId, writeToken: B.writeToken } })).status, 201);
  assert.equal((await req("POST", "/v1/account/logout", { session: rec.body.session })).status, 204);
  assert.equal((await req("GET", `${V}/head`, { session: rec.body.session })).status, 401);
}

console.log("smoke: all good");
