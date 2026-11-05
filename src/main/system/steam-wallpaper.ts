import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { SteamWallpaper } from "@shared/types";
import { allowImport } from "./background";
import { steamLibraries, workshopId } from "./steam-path";

export { workshopId };

/**
 * Video wallpapers from Wallpaper Engine's Steam Workshop, as a background: a workshop link names the item, and Steam
 * itself keeps the files of the items one subscribes to in <library>/steamapps/workshop/content/431960/<id>. Nothing
 * is downloaded here — an item that isn't on this computer is subscribed to in Steam first.
 */
const WALLPAPER_ENGINE = "431960";

/** The wallpaper's video, when Steam has it here; served to the page as scbg://import/<token> (that file only). */
export async function findWallpaper(id: string): Promise<SteamWallpaper> {
  for (const lib of await steamLibraries()) {
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
