import { join } from "node:path";
import { app } from "electron";
import { JsonFile } from "../store/json-file";
import { MATCH_VERSION } from "./match";

/**
 * Remembered answers to "is there another, playable upload of this track?" so the same track is not searched again
 * and again: a find is kept for 30 days, "nothing found" for a day (a re-upload may appear).
 */
const FOUND_TTL = 30 * 24 * 3600 * 1000;
const NONE_TTL = 24 * 3600 * 1000;
const LIMIT = 5000;

type Entry = { at: number; ids: number[]; tolerance: number; v?: number };
type Store = { entries: Record<string, Entry> };
let file: JsonFile<Store> | null = null;
const cache = () => (file ??= new JsonFile<Store>(join(app.getPath("userData"), "alternatives.json"), { entries: {} }, 2000));

export function cachedAlternatives(trackId: number, tolerance: number): number[] | null {
  const e = cache().get().entries[String(trackId)];
  if (!e || e.tolerance !== tolerance || e.v !== MATCH_VERSION) return null;
  return Date.now() - e.at < (e.ids.length ? FOUND_TTL : NONE_TTL) ? e.ids : null;
}

export function rememberAlternatives(trackId: number, tolerance: number, ids: number[]) {
  const entries: Record<string, Entry> = { ...cache().get().entries, [String(trackId)]: { at: Date.now(), ids, tolerance, v: MATCH_VERSION } };
  const keys = Object.keys(entries);
  if (keys.length > LIMIT) for (const k of keys.slice(0, keys.length - LIMIT)) delete entries[k];
  cache().patch({ entries });
}

export function flushAlternatives() {
  file?.flush();
}
