import { diffMap, live, orderOf, placeOrder, SCHEMA_V, spread, type Doc, type Entry, type Map, type Stamp, type Want } from "./merge.ts";

/**
 * This computer's data as sync documents and back (design §8.4): likes, own playlists, own lyrics and the friend
 * code. `…Changes` give only what changed here since the shadow (the document as last applied here), ready to merge
 * over the server's; `…From` turn a merged document back into what the modules keep. Pure: the engine does the I/O.
 */

export const emptyDoc = (kind: string, name: string): Doc => ({ v: SCHEMA_V, kind, name, rev: 0, by: "" });
const map = (d: Doc | null, f: string) => (d?.[f] ?? {}) as Map;
const ms = (at: number) => Math.floor(at / 1000);
/** a time this computer kept in milliseconds, as a clock value (first sync keeps when things were made) */
const hlc = (t: unknown) => (typeof t === "number" && Number.isFinite(t) && t > 0 ? Math.floor(t) * 1000 : 1000);
const scArtwork = (v: unknown) => (typeof v === "string" && /^https:\/\/[\w.-]+\.sndcdn\.com\//.test(v) ? v : null);
const trackId = (k: string) => /^\d{1,16}$/.test(k) && Number.isSafeInteger(Number(k)) && Number(k) > 0;

// ---- likes ---------------------------------------------------------------------------------------------------------

export interface LikesShape {
  liked: { id: number; at: number }[];
  hidden: number[];
  playlists?: { playlist: { id: string }; at: number }[];
  hiddenPlaylists?: string[];
}

export function likesChanges(d: LikesShape, shadow: Doc | null, stamp: () => Stamp, first: boolean): Doc {
  const at = new globalThis.Map<string, number>();
  const tracks: Record<string, Want> = {};
  for (const l of d.liked) {
    tracks[String(l.id)] = { on: true };
    at.set(`t${l.id}`, hlc(l.at));
  }
  const lists: Record<string, Want> = {};
  for (const l of d.playlists ?? []) {
    lists[l.playlist.id] = { on: true, playlist: l.playlist };
    at.set(`l${l.playlist.id}`, hlc(l.at));
  }
  const set = (xs: (string | number)[]) => Object.fromEntries(xs.map((x) => [String(x), { on: true } as Want]));
  // hidden ones have no time of their own: on a first sync anything from elsewhere wins over them
  const firstAt = (p: string) => (first ? (k: string) => at.get(p + k) ?? 1000 : undefined);
  return {
    ...emptyDoc("likes", "likes"),
    tracks: diffMap(tracks, map(shadow, "tracks"), stamp, { on: false }, firstAt("t")),
    hidden: diffMap(set(d.hidden), map(shadow, "hidden"), stamp, { on: false }, firstAt("h")),
    lists: diffMap(lists, map(shadow, "lists"), stamp, { on: false }, firstAt("l")),
    hiddenLists: diffMap(set(d.hiddenPlaylists ?? []), map(shadow, "hiddenLists"), stamp, { on: false }, firstAt("x")),
  };
}

const byAt = (m: Map) => Object.entries(m).filter(([, e]) => live(e)).sort(([, a], [, b]) => a.at - b.at);

export function likesFrom(doc: Doc): Required<LikesShape> {
  return {
    liked: byAt(map(doc, "tracks"))
      .filter(([k]) => trackId(k))
      .map(([k, e]) => ({ id: Number(k), at: ms(e.at) })),
    hidden: byAt(map(doc, "hidden"))
      .filter(([k]) => trackId(k))
      .map(([k]) => Number(k)),
    playlists: byAt(map(doc, "lists"))
      .filter(([k, e]) => e.playlist && typeof e.playlist === "object" && (e.playlist as { id?: unknown }).id === k)
      .map(([, e]) => ({ playlist: e.playlist as { id: string }, at: ms(e.at) })),
    hiddenPlaylists: byAt(map(doc, "hiddenLists")).map(([k]) => k),
  };
}

// ---- own lyrics: 16 documents, by track id mod 16 ------------------------------------------------------------------

export const lyricsShard = (trackId: string | number) => (Number(trackId) % 16).toString(16);
export const LYRICS_SHARDS = Array.from({ length: 16 }, (_, i) => i.toString(16));

export function lyricsChanges(byTrack: Record<string, { text: string; at: number }>, shard: string, shadow: Doc | null, stamp: () => Stamp, first: boolean): Doc {
  const want: Record<string, Want> = {};
  for (const [id, v] of Object.entries(byTrack)) if (lyricsShard(id) === shard) want[id] = { text: v.text };
  return { ...emptyDoc("lyrics", `lyrics:${shard}`), byTrack: diffMap(want, map(shadow, "byTrack"), stamp, { text: null }, first ? (k) => hlc(byTrack[k]?.at) : undefined) };
}

export function lyricsFrom(doc: Doc): Record<string, { text: string; at: number }> {
  const out: Record<string, { text: string; at: number }> = {};
  for (const [k, e] of Object.entries(map(doc, "byTrack"))) if (trackId(k) && typeof e.text === "string" && e.text.length <= 30_000) out[k] = { text: e.text, at: ms(e.at) };
  return out;
}

// ---- own playlists: a document each --------------------------------------------------------------------------------

export interface ListShape {
  id: string;
  title: string;
  items: { id: number; durationMs: number; artworkUrl: string | null }[];
  created: number;
  from?: string;
}

const reg = (v: unknown, s: Stamp): Entry => ({ v, ...s });

/**
 * One playlist's changes. `list` null: deleted here. A new one (no shadow) goes whole, its tracks spread evenly; after
 * that only a new title, tracks in or out, and the tracks that really moved (see placeOrder).
 */
export function playlistChanges(list: ListShape | null, shadow: Doc | null, stamp: () => Stamp, first: boolean): Doc | null {
  const name = `pl:${list?.id ?? String(shadow?.id)}`;
  if (!list) {
    if (!shadow || (shadow.deleted as Entry | undefined)?.v === true) return null;
    return { ...emptyDoc("playlist", name), id: shadow.id, deleted: reg(true, stamp()), items: {} };
  }
  const base = { ...emptyDoc("playlist", name), id: list.id, created: list.created, ...(list.from ? { from: list.from } : {}) };
  const t0 = first || !shadow ? { at: hlc(list.created), by: stamp().by } : null;
  const s = () => t0 ?? stamp();
  const want: Record<string, Want> = {};
  for (const i of list.items) want[String(i.id)] = { on: true, durationMs: i.durationMs, artworkUrl: i.artworkUrl };
  const items = diffMap(want, map(shadow, "items"), s, { on: false }, t0 ? () => t0.at : undefined);
  const order = list.items.map((i) => String(i.id));
  const pos = shadow ? placeOrder(order, map(shadow, "items")) : Object.fromEntries(order.map((k, i) => [k, spread(order.length)[i]!]));
  const moved: Map = {};
  for (const [k, p] of Object.entries(pos)) {
    const st = s();
    const was = items[k] ?? map(shadow, "items")[k];
    moved[k] = { ...(was as Entry), pos: p, posAt: st.at, posBy: st.by };
  }
  const out: Doc = { ...base, items: { ...items, ...moved } };
  const title = shadow?.title as Entry | undefined;
  if (!title || title.v !== list.title) out.title = reg(list.title, s());
  if (!shadow) out.deleted = reg(false, s());
  return out;
}

/** A playlist as kept here, or null when it was deleted (or the document makes no sense). */
export function playlistFrom(doc: Doc): ListShape | null {
  if ((doc.deleted as Entry | undefined)?.v === true || typeof doc.id !== "string" || !/^local-[0-9a-f]{16}$/.test(doc.id)) return null;
  const items = map(doc, "items");
  const title = (doc.title as Entry | undefined)?.v;
  return {
    id: doc.id,
    title: typeof title === "string" ? title.slice(0, 100) : "",
    items: orderOf(items)
      .filter(trackId)
      .map((k) => ({ id: Number(k), durationMs: Math.max(0, Number(items[k]!.durationMs) || 0), artworkUrl: scArtwork(items[k]!.artworkUrl) })),
    created: typeof doc.created === "number" ? doc.created : 0,
    ...(typeof doc.from === "string" && /^[\w:-]{1,80}$/.test(doc.from) ? { from: doc.from } : {}),
  };
}

/** The same name and tracks: the key a restored copy's playlist (with a new id) is matched by on a first sync. */
export const listKey = (title: string, ids: number[]) => `${title}\u0000${ids.join(",")}`;

// ---- the friend code -----------------------------------------------------------------------------------------------

/**
 * The friend code's secret: the first device with one puts it in; one without takes it (as restoring a backup did).
 * A device with a code of its own keeps it, the account's stays as it is.
 */
export function secretsChanges(friend: string | null, shadow: Doc | null, server: Doc | null, stamp: () => Stamp): Doc {
  const out = emptyDoc("secrets", "secrets");
  const has = (d: Doc | null) => typeof (d?.friend as Entry | undefined)?.v === "string";
  if (friend && !has(server) && !has(shadow)) out.friend = reg(friend, stamp());
  return out;
}

export const friendFrom = (doc: Doc | null): string | null => {
  const v = (doc?.friend as Entry | undefined)?.v;
  return typeof v === "string" && v.length >= 20 && v.length <= 100 ? v : null;
};
