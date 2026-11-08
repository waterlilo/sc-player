/**
 * The sync documents and how two of them merge (design §8). Pure functions, no I/O: the engine (main/sync/engine)
 * feeds them, the tests and the Android client check against them.
 *
 * A document is JSON: `{v, kind, name, rev, by, …}`. Its changing parts are *registers* (`{v, at, by}`: a playlist's
 * title) and *maps* of entries (`{"123": {on, at, by, …}}`: liked tracks). Every register and entry carries a stamp:
 * `at` is a hybrid logical clock (milliseconds × 1000 + a counter) and `by` the writing install's tag. The bigger
 * `(at, by)` wins, compared the same way on every platform. Removing leaves a tombstone (`on: false`, `text: null`),
 * so a removal travels like any other change. Merging is commutative, associative and idempotent: the order changes
 * arrive in, and retries after a conflict, don't matter.
 */

export const SCHEMA_V = 1;
/** tombstones older than this are dropped when a document is written (devices away longer resync in full) */
export const TOMB_DAYS = 180;

export interface Stamp {
  at: number;
  by: string;
}
export type Entry = Stamp & Record<string, unknown>;
export type Map = Record<string, Entry>;
export interface Doc {
  v: number;
  kind: string;
  name: string;
  rev: number;
  by: string;
  [field: string]: unknown;
}

/** Which fields of each kind are maps and which are registers; anything else is a fixed field (a playlist's id). */
const SCHEMA: Record<string, { maps: string[]; regs: string[] }> = {
  likes: { maps: ["tracks", "hidden", "lists", "hiddenLists"], regs: [] },
  playlist: { maps: ["items"], regs: ["title", "deleted"] },
  lyrics: { maps: ["byTrack"], regs: [] },
  secrets: { maps: [], regs: ["friend"] },
  follows: { maps: ["users"], regs: [] },
};

/** `a` wins over `b`: a later stamp, or the same time and the bigger tag. */
export const newer = (a: Stamp, b: Stamp) => a.at > b.at || (a.at === b.at && a.by > b.by);

const isStamp = (v: unknown): v is Stamp => !!v && typeof v === "object" && typeof (v as Stamp).at === "number" && typeof (v as Stamp).by === "string";
/** a removal: un-♥, a track taken out, own words given back */
export const isTomb = (e: Entry) => e.on === false || e.text === null;
export const live = (e: Entry | undefined): e is Entry => !!e && !isTomb(e);

// ---- the clock -----------------------------------------------------------------------------------------------------

/**
 * A hybrid logical clock. Physical time is this computer's, corrected by the server's (`offset`, from each sync
 * answer); a new stamp is never below one already seen, so a change made here always beats what it replaced.
 */
export class Clock {
  last: number;
  offset: number;
  constructor(last = 0, offset = 0) {
    this.last = last;
    this.offset = offset;
  }
  now(): number {
    this.last = Math.max(Math.floor((Date.now() + this.offset) * 1000), this.last + 1);
    return this.last;
  }
  /** Stamps seen in documents from elsewhere: ours go after them. */
  see(at: number) {
    if (Number.isSafeInteger(at) && at > this.last) this.last = at;
  }
}

/**
 * A stamp from a computer whose clock runs far ahead (2099) would win every conflict for ever: one more than a day
 * past the server's time is read as the server's time.
 */
export interface Cap {
  /** stamps above this… */
  above: number;
  /** …count as this */
  to: number;
}
export const capFor = (serverMs: number): Cap => ({ above: (serverMs + 86_400_000) * 1000, to: serverMs * 1000 });

function capEntry<T extends Entry>(e: T, cap?: Cap): T {
  if (!cap) return e;
  let out = e;
  if (e.at > cap.above) out = { ...out, at: cap.to };
  if (typeof e.posAt === "number" && e.posAt > cap.above) out = { ...out, posAt: cap.to };
  return out;
}

// ---- merging -------------------------------------------------------------------------------------------------------

function pickReg(field: string, a: unknown, b: unknown, cap?: Cap): Entry | undefined {
  const x = isStamp(a) ? capEntry(a as Entry, cap) : undefined;
  const y = isStamp(b) ? capEntry(b as Entry, cap) : undefined;
  if (!x || !y) return x ?? y;
  // a deleted playlist stays deleted: an edit made elsewhere at the same time doesn't bring it back
  if (field === "deleted" && (x.v === true) !== (y.v === true)) return x.v === true ? x : y;
  return newer(x, y) ? x : y;
}

/** A playlist track: being in the list and its place in it are two registers, so a move can't undo a removal. */
function mergeItem(x: Entry, y: Entry): Entry {
  const m = newer(x, y) ? x : y;
  const px = typeof x.posAt === "number" ? { at: x.posAt, by: String(x.posBy ?? "") } : null;
  const py = typeof y.posAt === "number" ? { at: y.posAt, by: String(y.posBy ?? "") } : null;
  const p = !px ? y : !py ? x : newer(px, py) ? x : y;
  return { ...m, pos: p.pos, posAt: p.posAt, posBy: p.posBy };
}

function mergeMap(kind: string, field: string, a: unknown, b: unknown, cap?: Cap): Map {
  const x = (a && typeof a === "object" ? a : {}) as Map;
  const y = (b && typeof b === "object" ? b : {}) as Map;
  const out: Map = {};
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const ex = isStamp(x[k]) ? capEntry(x[k], cap) : undefined;
    const ey = isStamp(y[k]) ? capEntry(y[k], cap) : undefined;
    if (!ex || !ey) out[k] = (ex ?? ey)!;
    else out[k] = kind === "playlist" && field === "items" ? mergeItem(ex, ey) : newer(ex, ey) ? ex : ey;
  }
  return out;
}

/**
 * Two versions of a document as one. Fixed and unknown fields come from `a` (the server's, by convention), filled
 * from `b`; every register and entry is the winner of the two. `cap` tames stamps from the future.
 */
export function mergeDocs(a: Doc, b: Doc, cap?: Cap): Doc {
  const s = SCHEMA[a.kind] ?? { maps: [], regs: [] };
  const out: Doc = { ...b, ...a, v: Math.max(a.v, b.v), rev: Math.max(a.rev, b.rev) };
  for (const f of s.regs) {
    const r = pickReg(f, a[f], b[f], cap);
    if (r) out[f] = r;
  }
  for (const f of s.maps) out[f] = mergeMap(a.kind, f, a[f], b[f], cap);
  // a deleted playlist keeps no tracks: less to store, nothing to bring back
  if (a.kind === "playlist" && (out.deleted as Entry | undefined)?.v === true) out.items = {};
  return out;
}

/** Tombstones older than `before` (a clock value) dropped: written documents stay small. */
export function gcDoc(doc: Doc, before: number): Doc {
  const s = SCHEMA[doc.kind];
  if (!s) return doc;
  const out: Doc = { ...doc };
  for (const f of s.maps) {
    const m = (doc[f] ?? {}) as Map;
    out[f] = Object.fromEntries(Object.entries(m).filter(([, e]) => !(isTomb(e) && e.at < before)));
  }
  return out;
}

/** Every stamp in a document (to move the clock past them). */
export function stampsOf(doc: Doc): number[] {
  const s = SCHEMA[doc.kind] ?? { maps: [], regs: [] };
  const out: number[] = [];
  for (const f of s.regs) if (isStamp(doc[f])) out.push((doc[f] as Stamp).at);
  for (const f of s.maps) for (const e of Object.values((doc[f] ?? {}) as Map)) out.push(e.at, typeof e.posAt === "number" ? e.posAt : 0);
  return out;
}

/** JSON with sorted keys: the same document always reads the same. */
export function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

/** The same content (who wrote it last and how many times aside). */
export const sameContent = (a: Doc | null, b: Doc | null) => !!a && !!b && canon({ ...a, rev: 0, by: "" }) === canon({ ...b, rev: 0, by: "" });

// ---- changes made here ---------------------------------------------------------------------------------------------

/** What an entry should hold (no stamp), as this computer's data says now. */
export type Want = Record<string, unknown>;

const sameWant = (want: Want, e: Entry | undefined) => !!e && Object.keys(want).every((k) => canon(want[k]) === canon(e[k]));

/**
 * The entries of one map that changed here since `shadow` (what this computer last agreed with): new or different
 * ones stamped now, and tombstones for live ones gone from `want`. On a first sync (`first`) nothing is removed and
 * entries keep the time they were made (`firstAt`), so joining a vault only ever adds.
 */
export function diffMap(want: Record<string, Want>, shadow: Map | undefined, stamp: () => Stamp, tomb: Want, first?: (key: string) => number): Map {
  const out: Map = {};
  const old = shadow ?? {};
  for (const [k, w] of Object.entries(want)) {
    const e = old[k];
    if (live(e) && sameWant(w, e)) continue;
    // fields a newer version added to the entry stay as they were
    out[k] = { ...(e ?? {}), ...w, ...(first ? { at: first(k), by: stamp().by } : stamp()) } as Entry;
  }
  if (!first) for (const [k, e] of Object.entries(old)) if (live(e) && !(k in want)) out[k] = { ...tomb, ...stamp() } as Entry;
  return out;
}

// ---- playlist order ------------------------------------------------------------------------------------------------

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * A fractional index between `a` and `b` (base 62, compared as plain strings; null = the start or the end). Keys never
 * end in "0", so there is always room between two of them.
 */
export function between(a: string | null, b: string | null): string {
  const lo = a ?? "";
  if (b !== null && lo >= b) throw new Error("positions out of order");
  return midpoint(lo, b);
}

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? DIGITS.indexOf(a[0]!) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)]!;
  if (b !== null && b.length > 1) return b[0]!;
  return DIGITS[da]! + midpoint(a.slice(1), null);
}

/** `n` positions spread evenly (a fresh list, or a renumbering when keys grew long). */
export function spread(n: number): string[] {
  const width = Math.max(2, Math.ceil(Math.log(n + 2) / Math.log(62)) + 1);
  const span = 62 ** width;
  return Array.from({ length: n }, (_, i) => {
    let v = Math.floor(((i + 1) * span) / (n + 1));
    let s = "";
    for (let d = 0; d < width; d++) {
      s = DIGITS[v % 62]! + s;
      v = Math.floor(v / 62);
    }
    return s.replace(/0+$/, "");
  });
}

/** Indexes of a longest increasing run in `xs` (the tracks that kept their relative order). */
function lis(xs: number[]): Set<number> {
  const tails: number[] = [];
  const prev = new Array<number>(xs.length).fill(-1);
  for (let i = 0; i < xs.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[tails[mid]!]! < xs[i]!) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const out = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = prev[i]!) out.add(i);
  return out;
}

/** A playlist's live tracks in order: by position, ties by track id. */
export function orderOf(items: Map): string[] {
  return Object.entries(items)
    .filter(([, e]) => live(e))
    .sort(([ka, a], [kb, b]) => {
      const pa = String(a.pos ?? "");
      const pb = String(b.pos ?? "");
      return pa < pb ? -1 : pa > pb ? 1 : Number(ka) - Number(kb);
    })
    .map(([k]) => k);
}

/**
 * New positions for the tracks that moved: the ones that kept their order (the longest increasing run) keep their
 * positions, the others get one between their new neighbours. Returns track id → position for the moved and the new.
 */
export function placeOrder(order: string[], shadowItems: Map): Record<string, string> {
  const was = orderOf(shadowItems);
  const index = new globalThis.Map(was.map((k, i) => [k, i]));
  const known = order.map((k, i) => ({ k, i, at: index.get(k) })).filter((x): x is { k: string; i: number; at: number } => x.at !== undefined);
  const keep = new Set([...lis(known.map((x) => x.at))].map((j) => known[j]!.k));
  const posOf = (k: string) => String(shadowItems[k]?.pos ?? "");
  const out: Record<string, string> = {};
  let prev: string | null = null;
  try {
    for (let i = 0; i < order.length; i++) {
      const k = order[i]!;
      if (keep.has(k) && posOf(k) && (prev === null || posOf(k) > prev)) {
        prev = posOf(k);
        continue;
      }
      let next: string | null = null;
      for (let j = i + 1; j < order.length; j++)
        if (keep.has(order[j]!) && posOf(order[j]!)) {
          next = posOf(order[j]!);
          break;
        }
      prev = between(prev, next);
      out[k] = prev;
    }
    if (!Object.values(out).some((p) => p.length > 16)) return out;
  } catch {
    // equal positions (two devices put tracks in the same spot): number them all again
  }
  const fresh = spread(order.length);
  return Object.fromEntries(order.map((k, i) => [k, fresh[i]!]));
}
