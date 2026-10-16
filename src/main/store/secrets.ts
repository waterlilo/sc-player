import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";

/**
 * Tokens and secrets, encrypted with the OS (DPAPI on Windows) through safeStorage. If encryption is unavailable they
 * stay in memory for this run only — never written as plain text.
 */
type Key = "sessionToken" | "officialClientSecret" | "officialRefreshToken" | "proxyPassword";

const memory = new Map<Key, string>();
const path = () => join(app.getPath("userData"), "secrets.bin");

function load(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(path(), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

export function getSecret(key: Key): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  const sealed = load()[key];
  if (!sealed) return null;
  try {
    const value = safeStorage.decryptString(Buffer.from(sealed, "base64"));
    memory.set(key, value);
    return value;
  } catch {
    return null;
  }
}

export function setSecret(key: Key, value: string | null) {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  if (!safeStorage.isEncryptionAvailable()) return;
  const all = load();
  if (value === null) delete all[key];
  else all[key] = safeStorage.encryptString(value).toString("base64");
  writeFileSync(path(), JSON.stringify(all));
}

export function clearSecrets() {
  memory.clear();
  rmSync(path(), { force: true });
}
