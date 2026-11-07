import assert from "node:assert/strict";
import { test } from "node:test";
import { codeKeys, docId, newCode, sealDoc } from "./crypto.ts";
import { emptyDoc, followsChanges, likesChanges, playlistChanges } from "./docs.ts";
import { Clock, mergeDocs } from "./merge.ts";
import { ImportStopped, newMemory, runImport, type Memory, type ScPlaylist, type ScSource, type ScUser, type Sink } from "./import-core.ts";

/** A made-up SoundCloud account: likes newest first, own and liked playlists, followings; pages of `size`. */
function fakeSc(o: { likes: number; own: number; liked: number; follows: number; userId?: number; size?: number }) {
  const size = o.size ?? 50;
  const state = { likes: Array.from({ length: o.likes }, (_, i) => o.likes - i + 1000), calls: [] as string[], fail: null as null | ((what: string) => unknown) };
  const pageOf = <T>(all: T[], cursor: string | null) => {
    const at = cursor ? Number(cursor) : 0;
    return { items: all.slice(at, at + size), next: at + size < all.length ? String(at + size) : null };
  };
  const lists: ScPlaylist[] = [
    ...Array.from({ length: o.own }, (_, i): ScPlaylist => ({ id: String(500 + i), title: `Own ${i}`, relation: "own" })),
    ...Array.from({ length: o.liked }, (_, i): ScPlaylist => ({ id: String(900 + i), title: `Album ${i}`, relation: "liked", isAlbum: true })),
  ];
  const users: ScUser[] = Array.from({ length: o.follows }, (_, i) => ({ id: 70_000 + i, username: `artist${i}`, permalinkUrl: `https://soundcloud.com/a${i}`, avatarUrl: null }));
  const step = async <T>(what: string, fn: () => T) => {
    state.calls.push(what);
    const e = state.fail?.(what);
    if (e) throw e;
    return fn();
  };
  const source: ScSource = {
    me: () => step("me", () => ({ id: o.userId ?? 1, username: "sky", likesCount: state.likes.length, followingsCount: users.length })),
    likes: (c) => step(`likes:${c}`, () => pageOf(state.likes.map((id) => ({ id })), c)),
    playlists: (c) => step(`playlists:${c}`, () => pageOf(lists, c)),
    playlistTracks: (id, c) => step(`tracks:${id}:${c}`, () => pageOf(Array.from({ length: 120 }, (_, i) => ({ id: Number(id) * 1000 + i, durationMs: 1000, artworkUrl: null })), c)),
    followings: (c) => step(`follows:${c}`, () => pageOf(users, c)),
  };
  return { source, state };
}

/** sc player as the import sees it: what it has (live) and had (tombstones), and what was added. */
function fakeSink() {
  const s = { likes: [] as number[], own: new Map<string, number>(), saved: new Set<string>(), follows: new Set<number>(), gone: new Set<string>() };
  const sink: Sink = {
    hasLike: (id) => s.likes.includes(id) || s.gone.has(`t${id}`),
    addLikes: (ids) => s.likes.push(...ids),
    hasSaved: (id) => s.saved.has(id) || s.gone.has(`s${id}`),
    addSaved: (p) => s.saved.add(p.id),
    hasOwn: (id) => s.own.has(id) || s.gone.has(`p${id}`),
    addOwn: (p, tracks) => s.own.set(p.id, tracks.length),
    hasFollow: (id) => s.follows.has(id) || s.gone.has(`f${id}`),
    addFollows: (us) => us.forEach((u) => s.follows.add(u.id)),
  };
  return { sink, s };
}

const opts = (mem: Map<number, Memory>) => ({ gapMs: 0, backoffMs: [1, 1, 1], sleep: async () => undefined, load: (id: number) => mem.get(id) ?? newMemory(), save: (id: number, m: Memory) => mem.set(id, structuredClone(m)) });

test("first run brings everything; a later one only what is new, and stops at the first page with nothing new", async () => {
  const sc = fakeSc({ likes: 1200, own: 3, liked: 20, follows: 85 });
  const { sink, s } = fakeSink();
  const mem = new Map<number, Memory>();
  const r = await runImport(sc.source, sink, opts(mem));
  assert.deepEqual([r.likes, r.playlists, r.saved, r.follows], [1200, 3, 20, 85]);
  assert.equal(s.likes[0], 2200, "the newest like first");
  assert.equal(s.own.get("500"), 120, "all tracks of an own playlist");
  // three new likes on SoundCloud
  sc.state.likes.unshift(5001, 5002, 5003);
  sc.state.calls.length = 0;
  const r2 = await runImport(sc.source, sink, opts(mem));
  assert.deepEqual([r2.likes, r2.playlists, r2.saved, r2.follows], [3, 0, 0, 0]);
  assert.equal(sc.state.calls.filter((c) => c.startsWith("likes:")).length, 2, "the second page has nothing new: it stops there");
  assert.equal(sc.state.calls.filter((c) => c.startsWith("tracks:")).length, 0, "own playlists already brought aren't read again");
});

test("what the person removed in sc player doesn't come back, even on another computer (a new memory)", async () => {
  const sc = fakeSc({ likes: 10, own: 2, liked: 2, follows: 2 });
  const { sink, s } = fakeSink();
  for (const g of ["t1010", "p500", "s900", "f70000"]) s.gone.add(g);
  const r = await runImport(sc.source, sink, opts(new Map()));
  assert.deepEqual([r.likes, r.playlists, r.saved, r.follows], [9, 1, 1, 1]);
  assert.ok(!s.likes.includes(1010));
});

test("another SoundCloud account on the same computer imports its own once", async () => {
  const mem = new Map<number, Memory>();
  const { sink } = fakeSink();
  await runImport(fakeSc({ likes: 5, own: 0, liked: 0, follows: 0, userId: 1 }).source, sink, opts(mem));
  const other = fakeSc({ likes: 5, own: 0, liked: 0, follows: 3, userId: 2 });
  other.state.likes = [7, 8, 9];
  const r = await runImport(other.source, sink, opts(mem));
  assert.deepEqual([r.likes, r.follows], [3, 3]);
  assert.deepEqual([...mem.keys()].sort(), [1, 2]);
});

test("gentle on SoundCloud: waits out 429s, stops on the bot check and when 429s don't end", async () => {
  const sc = fakeSc({ likes: 120, own: 0, liked: 0, follows: 0 });
  let n = 0;
  sc.state.fail = (what) => (what === "likes:50" && n++ < 2 ? { code: "rate_limited" } : null);
  const waits: number[] = [];
  const r = await runImport(sc.source, fakeSink().sink, { ...opts(new Map()), backoffMs: [5, 10, 20], sleep: async (ms) => void waits.push(ms) });
  assert.equal(r.likes, 120);
  assert.deepEqual(waits.filter((w) => w > 0), [5, 10]);

  const bot = fakeSc({ likes: 120, own: 0, liked: 0, follows: 0 });
  bot.state.fail = (what) => (what === "likes:50" ? { code: "verify" } : null);
  await assert.rejects(runImport(bot.source, fakeSink().sink, opts(new Map())), (e: unknown) => e instanceof ImportStopped && e.reason === "verify");
  assert.equal(bot.state.calls.filter((c) => c === "likes:50").length, 1, "no retry against the bot check");

  const busy = fakeSc({ likes: 120, own: 0, liked: 0, follows: 0 });
  busy.state.fail = (what) => (what === "likes:50" ? { code: "rate_limited" } : null);
  await assert.rejects(runImport(busy.source, fakeSink().sink, opts(new Map())), (e: unknown) => e instanceof ImportStopped && e.reason === "rate_limited");
});

test("a run cut off goes on from where it stopped", async () => {
  const sc = fakeSc({ likes: 300, own: 0, liked: 0, follows: 10 });
  const mem = new Map<number, Memory>();
  const { sink, s } = fakeSink();
  sc.state.fail = (what) => (what === "likes:150" ? { code: "offline" } : null);
  await assert.rejects(runImport(sc.source, sink, opts(mem)), (e: unknown) => e instanceof ImportStopped && e.reason === "offline");
  assert.equal(s.likes.length, 150);
  assert.deepEqual([mem.get(1)!.stage, mem.get(1)!.cursor], ["likes", "150"]);
  sc.state.fail = null;
  sc.state.calls.length = 0;
  const r = await runImport(sc.source, sink, opts(mem));
  assert.equal(r.likes, 150);
  assert.equal(sc.state.calls[1], "likes:150", "goes on from the page it stopped at");
  assert.equal(s.likes.length, 300);
});

test("a big library fits the vault: 5000 likes, 300 saved albums, 200 playlists of 500 tracks, 2000 followings", () => {
  const k = codeKeys(newCode());
  const c = new Clock();
  const stamp = () => ({ at: c.now(), by: "abcdef" });
  const sealed = (d: ReturnType<typeof emptyDoc>) => sealDoc(k.dek, k.vaultId, docId(k.dek, d.name), JSON.stringify(d), { compress: true }).length;
  const card = (i: number) => ({ id: String(900_000 + i), title: `Album number ${i} (deluxe)`, user: { id: i, username: `artist ${i}`, permalinkUrl: `https://soundcloud.com/artist-${i}` }, artworkUrl: `https://i1.sndcdn.com/artworks-000${i}abcdefgh-large.jpg`, trackCount: 12, durationMs: 2_400_000, permalinkUrl: `https://soundcloud.com/artist-${i}/sets/album-${i}`, isAlbum: true, relation: "liked", releaseDate: "2025-05-01T00:00:00Z", genre: "Electronic" });
  const likes = mergeDocs(emptyDoc("likes", "likes"), likesChanges({ liked: Array.from({ length: 5000 }, (_, i) => ({ id: 1_000_000_000 + i * 7919, at: 1_700_000_000_000 + i })), hidden: [], playlists: Array.from({ length: 300 }, (_, i) => ({ playlist: card(i), at: 1_700_000_000_000 + i })) }, null, stamp, true));
  const follows = mergeDocs(emptyDoc("follows", "follows"), followsChanges(Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [String(70_000 + i), { user: { id: 70_000 + i, username: `artist${i}`, permalinkUrl: `https://soundcloud.com/a${i}`, avatarUrl: `https://i1.sndcdn.com/avatars-000${i}xyz-large.jpg` }, at: 1_700_000_000_000 + i }])), null, stamp, true));
  const lists = Array.from({ length: 200 }, (_, p) =>
    mergeDocs(emptyDoc("playlist", `pl:local-${p.toString(16).padStart(16, "0")}`), playlistChanges({ id: `local-${p.toString(16).padStart(16, "0")}`, title: `Playlist ${p}`, created: 1_700_000_000_000, from: String(500 + p), items: Array.from({ length: 500 }, (_, i) => ({ id: 2_000_000_000 + p * 1000 + i, durationMs: 180_000 + i, artworkUrl: `https://i1.sndcdn.com/artworks-${p}-${i}-large.jpg` })) }, null, stamp, true)!),
  );
  const sizes = { likes: sealed(likes), follows: sealed(follows), playlist: Math.max(...lists.map(sealed)) };
  const total = sizes.likes + sizes.follows + lists.map(sealed).reduce((a, b) => a + b, 0);
  assert.ok(sizes.likes < 1024 * 1024, `likes ${sizes.likes}`);
  assert.ok(sizes.follows < 1024 * 1024, `follows ${sizes.follows}`);
  assert.ok(sizes.playlist < 1024 * 1024, `a playlist ${sizes.playlist}`);
  assert.ok(total < 16 * 1024 * 1024, `all ${total}`);
  assert.ok(lists.length + 2 + 16 < 2000);
  console.log(`sizes (sealed, deflated): likes ${Math.round(sizes.likes / 1024)} KiB, follows ${Math.round(sizes.follows / 1024)} KiB, biggest playlist ${Math.round(sizes.playlist / 1024)} KiB, all ${Math.round(total / 1024)} KiB`);
});
