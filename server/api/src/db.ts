import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DATA = process.env.DATA_DIR ?? "./data";
mkdirSync(join(DATA, "themes"), { recursive: true });

export const db = new DatabaseSync(join(DATA, "sc-player.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");

db.exec(`
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,            -- the friend code people share (SKY-XXXXX)
  secret TEXT NOT NULL UNIQUE,          -- sha256 of the device's secret
  name TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  seen INTEGER NOT NULL,
  friends_v INTEGER NOT NULL DEFAULT 0, -- bumped on any change to this device's friends, so polls send the list only then
  share_now INTEGER NOT NULL DEFAULT 0, -- friends may see what is playing
  now_track TEXT,                       -- JSON of the track playing, when shared
  now_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS friends (
  a INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  b INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  asked_by INTEGER NOT NULL,            -- who sent the request
  accepted INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  PRIMARY KEY (a, b),
  CHECK (a < b)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  sender INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  recipient INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  track TEXT NOT NULL,                  -- JSON: id, title, artist, artworkUrl, permalinkUrl, durationMs
  sent INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0,      -- the recipient opened the chat
  state TEXT NOT NULL DEFAULT ''        -- what the recipient did: '' | heard | liked | queued
);
CREATE INDEX IF NOT EXISTS messages_recipient ON messages (recipient, id);
CREATE INDEX IF NOT EXISTS messages_pair ON messages (sender, recipient, id);
CREATE TABLE IF NOT EXISTS pings (
  day TEXT NOT NULL,                    -- YYYY-MM-DD (UTC)
  install TEXT NOT NULL,                -- a random id per install; nothing else about the user
  version TEXT NOT NULL,
  PRIMARY KEY (day, install)
);
CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY,
  author INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  look TEXT NOT NULL,                   -- JSON of the appearance knobs
  css TEXT NOT NULL DEFAULT '',
  bg TEXT NOT NULL DEFAULT '',          -- '' | file name in data/themes
  bg_type TEXT NOT NULL DEFAULT '',     -- image/... | video/...
  preview TEXT NOT NULL DEFAULT '',     -- file name in data/themes
  created INTEGER NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  installs INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,    -- by a moderator, or by reports until one looks
  published INTEGER NOT NULL DEFAULT 0  -- shown once its preview is uploaded
);
CREATE INDEX IF NOT EXISTS themes_new ON themes (published, hidden, created);
CREATE INDEX IF NOT EXISTS themes_top ON themes (published, hidden, likes);
CREATE TABLE IF NOT EXISTS theme_votes (
  theme TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  device INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                   -- like | install | report
  reason TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  PRIMARY KEY (theme, device, kind)
);
`);

export type Row = Record<string, string | number | null>;

export const one = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).get(...args) as Row | undefined;
export const all = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).all(...args) as Row[];
export const run = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).run(...args);

export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
