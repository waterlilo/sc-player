import type { Row } from "./db.ts";
import { fail, int, limit, readJson, send, text } from "./http.ts";
import { Rooms, type Person, type RoomTrack } from "./rooms.ts";

/**
 * Listening rooms over HTTP (the rules are in rooms.ts). The apps hold an event stream open per room
 * (GET …/events, Server-Sent Events): the whole room after every change, a heartbeat comment in between so proxies
 * keep it open. Everything else is a POST that answers with the room as it is now.
 */

export const rooms = new Rooms();
setInterval(() => rooms.tick(), 500).unref();

interface Ctx {
  req: import("node:http").IncomingMessage;
  res: import("node:http").ServerResponse;
  params: string[];
}

/** what routes.ts provides: the asking device, and friends by code (403 if not friends) */
export interface Helpers {
  me(c: Ctx): Row;
  friend(d: Row, code: string): Row;
  code(v: unknown): string;
  track(v: unknown): RoomTrack;
}

const person = (d: Row): Person => ({ id: Number(d.id), code: String(d.code), name: String(d.name) });

export function roomRoutes(h: Helpers): [string, RegExp, (c: Ctx) => unknown][] {
  const RID = "([A-Za-z0-9_-]{8})";
  const mine = (c: Ctx) => {
    const d = h.me(c);
    limit(`room:${d.id}`, 240, 60_000);
    return d;
  };
  const view = (c: Ctx, id: string) => {
    const r = rooms.get(id) ?? fail(404, "this room is closed");
    send(c.res, 200, rooms.view(r));
  };

  async function create(c: Ctx) {
    const d = mine(c);
    const body = await readJson(c.req);
    const r = rooms.create(person(d), {
      startTogether: body.startTogether === true,
      track: body.track ? h.track(body.track) : null,
      position: typeof body.position === "number" && Number.isFinite(body.position) ? Math.max(0, body.position) : 0,
      playing: body.playing !== false,
    });
    send(c.res, 201, rooms.view(r));
  }

  async function invite(c: Ctx) {
    const d = mine(c);
    const body = await readJson(c.req);
    if (!Array.isArray(body.to) || !body.to.length || body.to.length > 20) fail(400, "to: 1..20 friend codes");
    const friends = [...new Set((body.to as unknown[]).map(h.code))].map((code) => person(h.friend(d, code)));
    rooms.invite(c.params[0]!, Number(d.id), friends);
    view(c, c.params[0]!);
  }

  function join(c: Ctx) {
    const d = mine(c);
    const r = rooms.join(c.params[0]!, person(d));
    send(c.res, 200, rooms.view(r));
  }

  function leave(c: Ctx) {
    const d = mine(c);
    rooms.leave(c.params[0]!, Number(d.id));
    send(c.res, 204, null);
  }

  /** One endpoint for what happens in a room: { op, … }. */
  async function act(c: Ctx) {
    const d = mine(c);
    const id = c.params[0]!;
    const me = Number(d.id);
    // a list put on carries up to 500 tracks
    const b = await readJson(c.req, 320 * 1024);
    const position = () => (typeof b.position === "number" && Number.isFinite(b.position) ? Math.max(0, b.position) : 0);
    const item = () => text(b.item, 16, "item");
    let answer: Record<string, unknown> = {};
    switch (b.op) {
      case "play":
        rooms.play(id, me, h.track(b.track), position());
        break;
      case "playing":
        rooms.setPlaying(id, me, b.playing === true);
        break;
      case "seek":
        rooms.seek(id, me, position());
        break;
      case "next":
        rooms.next(id, me);
        break;
      case "playList": {
        if (!Array.isArray(b.tracks) || !b.tracks.length || b.tracks.length > 501) fail(400, "tracks: 1..501");
        rooms.playList(id, me, (b.tracks as unknown[]).map(h.track), text(b.title, 200, "title", false));
        break;
      }
      case "listAppend": {
        if (!Array.isArray(b.tracks) || !b.tracks.length || b.tracks.length > 500) fail(400, "tracks: 1..500");
        rooms.listAppend(id, me, (b.tracks as unknown[]).map(h.track));
        break;
      }
      case "listRemove":
        rooms.listRemove(id, me, item());
        break;
      case "listClear":
        rooms.listClear(id, me);
        break;
      case "handOver":
        rooms.handOver(id, me, h.code(b.to));
        break;
      case "queueAdd":
        rooms.queueAdd(id, me, h.track(b.track), b.next === true, b.auto === true);
        break;
      case "queueRemove":
        rooms.queueRemove(id, me, item());
        break;
      case "queueMove":
        rooms.queueMove(id, me, item(), int(b.to, 0, 1000, "to"));
        break;
      case "suggest":
        answer = { result: rooms.suggest(id, me, h.track(b.track)) };
        break;
      case "suggestList": {
        if (!Array.isArray(b.tracks) || !b.tracks.length || b.tracks.length > 500) fail(400, "tracks: 1..500");
        answer = { result: rooms.suggestList(id, me, (b.tracks as unknown[]).map(h.track), text(b.title, 200, "title", false)) };
        break;
      }
      case "decide":
        rooms.decide(id, me, item(), b.take === true);
        break;
      case "ready":
        rooms.ready(id, me, int(b.trackId, 1, Number.MAX_SAFE_INTEGER, "trackId"));
        break;
      default:
        fail(400, "unknown op");
    }
    const r = rooms.get(id) ?? fail(404, "this room is closed");
    send(c.res, 200, { ...answer, room: rooms.view(r) });
  }

  /** The whole history (the room view carries the latest few): for "Save as a playlist". */
  function history(c: Ctx) {
    const d = mine(c);
    const r = rooms.get(c.params[0]!) ?? fail(404, "this room is closed");
    if (!r.members.some((m) => m.id === Number(d.id))) fail(403, "not in this room");
    send(c.res, 200, { history: r.history });
  }

  /** The room's events for a member: the room now, then again after every change; "closed" at the end. */
  function events(c: Ctx) {
    const d = h.me(c);
    const id = c.params[0]!;
    const r = rooms.get(id) ?? fail(404, "this room is closed");
    const me = Number(d.id);
    if (!r.members.some((m) => m.id === me)) fail(403, "not in this room");
    c.res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    });
    c.res.write("retry: 2000\n\n");
    let open = true;
    const out = (closed: boolean) => {
      if (!open) return;
      const room = rooms.get(id);
      if (closed || !room || !room.members.some((m) => m.id === me)) {
        c.res.write(`event: closed\ndata: {}\n\n`);
        return end();
      }
      c.res.write(`event: room\ndata: ${JSON.stringify(rooms.view(room))}\n\n`);
    };
    const beat = setInterval(() => open && c.res.write(`: ${Date.now()}\n\n`), 15_000);
    const off = rooms.subscribe(id, out);
    const end = () => {
      if (!open) return;
      open = false;
      clearInterval(beat);
      off();
      rooms.disconnected(id, me);
      c.res.end();
    };
    c.req.on("close", end);
    c.res.on("error", end);
    rooms.connected(id, me);
  }

  return [
    ["GET", /^\/v1\/rooms\/time$/, (c) => send(c.res, 200, { now: Date.now() })],
    [
      "GET",
      /^\/v1\/rooms\/mine$/,
      (c) => {
        const r = rooms.roomOf(Number(h.me(c).id));
        send(c.res, 200, { room: r ? rooms.view(r) : null });
      },
    ],
    ["POST", /^\/v1\/rooms$/, create],
    [
      "GET",
      new RegExp(`^/v1/rooms/${RID}$`),
      (c) => {
        // the room's people and tracks: for its members and those invited (an invitation shows it before joining)
        const me = Number(mine(c).id);
        const r = rooms.get(c.params[0]!) ?? fail(404, "this room is closed");
        if (!r.members.some((m) => m.id === me) && !r.invited.has(me)) fail(404, "this room is closed");
        view(c, r.id);
      },
    ],
    ["GET", new RegExp(`^/v1/rooms/${RID}/events$`), events],
    ["GET", new RegExp(`^/v1/rooms/${RID}/history$`), history],
    ["POST", new RegExp(`^/v1/rooms/${RID}/invite$`), invite],
    ["POST", new RegExp(`^/v1/rooms/${RID}/join$`), join],
    ["POST", new RegExp(`^/v1/rooms/${RID}/leave$`), leave],
    ["POST", new RegExp(`^/v1/rooms/${RID}/do$`), act],
  ];
}
