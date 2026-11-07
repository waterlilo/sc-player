/**
 * Moving a SoundCloud library into the sc player account (design §11): track likes, own playlists, albums and
 * playlists liked from others, followed artists. Pure: SoundCloud (`source`), where things go (`sink`) and what was
 * imported before (`memory`) come in, so it is tested without SoundCloud or Electron (main/sync/sc-import runs it).
 *
 * Additive only. An item goes in when this computer never imported it for this SoundCloud account (`memory.seen`) and
 * the vault never had it, not even as a tombstone (`sink.has…`): what the person removed in sc player stays removed,
 * on every device. SoundCloud lists likes newest first, so a later run stops at the first page with nothing new.
 * Gentle on SoundCloud: one request at a time with a pause between, waiting on 429, stopping on its bot check.
 */

export interface ScTrack {
  id: number;
}
export interface ScPlaylist {
  id: string;
  title: string;
  relation: "own" | "liked" | null;
  [k: string]: unknown;
}
export interface ScUser {
  id: number;
  username: string;
  permalinkUrl: string;
  avatarUrl: string | null;
}
export interface ScPage<T> {
  items: T[];
  next: string | null;
}

/** SoundCloud as the import needs it (the app's provider, signed in). Errors carry `code` as ScError does. */
export interface ScSource {
  me(): Promise<{ id: number; username: string; likesCount: number | null; followingsCount: number | null } | null>;
  likes(cursor: string | null): Promise<ScPage<ScTrack>>;
  playlists(cursor: string | null): Promise<ScPage<ScPlaylist>>;
  playlistTracks(id: string, cursor: string | null): Promise<ScPage<ScTrack & Record<string, unknown>>>;
  followings(cursor: string | null): Promise<ScPage<ScUser>>;
}

/** Where things go, and whether sc player has (or had) them. */
export interface Sink {
  hasLike(id: number): boolean;
  /** newest first; `now` is the time of the first */
  addLikes(ids: number[], now: number): void;
  hasSaved(id: string): boolean;
  addSaved(p: ScPlaylist): void;
  hasOwn(scId: string): boolean;
  addOwn(p: ScPlaylist, tracks: (ScTrack & Record<string, unknown>)[]): void;
  hasFollow(id: number): boolean;
  addFollows(users: ScUser[]): void;
}

/** What this computer imported before, per SoundCloud account, and where an unfinished run stopped. */
export interface Memory {
  seen: { likes: number[]; own: string[]; saved: string[]; follows: number[] };
  /** the first run went through to the end */
  complete: boolean;
  /** an unfinished run: the stage and the cursor to go on from */
  stage: "likes" | "playlists" | "follows" | null;
  cursor: string | null;
  last: number;
}
export const newMemory = (): Memory => ({ seen: { likes: [], own: [], saved: [], follows: [] }, complete: false, stage: null, cursor: null, last: 0 });

export interface Progress {
  username: string;
  likes: number;
  playlists: number;
  saved: number;
  follows: number;
  totals: { likes: number | null; follows: number | null };
}

/** Why a run stopped early. */
export type StopReason = "verify" | "signed_out" | "offline" | "rate_limited" | "unknown";
export class ImportStopped extends Error {
  reason: StopReason;
  constructor(reason: StopReason, message: string = reason) {
    super(message);
    this.reason = reason;
  }
}

export interface Options {
  /** the pause between requests (about 3 a second) */
  gapMs?: number;
  /** waits after a 429, then it stops */
  backoffMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** called after each page: progress so far */
  progress?: (p: Progress) => void;
  /** memory for this SoundCloud account, after each page (so a restart goes on from there) */
  save?: (userId: number, m: Memory) => void;
  load: (userId: number) => Memory;
}

/** One run. Returns what it added. */
export async function runImport(source: ScSource, sink: Sink, o: Options): Promise<Progress> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const gap = o.gapMs ?? 350;
  const backoff = o.backoffMs ?? [30_000, 60_000, 120_000];
  const now = o.now ?? Date.now;

  /** One SoundCloud request: paced, retried after 429, stopped on what can't be waited out. */
  const call = async <T>(fn: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      await sleep(gap);
      try {
        return await fn();
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === "rate_limited") {
          if (attempt < backoff.length) {
            await sleep(backoff[attempt]!);
            continue;
          }
          throw new ImportStopped("rate_limited");
        }
        // SoundCloud's bot protection wants a person: no way around it from here, and none is tried
        if (code === "verify") throw new ImportStopped("verify");
        if (code === "unauthorized") throw new ImportStopped("signed_out");
        if (code === "offline") throw new ImportStopped("offline");
        throw new ImportStopped("unknown", e instanceof Error ? e.message : String(e));
      }
    }
  };

  const me = await call(() => source.me());
  if (!me) throw new ImportStopped("signed_out");
  const m = o.load(me.id);
  const seen = { likes: new Set(m.seen.likes), own: new Set(m.seen.own), saved: new Set(m.seen.saved), follows: new Set(m.seen.follows) };
  const p: Progress = { username: me.username, likes: 0, playlists: 0, saved: 0, follows: 0, totals: { likes: me.likesCount, follows: me.followingsCount } };
  const keep = (stage: Memory["stage"], cursor: string | null) => {
    Object.assign(m, { stage, cursor, seen: { likes: [...seen.likes], own: [...seen.own], saved: [...seen.saved], follows: [...seen.follows] } });
    o.save?.(me.id, m);
    o.progress?.({ ...p, totals: { ...p.totals } });
  };
  const resume = (stage: Memory["stage"]) => (m.stage === stage ? m.cursor : null);
  const order: Memory["stage"][] = ["likes", "playlists", "follows"];
  const from = m.stage ? order.indexOf(m.stage) : 0;
  const start = now();

  // track likes: newest first; a later run stops at the first page with nothing new
  if (from <= 0) {
    let cursor = resume("likes");
    for (;;) {
      const page = await call(() => source.likes(cursor));
      const fresh = page.items.filter((t) => !seen.likes.has(t.id));
      const add = fresh.filter((t) => !sink.hasLike(t.id)).map((t) => t.id);
      // SoundCloud's order: the newest like the newest time, page after page
      if (add.length) sink.addLikes(add, start - p.likes);
      p.likes += add.length;
      for (const t of page.items) seen.likes.add(t.id);
      cursor = page.next;
      // done: the last page, or (after a first full run) a page with nothing new — the older ones were seen then
      const done = !cursor || (m.complete && !fresh.length);
      keep(done ? "playlists" : "likes", done ? null : cursor);
      if (done) break;
    }
  }

  // playlists: the person's own become own playlists (all their tracks, in order); liked ones are saved
  if (from <= 1) {
    let cursor = resume("playlists");
    for (;;) {
      const page = await call(() => source.playlists(cursor));
      for (const pl of page.items) {
        if (pl.relation === "own" && !seen.own.has(pl.id)) {
          if (!sink.hasOwn(pl.id)) {
            const tracks: (ScTrack & Record<string, unknown>)[] = [];
            let tc: string | null = null;
            do {
              const t = await call(() => source.playlistTracks(pl.id, tc));
              tracks.push(...t.items);
              tc = t.next;
            } while (tc && tracks.length < 5000);
            sink.addOwn(pl, tracks);
            p.playlists++;
          }
          seen.own.add(pl.id);
        } else if (pl.relation === "liked" && !seen.saved.has(pl.id)) {
          if (!sink.hasSaved(pl.id)) {
            sink.addSaved(pl);
            p.saved++;
          }
          seen.saved.add(pl.id);
        }
      }
      cursor = page.next;
      keep(cursor ? "playlists" : "follows", cursor);
      if (!cursor) break;
    }
  }

  // followed artists
  {
    let cursor = resume("follows");
    for (;;) {
      const page = await call(() => source.followings(cursor));
      const add = page.items.filter((u) => !seen.follows.has(u.id) && !sink.hasFollow(u.id));
      if (add.length) sink.addFollows(add);
      p.follows += add.length;
      for (const u of page.items) seen.follows.add(u.id);
      cursor = page.next;
      keep(cursor ? "follows" : null, cursor);
      if (!cursor) break;
    }
  }

  m.complete = true;
  m.last = now();
  keep(null, null);
  return p;
}
