import { join } from "node:path";
import { app } from "electron";
import type { MusicProvider } from "@shared/provider";
import type { Page, QueueSource, Track } from "@shared/types";
import { JsonFile } from "./store/json-file";

/**
 * Likes kept on this computer (Settings → Playback → Keep likes on this computer, on by default): ♥ never goes to
 * SoundCloud — its bot protection asked for a check on likes, and the check page cost people their sign-in. "Liked
 * tracks" shows them first, then the account's SoundCloud likes; un-♥-ing one of those hides it here (SoundCloud keeps
 * it). Files from this computer can be liked too. The backup (main/backup) carries them to another computer.
 */
export interface LikesData {
  /** newest last */
  liked: { id: number; at: number }[];
  /** SoundCloud likes un-♥-ed in the app */
  hidden: number[];
}

let file: JsonFile<LikesData> | null = null;
const store = () => (file ??= new JsonFile<LikesData>(join(app.getPath("userData"), "local-likes.json"), { liked: [], hidden: [] }, 500));
export const flushLocalLikes = () => file?.flush();

/** Everything about them, for the backup. */
export const likesData = (): LikesData => store().get();

/** Likes from a backup, added to these (nothing here is lost); how many were new. */
export function mergeLikes(from: LikesData): number {
  const have = store().get();
  const ids = new Set(have.liked.map((l) => l.id));
  const added = (Array.isArray(from.liked) ? from.liked : []).filter((l) => Number.isSafeInteger(l?.id) && l.id > 0 && !ids.has(l.id)).map((l) => ({ id: l.id, at: Number(l.at) || Date.now() }));
  const hidden = [...new Set([...have.hidden, ...(Array.isArray(from.hidden) ? from.hidden.filter((x) => Number.isSafeInteger(x) && x > 0) : [])])];
  store().patch({ liked: [...added, ...have.liked].sort((a, b) => a.at - b.at), hidden });
  if (added.length) changed();
  return added.length;
}

let onChange: (() => void) | null = null;
/** Called after every change (the backup goes out a little later). */
export const onLikesChange = (fn: () => void) => (onChange = fn);
const changed = () => onChange?.();

const localIds = () => [...store().get().liked].reverse().map((l) => l.id);

/**
 * The provider with this computer's likes in front of SoundCloud's, while `on()` (the setting). SoundCloud's own
 * likes still come along (read only), the hidden ones and the ones liked here too left out.
 */
export function withLocalLikes(p: MusicProvider, on: () => boolean): MusicProvider {
  const scIds = async () => {
    try {
      return await p.getLikedIds();
    } catch {
      // signed out (or SoundCloud didn't answer): this computer's likes only
      return [];
    }
  };
  const visible = (ids: number[]) => {
    const skip = new Set([...store().get().hidden, ...store().get().liked.map((l) => l.id)]);
    return ids.filter((id) => !skip.has(id));
  };
  const own: Partial<MusicProvider> = {
    async getLikes(cursor?: string | null): Promise<Page<Track>> {
      if (!on()) return p.getLikes(cursor);
      const keep = (page: Page<Track>) => ({ items: page.items.filter((t) => visible([t.id]).length), next: page.next });
      if (cursor) return keep(await p.getLikes(cursor));
      // the first page: everything liked here (newest first), then SoundCloud's first page
      const ids = localIds();
      const mine: Track[] = [];
      for (let i = 0; i < ids.length; i += 200) mine.push(...(await p.getTracks(ids.slice(i, i + 200))));
      const sc = await p.getLikes(null).then(keep, () => ({ items: [] as Track[], next: null }));
      return { items: [...mine, ...sc.items], next: sc.next };
    },
    async getLikedIds(refresh?: boolean): Promise<number[]> {
      if (!on()) return p.getLikedIds(refresh);
      if (refresh) await p.getLikedIds(true).catch(() => []);
      return [...localIds(), ...visible(await scIds())];
    },
    async getSourceIds(source: QueueSource): Promise<number[]> {
      if (!on() || source.kind !== "likes" || source.userId !== "me") return p.getSourceIds(source);
      const sc = await p.getSourceIds(source).catch(() => [] as number[]);
      return [...localIds(), ...visible(sc)];
    },
    async like(id: number) {
      if (!on()) return p.like(id);
      const s = store().get();
      if (!s.liked.some((l) => l.id === id)) store().patch({ liked: [...s.liked, { id, at: Date.now() }] });
      store().patch({ hidden: store().get().hidden.filter((x) => x !== id) });
      changed();
    },
    async unlike(id: number) {
      if (!on()) return p.unlike(id);
      const s = store().get();
      const wasHere = s.liked.some((l) => l.id === id);
      store().patch({ liked: s.liked.filter((l) => l.id !== id) });
      // a SoundCloud like: hidden here (SoundCloud keeps it — no request goes there)
      if (!wasHere || (await scIds()).includes(id)) store().patch({ hidden: [...new Set([...store().get().hidden, id])] });
      changed();
    },
  };
  return new Proxy(p, {
    get(target, key, receiver) {
      if (typeof key === "string" && key in own) return own[key as keyof MusicProvider];
      const v: unknown = Reflect.get(target, key, receiver);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}
