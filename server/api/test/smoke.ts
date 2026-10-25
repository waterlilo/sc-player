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

// listening now, only when shared
await api("PUT", "/v1/me/now", { secret: a.secret, body: { track } });
assert.deepEqual((await api("GET", "/v1/updates", { secret: b.secret })).body.now, {});
await api("PUT", "/v1/me", { secret: a.secret, body: { shareNow: true } });
await api("PUT", "/v1/me/now", { secret: a.secret, body: { track } });
assert.equal((await api("GET", "/v1/updates", { secret: b.secret })).body.now[a.code].title, "Orbit");

// counter
assert.equal((await api("POST", "/v1/ping", { body: { install: "abcdef12-3456", version: "2.0.0-beta.7" } })).status, 204);
assert.ok((await api("GET", "/v1/stats")).body.today >= 1);

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

console.log("smoke: all good");
