import type { IncomingMessage } from "node:http";
import { all, db, one, run, type Row } from "./db.ts";
import { fail } from "./http.ts";

/**
 * Several apps under one friend code (an account's PC and phone share it through the account's encrypted `secrets`
 * document). Each app sends `X-Instance: <tag>`, a random tag of its own install, with every request that carries the
 * code's secret. Per instance: "now playing", what the app can do (`features`) and room membership; per code, as
 * before: the name, friends, the inbox, message states and room invitations. No header: today's behaviour, so older
 * apps keep working unchanged. The contract: Desktop\sc player notes\x-instance.md.
 */

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** apps per friend code; a new one past this pushes out the one seen longest ago */
export const MAX_INSTANCES = 8;
/** an instance not seen for this long no longer counts for the code's features, and is forgotten */
const INSTANCE_KEEP = 30 * DAY;
/** how long "now playing" counts as live (as for codes) */
const LIVE_MS = 10 * MIN;
const TAG = /^[A-Za-z0-9_-]{16,64}$/;

db.exec(`
CREATE TABLE IF NOT EXISTS instances (
  id INTEGER PRIMARY KEY,               -- rooms know an instance as member -id (never a devices.id)
  device INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,                    -- the app's random X-Instance tag
  features TEXT NOT NULL DEFAULT '',
  now_track TEXT,                       -- JSON of the track this app plays, when the code shares it
  now_at INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  seen INTEGER NOT NULL,
  UNIQUE (device, tag)
);
`);

/** The rooms' member id of an instance: negative, so it never meets a device's own id (older apps use that). */
export const memberOf = (inst: Row) => -Number(inst.id);

/**
 * The instance a request speaks for: made on first sight, kept fresh. Null without the header. A ninth one under a
 * code pushes out the one seen longest ago (`onEvict` lets it leave its room first).
 */
export function instanceOf(req: IncomingMessage, device: Row, onEvict: (member: number) => void): Row | null {
  const raw = req.headers["x-instance"];
  if (raw === undefined) return null;
  const tag = String(raw).trim();
  if (!TAG.test(tag)) return fail(400, "bad instance");
  const now = Date.now();
  let inst = one("SELECT * FROM instances WHERE device = ? AND tag = ?", device.id, tag);
  if (!inst) {
    const others = all("SELECT id FROM instances WHERE device = ? ORDER BY seen DESC, id DESC", device.id);
    for (const old of others.slice(MAX_INSTANCES - 1)) {
      onEvict(-Number(old.id));
      run("DELETE FROM instances WHERE id = ?", old.id);
    }
    run("INSERT INTO instances (device, tag, created, seen) VALUES (?, ?, ?, ?)", device.id, tag, now, now);
    inst = one("SELECT * FROM instances WHERE device = ? AND tag = ?", device.id, tag)!;
  } else if (now - Number(inst.seen) > MIN) run("UPDATE instances SET seen = ? WHERE id = ?", now, inst.id);
  return inst;
}

/** What this instance can do, from its X-SC-Features; the code's own `features` becomes what any of its apps can. */
export function setFeatures(inst: Row, features: string) {
  if (features === inst.features) return;
  run("UPDATE instances SET features = ? WHERE id = ?", features, inst.id);
  const union = new Set(
    all("SELECT features FROM instances WHERE device = ? AND seen > ?", inst.device, Date.now() - INSTANCE_KEEP).flatMap((r) =>
      String(r.features)
        .split(",")
        .filter(Boolean),
    ),
  );
  run("UPDATE devices SET features = ? WHERE id = ?", [...union].sort().join(","), inst.device);
}

/**
 * This instance plays `track` (null: stopped). Friends see the code's newest live track across its apps, so a phone
 * that stops doesn't hide what the PC still plays (the code's row keeps that, as older apps' readers expect).
 */
export function setNow(inst: Row, track: string | null) {
  const now = Date.now();
  run("UPDATE instances SET now_track = ?, now_at = ? WHERE id = ?", track, now, inst.id);
  const live = one("SELECT now_track, now_at FROM instances WHERE device = ? AND now_track IS NOT NULL AND now_at > ? ORDER BY now_at DESC LIMIT 1", inst.device, now - LIVE_MS);
  run("UPDATE devices SET now_track = ?, now_at = ? WHERE id = ?", live ? live.now_track : null, live ? live.now_at : now, inst.device);
}

/** Sharing turned off for the code: no instance keeps a track either. */
export const clearNow = (device: number) => run("UPDATE instances SET now_track = NULL WHERE device = ?", device);

/** The member ids of a code's instances (to take them out of rooms when the code goes). */
export const membersOf = (device: number) => all("SELECT id FROM instances WHERE device = ?", device).map((r) => -Number(r.id));

/** Instances not seen for a month are forgotten. */
setInterval(() => run("DELETE FROM instances WHERE seen < ?", Date.now() - INSTANCE_KEEP), 60 * MIN).unref();
