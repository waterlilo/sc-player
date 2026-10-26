import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { SteamWallpaper } from "@shared/types";
import { allowImport } from "./background";

/**
 * Video wallpapers from Wallpaper Engine's Steam Workshop, as a background: a workshop link names the item, and Steam
 * itself keeps the files of the items one subscribes to in <library>/steamapps/workshop/content/431960/<id>. Nothing
 * is downloaded here — an item that isn't on this computer is subscribed to in Steam first.
 */
const WALLPAPER_ENGINE = "431960";

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

function steamPath(): Promise<string | null> {
  return new Promise((done) => {
    execFile("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], { windowsHide: true }, (err, out) => {
      const m = !err && /SteamPath\s+REG_SZ\s+(.+)/.exec(out);
      done(m ? m[1]!.trim().replace(/\//g, "\\") : null);
    });
  });
}

/** Every Steam library folder on this computer (the main one, and those listed in libraryfolders.vdf). */
async function libraries(): Promise<string[]> {
  const roots = new Set<string>();
  const main = (await steamPath()) ?? "C:\\Program Files (x86)\\Steam";
  roots.add(main);
  try {
    const vdf = readFileSync(join(main, "steamapps", "libraryfolders.vdf"), "utf8");
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) roots.add(m[1]!.replace(/\\\\/g, "\\"));
  } catch {
    /* no Steam, or an old one */
  }
  return [...roots].filter((r) => existsSync(r));
}

/** The wallpaper's video, when Steam has it here; served to the page as scbg://import/<token> (that file only). */
export async function findWallpaper(id: string): Promise<SteamWallpaper> {
  for (const lib of await libraries()) {
    const dir = join(lib, "steamapps", "workshop", "content", WALLPAPER_ENGINE, id);
    let project: { type?: unknown; file?: unknown; title?: unknown };
    try {
      project = JSON.parse(readFileSync(join(dir, "project.json"), "utf8")) as typeof project;
    } catch {
      continue;
    }
    // scenes and web wallpapers are drawn by Wallpaper Engine itself: there is no video to take
    if (String(project.type).toLowerCase() !== "video" || typeof project.file !== "string") return { found: false, id, reason: "not-video" };
    const file = resolve(dir, project.file);
    if (!file.startsWith(dir + sep) || !/\.(mp4|webm)$/i.test(file) || !existsSync(file)) return { found: false, id, reason: "not-video" };
    return { found: true, id, title: typeof project.title === "string" ? project.title.slice(0, 100) : id, sizeMb: Math.round(statSync(file).size / 1048576), url: allowImport(file) };
  }
  return { found: false, id, reason: "missing" };
}
