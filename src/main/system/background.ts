import { randomBytes } from "node:crypto";
import { copyFileSync, createReadStream, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { Readable } from "node:stream";
import { app, dialog, protocol, type BrowserWindow } from "electron";

/**
 * Your own background for the studio design: an image, a GIF or a video picked in Settings. It is copied into
 * userData/backgrounds (so moving or deleting the original doesn't break it) and served to the page as
 * scbg://file/<name> — the page never gets a path on disk, and only files from that folder can be read.
 */
export const BG_SCHEME = "scbg";
const IMAGE = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const VIDEO = [".mp4", ".webm"];
const MAX_BYTES = 300 * 1024 * 1024;
const NAME = /^bg-\d+\.(png|jpe?g|webp|gif|mp4|webm)$/i;

const folder = () => join(app.getPath("userData"), "backgrounds");

/**
 * Before the app is ready: the scheme may stream (video seeking) and is treated like https. corsEnabled + bypassCSP:
 * the installed app's page is a file:// one, and Chromium refuses <video> from a scheme without them ("URL safety
 * check").
 */
export function registerBackgroundScheme() {
  // sclocal (main/local-tracks): music from this computer, played like a stream (seeking, the spectrum reads it)
  const privileges = { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true };
  protocol.registerSchemesAsPrivileged([
    { scheme: BG_SCHEME, privileges },
    { scheme: "sclocal", privileges },
  ]);
}

/**
 * Files the page may read once to make a background of them (a Steam wallpaper's video, scbg://import/<token>): only
 * those main found itself, by a random token.
 */
const imports = new Map<string, string>();
export function allowImport(path: string): string {
  for (const [token, p] of imports) if (p === path) return `${BG_SCHEME}://import/${token}`;
  const token = randomBytes(12).toString("hex");
  imports.set(token, path);
  return `${BG_SCHEME}://import/${token}`;
}
const importPath = (url: string) => imports.get(basename(new URL(url).pathname)) ?? null;

export function serveBackgrounds() {
  protocol.handle(BG_SCHEME, async (req) => {
    const u = new URL(req.url);
    const name = basename(decodeURIComponent(u.pathname));
    const path = u.host === "import" ? imports.get(name) : NAME.test(name) ? join(folder(), name) : null;
    if (!path) return new Response("not found", { status: 404 });
    return serveFile(path, req.headers.get("range"));
  });
}

const TYPES: Record<string, string> = { ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".wav": "audio/wav", ".mp4": "video/mp4", ".webm": "video/webm", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

/**
 * The file, or the part of it a Range header asks for (206): video seeking and the video converter (lib/videoFit)
 * read big files piece by piece — a file:// fetch answered every range with the whole file, and the converter ran
 * out of its cache on long videos.
 */
export function serveFile(path: string, range: string | null): Response {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return new Response("not found", { status: 404 });
  }
  // the page reads a few pixels of it for the accent colour, which needs CORS
  const headers = new Headers({ "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes", "Content-Type": TYPES[extname(path).toLowerCase()] ?? "application/octet-stream" });
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (!m[1] && !m[2])) {
    headers.set("Content-Length", String(size));
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { status: 200, headers });
  }
  // "bytes=a-b", "bytes=a-" or the last n bytes ("bytes=-n")
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, { status: 206, headers });
}

/**
 * The earlier backgrounds go (one at a time is kept). A video still playing can't be removed on Windows — it stays
 * "pending delete" and a second try fails with EPERM — so whatever can't go now goes next time, or at the next start.
 */
export function dropBackgrounds(keep = "") {
  let names: string[];
  try {
    names = readdirSync(folder());
  } catch {
    return;
  }
  for (const old of names)
    if (NAME.test(old) && old !== keep)
      try {
        rmSync(join(folder(), old), { force: true });
      } catch {
        /* still open: next time */
      }
}

export async function pickBackground(win: BrowserWindow | null): Promise<{ file: string; type: "image" | "video" } | null> {
  const options = { title: "Background", properties: ["openFile" as const], filters: [{ name: "Image, GIF or video", extensions: [...IMAGE, ...VIDEO].map((e) => e.slice(1)) }] };
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const src = res.filePaths[0];
  if (res.canceled || !src) return null;
  const ext = extname(src).toLowerCase();
  const type = VIDEO.includes(ext) ? "video" : IMAGE.includes(ext) ? "image" : null;
  if (!type) throw new Error("This file type can't be a background");
  if (statSync(src).size > MAX_BYTES) throw new Error("The file is too big for a background (300 MB at most)");
  mkdirSync(folder(), { recursive: true });
  // one background at a time: the previous copy goes
  dropBackgrounds();
  const file = `bg-${Date.now()}${ext}`;
  copyFileSync(src, join(folder(), file));
  return { file, type };
}

/** An imported video kept as it is (no 2K copy): copied like a picked file. */
export function keepImport(url: string): { file: string; type: "video" } {
  const src = importPath(url);
  if (!src) throw new Error("This video isn't there any more");
  if (statSync(src).size > MAX_BYTES) throw new Error("The file is too big for a background (300 MB at most)");
  mkdirSync(folder(), { recursive: true });
  dropBackgrounds();
  const file = `bg-${Date.now()}${extname(src).toLowerCase()}`;
  copyFileSync(src, join(folder(), file));
  return { file, type: "video" };
}

/** The size of the current own background (to know whether it fits the workshop); 0 when there is none. */
export function backgroundSize(file: string): number {
  try {
    return NAME.test(file) ? statSync(join(folder(), file)).size : 0;
  } catch {
    return 0;
  }
}

/** A background that came from elsewhere (a workshop theme): replaces the current one, like a picked file. */
export function saveBackground(data: Buffer, ext: string): { file: string; type: "image" | "video" } {
  const e = `.${ext.toLowerCase().replace(/^\./, "")}`;
  const type = VIDEO.includes(e) ? "video" : IMAGE.includes(e) ? "image" : null;
  if (!type) throw new Error("This file type can't be a background");
  mkdirSync(folder(), { recursive: true });
  dropBackgrounds();
  const file = `bg-${Date.now()}${e}`;
  writeFileSync(join(folder(), file), data);
  return { file, type };
}

/** The current own background's bytes (to publish it with a theme); null when there is none. */
export function readBackground(file: string): { data: Buffer; ext: string } | null {
  if (!NAME.test(file)) return null;
  try {
    return { data: readFileSync(join(folder(), file)), ext: extname(file).slice(1).toLowerCase() };
  } catch {
    return null;
  }
}
