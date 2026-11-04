import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix } from "node:path";

/** The item id in a workshop link ("…/sharedfiles/filedetails/?id=123"), or the id itself. */
export function workshopId(link: string): string | null {
  const s = link.trim();
  if (/^\d{6,12}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (!/(^|\.)steamcommunity\.com$/.test(u.hostname)) return null;
    const id = u.searchParams.get("id");
    return id && /^\d{6,12}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Default Steam directory per operating system. */
export function defaultSteamPath(platform = process.platform, home = homedir()): string {
  if (platform === "darwin") return posix.join(home, "Library/Application Support/Steam");
  if (platform === "linux") return posix.join(home, ".local/share/Steam");
  return "C:\\Program Files (x86)\\Steam";
}

/** Linux: where Steam lives — the usual link, the folder itself, the Flatpak's */
const linuxSteamPaths = (home: string) => [posix.join(home, ".steam/steam"), posix.join(home, ".local/share/Steam"), posix.join(home, ".var/app/com.valvesoftware.Steam/.local/share/Steam")];

/** Parse library folders from Steam's libraryfolders.vdf */
export function parseLibraryFolders(vdf: string): string[] {
  const folders: string[] = [];
  for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
    folders.push(m[1]!.replace(/\\\\/g, "\\"));
  }
  return folders;
}

export function querySteamRegistry(): Promise<string | null> {
  return new Promise((done) => {
    execFile("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], { windowsHide: true }, (err, out) => {
      const m = !err && /SteamPath\s+REG_SZ\s+(.+)/.exec(out);
      done(m ? m[1]!.trim().replace(/\//g, "\\") : null);
    });
  });
}

export async function resolveSteamPath(platform = process.platform, home = homedir()): Promise<string | null> {
  if (platform === "darwin") {
    const macPath = defaultSteamPath("darwin", home);
    return existsSync(macPath) ? macPath : null;
  }
  if (platform === "linux") return linuxSteamPaths(home).find((p) => existsSync(p)) ?? null;
  return querySteamRegistry();
}

/** Every Steam library folder on this computer (the main one, and those listed in libraryfolders.vdf). */
export async function steamLibraries(platform = process.platform, home = homedir()): Promise<string[]> {
  const roots = new Set<string>();
  const main = (await resolveSteamPath(platform, home)) ?? defaultSteamPath(platform, home);
  roots.add(main);
  try {
    const vdf = readFileSync(join(main, "steamapps", "libraryfolders.vdf"), "utf8");
    for (const folder of parseLibraryFolders(vdf)) roots.add(folder);
  } catch {
    /* no Steam, or an old one */
  }
  return [...roots].filter((r) => existsSync(r));
}
