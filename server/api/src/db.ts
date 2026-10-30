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
-- what sc player is playing, for everyone's home screen: SoundCloud track ids only (the apps read titles and covers from
-- SoundCloud itself), when last played and how often lately; nothing about who played them
CREATE TABLE IF NOT EXISTS listening (
  track_id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  plays INTEGER NOT NULL DEFAULT 1      -- in the last day (counting restarts after a quiet day)
);
CREATE INDEX IF NOT EXISTS listening_at ON listening (at);
CREATE TABLE IF NOT EXISTS pings (
  day TEXT NOT NULL,                    -- YYYY-MM-DD (UTC)
  install TEXT NOT NULL,                -- a random id per install; nothing else about the user
  version TEXT NOT NULL,
  PRIMARY KEY (day, install)
);
-- how many apps were running at once, per hour (UTC "YYYY-MM-DDTHH"): sampled each minute from the apps' "still on"
-- notes (kept in memory only); just the numbers, no install ids
CREATE TABLE IF NOT EXISTS online (
  hour TEXT PRIMARY KEY,
  peak INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,     -- the sum of the minute samples (total / samples = the hour's average)
  samples INTEGER NOT NULL DEFAULT 0
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
-- timed lyrics people made for a SoundCloud track, sent for the moderator; approved ones are shown in every app
CREATE TABLE IF NOT EXISTS lyrics (
  id INTEGER PRIMARY KEY,
  track INTEGER NOT NULL,               -- SoundCloud track id
  author INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL DEFAULT '', -- the name when sent: shown if the author's code is deleted later
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  duration INTEGER NOT NULL DEFAULT 0,
  lrc TEXT NOT NULL,                    -- "[mm:ss.xx] line" rows; emptied when rejected
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | replaced
  created INTEGER NOT NULL,
  decided INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS lyrics_track ON lyrics (track, status);
CREATE INDEX IF NOT EXISTS lyrics_status ON lyrics (status, created);
`);

// columns added after the first release (CREATE TABLE IF NOT EXISTS leaves existing tables as they were)
const columns = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
// what the app on this device can do, from its X-SC-Features header ("rooms"): invitations go only to apps that can join
if (!columns("devices").includes("features")) db.exec("ALTER TABLE devices ADD COLUMN features TEXT NOT NULL DEFAULT ''");
// a playlist from the sender's computer (JSON: title, ids); `track` is then its first track, which older apps show
if (!columns("messages").includes("playlist")) db.exec("ALTER TABLE messages ADD COLUMN playlist TEXT");

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
