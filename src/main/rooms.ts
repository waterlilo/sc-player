import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, net, type BrowserWindow } from "electron";
import type { Room, RoomOp, RoomState, SocialTrack } from "@shared/social";
import { ScError } from "./soundcloud";
import { getSecret } from "./store/secrets";
import { api, joined, pollSoon, serverBase, status } from "./social";
import { log } from "./system/log";
import { send } from "./windows/main-window";

/**
 * Listening rooms, this app's side (the rules live on the server, server/api/src/rooms.ts): the room's event stream —
 * the whole room after every change — kept open and reopened when it drops; the server's clock measured so the page
 * can tell where the track is; commands passed on. The room this app is in is remembered on disk, so a restart within
 * a couple of minutes picks it up again. The page (state/room.ts) gets every change as "room:state".
 */

let win: () => BrowserWindow | null = () => null;
const state: RoomState = { room: null, me: "", offset: 0, connected: false, closed: false };
let stream: AbortController | null = null;
/** bumped whenever the room changes or is left: a reconnect loop for an older room stops */
let gen = 0;

const savedPath = () => join(app.getPath("userData"), "room.json");
function remember(id: string | null) {
  try {
    if (id) writeFileSync(savedPath(), JSON.stringify({ id }));
    else rmSync(savedPath(), { force: true });
  } catch {
    /* only a convenience */
  }
}

const publish = () => send(win(), "room:state", { ...state });

export const roomState = (): RoomState => ({ ...state });
const roomId = () => state.room?.id ?? "";
const need = () => roomId() || (() => {
  throw new ScError("not_found", "not in a room");
})();

/** The server's time − ours, as the median of five round trips (the network delay split evenly). */
async function measureClock() {
  const offs: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const { now } = await api<{ now: number }>("GET", "/v1/rooms/time", { timeout: 5000 });
    const t1 = Date.now();
    offs.push(now - (t0 + t1) / 2);
  }
  state.offset = offs.sort((a, b) => a - b)[2]!;
}

/** Takes a newer room (never an older one: a reconnect can bring a snapshot that crossed a fresher one). */
function take(room: Room) {
  if (state.room && state.room.id === room.id && room.version < state.room.version) return;
  state.room = room;
  state.closed = false;
  publish();
}

function ended(closed: boolean) {
  gen++;
  stream?.abort();
  stream = null;
  state.room = null;
  state.connected = false;
  state.closed = closed;
  remember(null);
  publish();
  pollSoon();
}

/** Keeps the room's event stream open: reconnects after 1, 2, 4… up to 10 s; ends when the room is gone. */
function connect(id: string) {
  const mine = ++gen;
  stream?.abort();
  remember(id);
  void (async () => {
    let wait = 1000;
    while (mine === gen) {
      const ctl = new AbortController();
      stream = ctl;
      try {
        await measureClock();
        const res = await net.fetch(`${serverBase()}/v1/rooms/${id}/events`, {
          headers: { authorization: `Bearer ${getSecret("socialSecret") ?? ""}`, accept: "text/event-stream", "x-sc-features": "rooms" },
          signal: ctl.signal,
        });
        if (res.status === 404 || res.status === 403) {
          if (mine === gen) ended(true);
          return;
        }
        if (!res.ok || !res.body) throw new Error(`events: HTTP ${res.status}`);
        state.connected = true;
        publish();
        wait = 1000;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done || mine !== gen) break;
          buf += dec.decode(value, { stream: true });
          let cut: number;
          while ((cut = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, cut);
            buf = buf.slice(cut + 2);
            const event = /^event: (.+)$/m.exec(block)?.[1];
            const data = /^data: (.+)$/m.exec(block)?.[1];
            if (event === "closed") {
              if (mine === gen) ended(true);
              return;
            }
            if (event === "room" && data) take(JSON.parse(data) as Room);
          }
        }
      } catch (e) {
        if (mine !== gen) return;
        if (!(e instanceof Error && e.name === "AbortError")) log("main", `room stream: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (mine !== gen) return;
      state.connected = false;
      publish();
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(10_000, wait * 2);
    }
  })();
}

// ---- what the page asks ---------------------------------------------------------------------------------------------

export async function createRoom(o: { startTogether: boolean; invite: string[]; track: SocialTrack | null; position: number; playing: boolean }): Promise<Room> {
  const room = await api<Room>("POST", "/v1/rooms", { body: { startTogether: o.startTogether, track: o.track, position: o.position, playing: o.playing } });
  state.me = (await status()).profile?.code ?? state.me;
  take(room);
  connect(room.id);
  if (o.invite.length) await invite(o.invite);
  return room;
}

export async function invite(codes: string[]) {
  take(await api<Room>("POST", `/v1/rooms/${need()}/invite`, { body: { to: codes } }));
}

export async function joinRoom(id: string): Promise<Room> {
  const room = await api<Room>("POST", `/v1/rooms/${id}/join`);
  state.me = (await status()).profile?.code ?? state.me;
  take(room);
  connect(room.id);
  return room;
}

export async function leaveRoom() {
  const id = roomId();
  ended(false);
  if (id) await api("POST", `/v1/rooms/${id}/leave`).catch(() => undefined);
}

export async function act(op: RoomOp): Promise<{ result?: "suggested" | "already" }> {
  const r = await api<{ result?: "suggested" | "already"; room: Room }>("POST", `/v1/rooms/${need()}/do`, { body: op });
  // the stream brings the same in a moment; taking it now makes the button feel instant
  take(r.room);
  return r.result ? { result: r.result } : {};
}

export async function history(): Promise<SocialTrack[]> {
  const r = await api<{ history: { track: SocialTrack }[] }>("GET", `/v1/rooms/${need()}/history`);
  return r.history.map((h) => h.track);
}

/** At start: back into the room this app was in (if it's still there and so is this app). */
export function initRooms(getWindow: () => BrowserWindow | null) {
  win = getWindow;
  if (!joined()) return;
  let id = "";
  try {
    id = (JSON.parse(readFileSync(savedPath(), "utf8")) as { id?: string }).id ?? "";
  } catch {
    return;
  }
  if (!id) return;
  void (async () => {
    try {
      state.me = (await status()).profile?.code ?? "";
      const r = await api<{ room: Room | null }>("GET", "/v1/rooms/mine");
      if (r.room?.id === id) {
        take(r.room);
        connect(id);
      } else remember(null);
    } catch {
      /* offline at start: the room ends for us on the server after a while */
    }
  })();
}
