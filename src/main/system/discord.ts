import { connect, type Socket } from "node:net";
import type { PlayerInfo } from "@shared/ipc";
import { artwork, isLocalTrack } from "@shared/types";
import { log } from "./log";

/**
 * "Listening to sc player" on the Discord profile (Settings → Notifications): the track, artist, cover and time, sent
 * to the Discord app on this computer over its local pipe — nothing goes through sc player's server. Discord closed or
 * started later: tried again every 15 s, quietly. Paused or stopped: the status is cleared, as music apps do.
 */
const CLIENT_ID = "1565037878671843408";
const RETRY_MS = 15_000;
// Discord takes about five activity updates per 20 s; a burst (skipping through tracks) sends only the last one
const MIN_GAP_MS = 4_000;

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

let enabled = false;
let socket: Socket | null = null;
let ready = false;
let connecting = false;
let retry: NodeJS.Timeout | null = null;
let wanted: object | null = null;
let sentKey: string | null = null;
let lastSend = 0;
let later: NodeJS.Timeout | null = null;
let nonce = 0;

function frame(op: number, payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload));
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** Discord listens on discord-ipc-0, or the next free number when several Discord builds run. */
function openPipe(n = 0): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(`\\\\?\\pipe\\discord-ipc-${n}`);
    s.once("connect", () => resolve(s));
    s.once("error", (err) => {
      s.destroy();
      if (n < 9) openPipe(n + 1).then(resolve, reject);
      else reject(err);
    });
  });
}

async function open() {
  if (!enabled || socket || connecting) return;
  connecting = true;
  try {
    const s = await openPipe();
    if (!enabled) {
      s.destroy();
      return;
    }
    socket = s;
    let buf = Buffer.alloc(0);
    s.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 8) {
        const op = buf.readInt32LE(0);
        const len = buf.readInt32LE(4);
        if (buf.length < 8 + len) break;
        const body = buf.subarray(8, 8 + len).toString("utf8");
        buf = buf.subarray(8 + len);
        onMessage(op, body);
      }
    });
    s.on("error", () => undefined);
    s.on("close", () => {
      if (socket === s) drop();
    });
    s.write(frame(OP_HANDSHAKE, { v: 1, client_id: CLIENT_ID }));
  } catch {
    scheduleRetry();
  } finally {
    connecting = false;
  }
}

function onMessage(op: number, body: string) {
  if (op === OP_PING) {
    socket?.write(frame(OP_PONG, JSON.parse(body)));
    return;
  }
  if (op === OP_CLOSE) {
    log("main", `discord: closed: ${body.slice(0, 200)}`);
    socket?.destroy();
    return;
  }
  let msg: { cmd?: string; evt?: string; data?: { message?: string } };
  try {
    msg = JSON.parse(body);
  } catch {
    return;
  }
  if (msg.cmd === "DISPATCH" && msg.evt === "READY") {
    ready = true;
    sentKey = null;
    flush();
  } else if (msg.evt === "ERROR") {
    log("main", `discord: ${msg.cmd}: ${msg.data?.message ?? "error"}`);
  }
}

function drop() {
  socket = null;
  ready = false;
  sentKey = null;
  scheduleRetry();
}

function scheduleRetry() {
  if (!enabled || retry) return;
  retry = setTimeout(() => {
    retry = null;
    void open();
  }, RETRY_MS);
}

function flush() {
  if (!ready || !socket) return;
  const key = JSON.stringify(wanted);
  if (key === sentKey) return;
  const wait = lastSend + MIN_GAP_MS - Date.now();
  if (wait > 0) {
    later ??= setTimeout(() => {
      later = null;
      flush();
    }, wait);
    return;
  }
  lastSend = Date.now();
  sentKey = key;
  socket.write(frame(OP_FRAME, { cmd: "SET_ACTIVITY", args: { pid: process.pid, activity: wanted }, nonce: String(++nonce) }));
}

/** Discord's fields take 2..128 characters. */
const field = (s: string) => (s.length < 2 ? `${s}  ` : s.length > 128 ? `${s.slice(0, 127)}…` : s);

function activity(info: PlayerInfo): object | null {
  const t = info.track;
  if (!t || !info.playing) return null;
  const local = isLocalTrack(t.id);
  // a file from this computer has no picture Discord can fetch: the app's own icon shows instead
  const cover = !local && t.artworkUrl?.startsWith("https://") ? artwork(t.artworkUrl, "t500x500") : null;
  const link = !local && t.permalinkUrl?.startsWith("https://soundcloud.com/") ? t.permalinkUrl : null;
  const start = info.startedAt;
  const end = start && info.durationMs ? start + info.durationMs : undefined;
  return {
    type: 2, // "Listening to"
    details: field(t.title),
    state: field(t.artist || "Unknown artist"),
    ...(start ? { timestamps: { start, ...(end ? { end } : {}) } } : {}),
    ...(cover ? { assets: { large_image: cover, large_text: field(t.title) } } : {}),
    buttons: [...(link ? [{ label: "Listen on SoundCloud", url: link }] : []), { label: "Get sc player", url: "https://github.com/waterlilo/sc-player/releases/latest" }],
  };
}

/** The current track and play state, as main hears them from the page. */
export function updateDiscord(info: PlayerInfo) {
  wanted = activity(info);
  flush();
}

/** Settings → "Show in Discord": connects (and keeps trying) when on; clears the status and lets go when off. */
export function setDiscordEnabled(on: boolean) {
  if (on === enabled) return;
  enabled = on;
  if (on) {
    void open();
    return;
  }
  if (retry) clearTimeout(retry);
  if (later) clearTimeout(later);
  retry = later = null;
  const s = socket;
  socket = null;
  ready = false;
  sentKey = null;
  if (s) s.end(frame(OP_FRAME, { cmd: "SET_ACTIVITY", args: { pid: process.pid }, nonce: String(++nonce) }));
}
