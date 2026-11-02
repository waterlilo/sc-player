import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
export function defaultSteamPath(platform = process.platform, home = process.env.HOME || ""): string {
  if (platform === "darwin") {
    return join(home, "Library/Application Support/Steam");
  }
  return "C:\\Program Files (x86)\\Steam";
}

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

export async function resolveSteamPath(platform = process.platform, home = process.env.HOME || ""): Promise<string | null> {
  if (platform === "darwin") {
    const macPath = defaultSteamPath("darwin", home);
    return existsSync(macPath) ? macPath : null;
  }
  return querySteamRegistry();
}

/** Every Steam library folder on this computer (the main one, and those listed in libraryfolders.vdf). */
export async function steamLibraries(platform = process.platform, home = process.env.HOME || ""): Promise<string[]> {
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
