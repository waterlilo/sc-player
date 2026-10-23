/**
 * Listening rooms end to end, against a server this test starts itself (a throwaway data dir, a free port):
 * node test/rooms-live.ts
 *
 * Friends, an invitation through /v1/updates, joining, the event streams; then a crowd of made-up clients whose clocks
 * are off by up to ±5 s and whose connections drop at random: each measures the server's clock like the app does and
 * must work out the same place in the track as everyone else (within 60 ms), and a pause from anyone must reach all.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = await new Promise<number>((resolve) => {
  const s = createServer().listen(0, () => {
    const p = (s.address() as { port: number }).port;
    s.close(() => resolve(p));
  });
});
const data = mkdtempSync(join(tmpdir(), "sc-rooms-"));
const server = spawn(process.execPath, ["src/main.ts"], { env: { ...process.env, PORT: String(port), DATA_DIR: data, TRUST_PROXY: "1" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise<void>((resolve) => server.stdout!.on("data", (b: Buffer) => String(b).includes("api on") && resolve()));
const BASE = `http://127.0.0.1:${port}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FEATURES = { "x-sc-features": "rooms" };

async function api(method: string, path: string, secret?: string, body?: unknown, ip = "10.0.0.1") {
  // registrations are limited per address (5 an hour): each made-up device comes from its own
  const headers: Record<string, string> = { ...FEATURES, "x-forwarded-for": ip };
  if (secret) headers.authorization = `Bearer ${secret}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}

type View = { version: number; now: number; host: string; position: number; at: number; playing: boolean; by: string; track: { id: number } | null; members: { code: string; here: boolean }[]; queue: unknown[]; suggestions: { uid: string }[] };

/** A made-up app: a skewed clock, the server's clock measured like the app does, the room from its event stream. */
class Client {
  room: View | null = null;
  closed = false;
  offset = 0;
  private stop: AbortController | null = null;
  readonly secret: string;
  readonly code: string;
  /** how far this machine's clock is off */
  readonly skew: number;
  constructor(secret: string, code: string, skew: number) {
    this.secret = secret;
    this.code = code;
    this.skew = skew;
  }
  clock = () => Date.now() + this.skew;
  /** median of five round trips, as the app does */
  async sync() {
    const offs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = this.clock();
      const { now } = (await api("GET", "/v1/rooms/time")).body as { now: number };
      const t1 = this.clock();
      offs.push(now - (t0 + t1) / 2);
    }
    this.offset = offs.sort((a, b) => a - b)[2]!;
  }
  /** where the track is, by this app's reckoning */
  position() {
    const r = this.room!;
    return r.playing ? r.position + (this.clock() + this.offset - r.at) / 1000 : r.position;
  }
  listen(id: string) {
    this.stop = new AbortController();
    const signal = this.stop.signal;
    void (async () => {
      try {
        const res = await fetch(`${BASE}/v1/rooms/${id}/events`, { headers: { ...FEATURES, authorization: `Bearer ${this.secret}` }, signal });
        const reader = res.body!.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let cut: number;
          while ((cut = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, cut);
            buf = buf.slice(cut + 2);
            const event = /^event: (.+)$/m.exec(block)?.[1];
            const dataLine = /^data: (.+)$/m.exec(block)?.[1];
            if (event === "closed") this.closed = true;
            if (event === "room" && dataLine) {
              const v = JSON.parse(dataLine) as View;
              // an older snapshot never replaces a newer one
              if (!this.room || v.version >= this.room.version) this.room = v;
            }
          }
        }
      } catch {
        /* dropped on purpose */
      }
    })();
  }
  drop() {
    this.stop?.abort();
  }
}

async function device(name: string, skew: number) {
  const r = (await api("POST", "/v1/register", undefined, { name }, `10.1.0.${Math.floor(Math.random() * 250)}`)).body as { code: string; secret: string };
  await api("GET", "/v1/me", r.secret);
  return new Client(r.secret, r.code, skew);
}

const until = async (what: string, ok: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await sleep(20);
  }
};

try {
  const host = await device("host", 0);
  const crowd = await Promise.all(Array.from({ length: 7 }, (_, i) => device(`m${i}`, Math.round((Math.random() * 2 - 1) * 5000))));
  // friends with the host
  for (const m of crowd) {
    await api("POST", "/v1/friends", host.secret, { code: m.code });
    await api("POST", `/v1/friends/${host.code}/accept`, m.secret);
  }
  const friends = (await api("GET", "/v1/friends", host.secret)).body as { friends: { code: string; rooms: boolean }[] };
  assert.ok(friends.friends.every((f) => f.rooms), "friends' apps say they can do rooms");

  const track = (id: number, s = 300) => ({ id, title: `t${id}`, artist: "a", artworkUrl: null, permalinkUrl: `https://soundcloud.com/a/t${id}`, durationMs: s * 1000 });
  const room = (await api("POST", "/v1/rooms", host.secret, { startTogether: false, track: track(1), position: 12 })).body as View & { id: string };
  assert.equal(room.host, host.code);
  const invited = await api("POST", `/v1/rooms/${room.id}/invite`, host.secret, { to: crowd.map((m) => m.code) });
  assert.equal(invited.status, 200, JSON.stringify(invited.body));

  // the invitation arrives with the usual poll; joining
  const up = (await api("GET", "/v1/updates?since=0&v=-1", crowd[0]!.secret)).body as { invites: { room: string; name: string }[] };
  assert.equal(up.invites[0]!.room, room.id);
  assert.equal(up.invites[0]!.name, "host");
  assert.equal((await api("POST", `/v1/rooms/${room.id}/join`, "x".repeat(30))).status, 401);
  for (const m of crowd) assert.equal((await api("POST", `/v1/rooms/${room.id}/join`, m.secret)).status, 200);

  const all = [host, ...crowd];
  await Promise.all(all.map((c) => c.sync()));
  for (const c of all) c.listen(room.id);
  await until("everyone gets the room", () => all.every((c) => c.room?.members.length === 8 && c.room.members.every((m) => m.here)));

  // everyone works out the same place in the track, whatever their clock says
  const spread = () => {
    const ps = all.map((c) => c.position());
    return Math.max(...ps) - Math.min(...ps);
  };
  assert.ok(spread() < 0.06, `positions agree (spread ${spread().toFixed(3)} s)`);

  // a member pauses for everyone; the change reaches all within a moment
  const t0 = Date.now();
  await api("POST", `/v1/rooms/${room.id}/do`, crowd[3]!.secret, { op: "playing", playing: false });
  await until("the pause reaches all", () => all.every((c) => c.room?.playing === false && c.room.by === crowd[3]!.code));
  const reach = Date.now() - t0;
  assert.ok(spread() < 0.001, "paused: one place for all");

  // connections drop and come back at random while the host plays on; nobody's room goes stale
  await api("POST", `/v1/rooms/${room.id}/do`, host.secret, { op: "playing", playing: true });
  for (let round = 0; round < 10; round++) {
    const m = crowd[Math.floor(Math.random() * crowd.length)]!;
    m.drop();
    await api("POST", `/v1/rooms/${room.id}/do`, host.secret, { op: "seek", position: 30 + round * 5 });
    await sleep(30);
    m.listen(room.id);
  }
  await api("POST", `/v1/rooms/${room.id}/do`, host.secret, { op: "play", track: track(2), position: 0 });
  await until("after the drops everyone has the latest room", () => all.every((c) => c.room?.track?.id === 2));
  assert.ok(spread() < 0.06, `positions agree after the drops (spread ${spread().toFixed(3)} s)`);

  // a member can't pick tracks; suggests instead; the host takes it
  assert.equal((await api("POST", `/v1/rooms/${room.id}/do`, crowd[1]!.secret, { op: "play", track: track(3) })).status, 403);
  await api("POST", `/v1/rooms/${room.id}/do`, crowd[1]!.secret, { op: "suggest", track: track(3) });
  await until("the host sees the suggestion", () => host.room?.suggestions.length === 1);
  await api("POST", `/v1/rooms/${room.id}/do`, host.secret, { op: "decide", item: host.room!.suggestions[0]!.uid, take: true });
  await until("everyone sees the queue", () => all.every((c) => c.room?.queue.length === 1));

  // the host leaves: the first to join takes over, the room plays on
  await api("POST", `/v1/rooms/${room.id}/leave`, host.secret);
  await until("a new host for everyone", () => crowd.every((c) => c.room?.host === crowd[0]!.code));
  assert.equal(crowd[0]!.room!.track!.id, 2);

  // the last one out closes the room; the streams say so
  for (const m of crowd) await api("POST", `/v1/rooms/${room.id}/leave`, m.secret);
  await until("the room is closed", () => crowd.every((c) => c.closed));
  assert.equal((await api("GET", `/v1/rooms/${room.id}`, crowd[0]!.secret)).status, 404);

  console.log(`rooms: ok — 8 apps, clocks off by up to ±5 s agree within 60 ms; a pause reached all in ${reach} ms`);
  for (const c of all) c.drop();
} finally {
  server.kill();
  await sleep(200);
  rmSync(data, { recursive: true, force: true });
}
