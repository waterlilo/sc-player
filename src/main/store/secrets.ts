import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import { log } from "../system/log";

/**
 * Tokens and secrets, encrypted with the OS (DPAPI on Windows) through safeStorage. If encryption is unavailable they
 * stay in memory for this run only — never written as plain text.
 *
 * A secret that can't be opened is not the same as no secret: a run whose encryption key never reached the disk (seen
 * after installing over a running app) writes values the next run can't open, and the older value it overwrote was
 * the user's account. So every account value replaced or removed is kept sealed under "<key>~old" (the last few), and when
 * the current one can't be opened the newest old one that can is put back.
 */
type Key = "sessionToken" | "officialClientSecret" | "officialRefreshToken" | "proxyPassword" | "socialSecret" | "moderatorToken" | "backupKey";

const KEEP_OLD = 4;
/** the ones that are an account: kept when replaced (a removed moderator key or proxy password is simply gone) */
const GUARDED = new Set<Key>(["sessionToken", "officialRefreshToken", "socialSecret", "backupKey"]);
const memory = new Map<Key, string>();
const path = () => join(app.getPath("userData"), "secrets.bin");

type Sealed = Record<string, string | string[]>;

function load(): Sealed {
  try {
    return JSON.parse(readFileSync(path(), "utf8")) as Sealed;
  } catch {
    return {};
  }
}

function open(sealed: string): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(sealed, "base64"));
  } catch {
    return null;
  }
}

const olds = (all: Sealed, key: Key) => {
  const v = all[`${key}~old`];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
};
const keepOld = (all: Sealed, key: Key, sealed: string, drop?: string) => {
  all[`${key}~old`] = [sealed, ...olds(all, key).filter((s) => s !== sealed && s !== drop)].slice(0, KEEP_OLD);
};

export function getSecret(key: Key): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  const all = load();
  const sealed = all[key];
  if (typeof sealed !== "string" || !sealed) return null;
  const value = open(sealed);
  if (value !== null) {
    memory.set(key, value);
    return value;
  }
  // sealed with a key this run doesn't have: an older value that opens is the one to use
  const back = olds(all, key).find((s) => open(s) !== null);
  if (!back) {
    log("main", `secret ${key} can't be opened (kept as it is)`);
    return null;
  }
  log("main", `secret ${key} can't be opened: an earlier one is put back`);
  all[key] = back;
  keepOld(all, key, sealed, back);
  writeFileSync(path(), JSON.stringify(all));
  const restored = open(back)!;
  memory.set(key, restored);
  return restored;
}

/** The stored values this run can't open (nothing is changed): a sign that it started with another encryption key. */
export function unopenedSecrets(): string[] {
  if (!safeStorage.isEncryptionAvailable()) return [];
  return Object.entries(load()).flatMap(([k, v]) => (!k.includes("~") && typeof v === "string" && v && open(v) === null ? [v] : []));
}

export function setSecret(key: Key, value: string | null) {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  if (!safeStorage.isEncryptionAvailable()) return;
  const all = load();
  const was = all[key];
  if (GUARDED.has(key) && typeof was === "string" && was && open(was) !== value) keepOld(all, key, was);
  if (value === null) delete all[key];
  else all[key] = safeStorage.encryptString(value).toString("base64");
  writeFileSync(path(), JSON.stringify(all));
}

export function clearSecrets() {
  memory.clear();
  rmSync(path(), { force: true });
}
