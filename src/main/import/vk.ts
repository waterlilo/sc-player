/// <reference lib="dom" />
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, session, shell } from "electron";
import onestCyr400 from "@fontsource/onest/files/onest-cyrillic-400-normal.woff2?asset";
import onestCyr600 from "@fontsource/onest/files/onest-cyrillic-600-normal.woff2?asset";
import onestLat400 from "@fontsource/onest/files/onest-latin-400-normal.woff2?asset";
import onestLat600 from "@fontsource/onest/files/onest-latin-600-normal.woff2?asset";
import logoFile from "../../../assets/app-icon-small.svg?asset";
import type { ImportItem } from "@shared/types";
import { chromeUserAgent, ScError } from "../soundcloud";
import { lang, m } from "../i18n";
import { log } from "../system/log";
import { OTHER_VERSION, SAME_SONG, withVersion } from "./parse";

/**
 * VK Music opens to no one without an account (its audio API was closed in 2016; its playlist widget and pages come
 * empty), so it is read where the person is signed in:
 * - a VK window inside the app, of a session of its own kept in memory only and wiped when the window closes — the
 *   person signs in on VK's own page (the app never sees a password), opens "My music" or a playlist and presses the
 *   bar's "Import this page"; a pasted playlist link is read as soon as its page is there;
 * - or a bookmark in their own browser (`openVkBookmark`), which reads the page the same way and gives the tracks as
 *   lines of "Artist — Title 3:45" to paste here.
 * Both read the page as it shows the tracks (VK's `data-testid` marks, steadier than its class names), scrolling
 * to its end while VK adds the rest.
 */

const PARTITION = "vk-import";
/** the page's scripts never see what runs here, nor the bar */
const WORLD = 1077;
const HOSTS = /(^|\.)(vk\.com|vk\.ru|vk\.me|vk\.cc)$/i;

// ---- the look: the app's studio design (styles/studio.css) --------------------------------------------------------

const FONT = `"sc-onest", "Onest", "Segoe UI", system-ui, sans-serif`;
const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const CYRILLIC = "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116";
type Font = { weight: string; range: string; b64: string };
let fonts: Font[] | null = null;
/** Onest, the app's font, as base64 (the bar adds it to VK's page, the bookmark page carries it) */
const onest = (): Font[] =>
  (fonts ??= [
    [onestLat400, "400", LATIN],
    [onestLat600, "600", LATIN],
    [onestCyr400, "400", CYRILLIC],
    [onestCyr600, "600", CYRILLIC],
  ].flatMap(([file, weight, range]) => {
    try {
      return [{ weight: weight!, range: range!, b64: readFileSync(file!).toString("base64") }];
    } catch {
      return [];
    }
  }));
let logoSvg: string | null = null;
/** the app's mark (the title bar's), as svg markup */
const logo = (): string => {
  try {
    logoSvg ??= readFileSync(logoFile, "utf8").replace(/<!--[\s\S]*?-->/g, "").replace(/\s*\n\s*/g, "");
  } catch {
    logoSvg = "";
  }
  return logoSvg;
};

/** The bar's and the bookmark box's styles: dark glass, thin light lines, a light button, the lavender accent. */
const glassCss = (font: string) =>
  `.glass{box-sizing:border-box;color:#ececef;font:500 14px/1.45 ${font};letter-spacing:-.003em;` +
  "background:rgba(14,14,17,.86);-webkit-backdrop-filter:blur(30px) saturate(1.2);backdrop-filter:blur(30px) saturate(1.2);" +
  "border:1px solid rgba(255,255,255,.08);border-radius:10px;box-shadow:0 18px 50px rgba(0,0,0,.5)}" +
  ".brand{display:flex;align-items:center;gap:9px;font-weight:600;font-size:13px;white-space:nowrap}" +
  ".brand svg{width:20px;height:20px;border-radius:5px;flex:none}" +
  ".sep{width:1px;align-self:stretch;margin:2px 0;background:rgba(255,255,255,.1)}" +
  `button{border:0;border-radius:7px;padding:8px 14px;background:#ececef;color:#0b0b0d;font:600 13px/1.2 ${font};cursor:pointer;white-space:nowrap;transition:background .15s}` +
  "button:hover{background:#fff}button.q{background:rgba(255,255,255,.06);color:#ececef;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}" +
  "button.q:hover{background:rgba(255,255,255,.1)}.n{color:rgb(178,160,230);font-variant-numeric:tabular-nums}";

export interface VkTrack {
  title: string;
  /** VK's grey part of the name: "Remix", "Cover", "prod. X" */
  version: string;
  artist: string;
  durationMs: number | null;
}
interface VkPage {
  kind: "playlist" | "my" | "list" | "none";
  title: string | null;
  tracks: VkTrack[];
}
interface Probe {
  signedIn: boolean;
  url: string;
  hasList: boolean;
  /** the person's own music page ("/audios123"), from the menu */
  my: string | null;
}

// ---- runs on the VK page (self-contained: these are sent as their source) -------------------------------------------

/** The tracks of the list on the page, after it was scrolled to its end. */
async function vkReader(progress?: (n: number) => void): Promise<VkPage> {
  const q = (s: string, root: ParentNode = document) => root.querySelector<HTMLElement>(s);
  const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const find = (): { box: HTMLElement; kind: VkPage["kind"]; title: string | null } | null => {
    const playlist = q('[data-testid="MusicPlaylistTracks_Items"]');
    if (playlist) return { box: playlist, kind: "playlist", title: clean(q('[data-testid="MusicPlaylistPage_Title"]')?.textContent) || null };
    const mine = q('[data-testid="AudioCatalog_SectionTracks"]');
    if (mine) return { box: mine, kind: "my", title: null };
    const lists = document.querySelectorAll<HTMLElement>('[data-testid="AudioCatalog_BlockMusicAudiosList"]');
    if (lists.length === 1) return { box: lists[0]!, kind: "list", title: clean(q('[data-testid="breadcrumb-current"]')?.textContent) || clean(document.title) || null };
    return null;
  };
  let at = find();
  if (!at) return { kind: "none", title: null, tracks: [] };
  /* a playlist shows its first few tracks until "Show all" */
  const more = q('[data-testid="audiolistitems-expandbutton"]', at.box.parentElement ?? document);
  if (more) more.click();
  const rows = () => (find() ?? at!).box.querySelectorAll('[data-testid="MusicTrackRow"]');
  let last = -1;
  let still = 0;
  /* VK adds the next part as the page nears its end; done when nothing came for a few rounds */
  for (let i = 0; i < 1500 && still < 6; i++) {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 600));
    const n = rows().length;
    if (n === last) still++;
    else {
      still = 0;
      last = n;
    }
    progress?.(n);
    if (n >= 5000) break;
  }
  window.scrollTo(0, 0);
  at = find() ?? at;
  const ms = (s: string) => {
    const p = s.split(":").map(Number);
    return p.length >= 2 && p.every((x) => Number.isFinite(x)) ? p.reduce((a, x) => a * 60 + x, 0) * 1000 : null;
  };
  const tracks: VkTrack[] = [];
  for (const row of at.box.querySelectorAll<HTMLElement>('[data-testid="MusicTrackRow"]')) {
    const link = q('[data-testid="MusicTrackRow_Title"]', row);
    const whole = clean(link?.textContent);
    /* the grey part of the name is a span of its own */
    const version = clean(link?.querySelector("span")?.textContent);
    const title = version && whole.endsWith(version) ? clean(whole.slice(0, whole.length - version.length)) : whole;
    /* the second line: every author, with "feat." between some */
    const info = q('[data-testid="MusicTrackRow_Info"]', row);
    const line = info && info.children.length > 1 ? info.children[1]!.textContent : [...row.querySelectorAll('[data-testid="MusicTrackRow_Authors"]')].map((a) => a.textContent).join(", ");
    const artist = clean(line)
      .replace(/\s+,/g, ",")
      .replace(/\s+(?:feat\.?|ft\.?|&)\s+/gi, ", ");
    /* the track playing shows the time played instead of its length */
    const playing = !!q('[data-testid="MusicTrackCell_FrequencyBars"]', row);
    const durationMs = playing ? null : ms(clean(q('[data-testid="MusicTrackRow_Duration"]', row)?.textContent));
    if (title) tracks.push({ title, version: version === title ? "" : version, artist, durationMs });
  }
  return { kind: at.kind, title: at.title, tracks };
}

/** What the window's page is now. */
function vkProbe(): Probe {
  const q = (s: string) => document.querySelector(s);
  const signedIn = !!q('[data-testid="header-profile-menu-button"], #top_profile_link');
  const hasList = !!(q('[data-testid="MusicPlaylistTracks_Items"]') || q('[data-testid="AudioCatalog_SectionTracks"]') || document.querySelectorAll('[data-testid="AudioCatalog_BlockMusicAudiosList"]').length === 1);
  const my = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") ?? "").find((h) => /^\/audios\d+$/.test(h)) ?? null;
  return { signedIn, url: location.href, hasList, my };
}

/**
 * The bar at the bottom of the page: what to do, and the button. `go` — the button was pressed since last time;
 * `font` — the app's font is on the page already (else main sends it with `vkFonts`).
 */
function vkBar(s: { text: string; button: string | null; css: string; logo: string }): { go: boolean; font: boolean } {
  type Bar = { host: HTMLElement; text: HTMLElement; button: HTMLButtonElement; go: boolean };
  const w = window as unknown as { __scVk?: Bar };
  let bar = w.__scVk;
  if (!bar || !bar.host.isConnected) {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;width:min(760px,calc(100vw - 32px))";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML =
      `<style>${s.css}.bar{display:flex;align-items:center;gap:14px;min-height:54px;padding:8px 8px 8px 14px}.text{flex:1;color:#ececef}</style>` +
      `<div class="bar glass"><span class="brand">${s.logo}sc player</span><span class="sep"></span><span class="text"></span><button type="button"></button></div>`;
    document.documentElement.appendChild(host);
    bar = { host, text: root.querySelector<HTMLElement>(".text")!, button: root.querySelector("button")!, go: false };
    const b = bar;
    b.button.onclick = () => (b.go = true);
    w.__scVk = bar;
  }
  bar.text.textContent = s.text;
  bar.button.textContent = s.button ?? "";
  bar.button.style.display = s.button ? "" : "none";
  const go = bar.go;
  bar.go = false;
  let font = false;
  document.fonts.forEach((f) => {
    if (f.family.replace(/["']/g, "") === "sc-onest") font = true;
  });
  return { go, font };
}

/** The app's font on the page, from its bytes (VK's rules let no font file in, bytes need no file). */
function vkFonts(list: { weight: string; range: string; b64: string }[]) {
  for (const f of list) {
    const bin = atob(f.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    document.fonts.add(new FontFace("sc-onest", bytes, { weight: f.weight, unicodeRange: f.range }));
  }
}

// ---- the window ---------------------------------------------------------------------------------------------------

let current: { win: BrowserWindow; done: Promise<{ title: string | null; items: ImportItem[] }> } | null = null;

const toItems = (tracks: VkTrack[]): ImportItem[] => tracks.map((t) => ({ title: withVersion(t.title, t.version), artist: t.artist, durationMs: t.durationMs }));

/**
 * The VK window: `target` — a pasted playlist link (read as soon as it shows), or null — "My music" to start from,
 * the person choosing what to bring. Resolves with the tracks; fails when the window is closed first.
 */
export function readVk(target: { url: string; key: string } | null, parent: BrowserWindow | null): Promise<{ title: string | null; items: ImportItem[] }> {
  if (current && !current.win.isDestroyed()) {
    current.win.show();
    current.win.focus();
    return current.done;
  }
  const ses = session.fromPartition(PARTITION);
  const win = new BrowserWindow({
    parent: parent ?? undefined,
    width: 1120,
    height: 840,
    minWidth: 760,
    minHeight: 560,
    center: true,
    title: m().vkTitle,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.on("page-title-updated", (e) => e.preventDefault());
  win.webContents.setUserAgent(chromeUserAgent());
  // VK's own windows (a sign-in step) stay in its session; other links open in the browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (HOSTS.test(new URL(url).hostname)) return { action: "allow" };
    } catch {
      return { action: "deny" };
    }
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  const exec = <T>(fn: string, arg?: unknown) => win.webContents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(${fn})(${arg === undefined ? "" : JSON.stringify(arg)})` }]) as Promise<T>;

  const done = new Promise<{ title: string | null; items: ImportItem[] }>((resolve, reject) => {
    let finished = false;
    let busy = false;
    let loads = 0;
    let wentMine = false;
    let autoRead = false;
    let note: string | null = null;

    const read = async () => {
      const t = m();
      const progress = `(n) => { const b = window.__scVk; if (b) { b.text.textContent = ${JSON.stringify(t.vkReading(123456789))}.replace("123456789", n); b.button.style.display = "none"; } }`;
      const page = await win.webContents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(${vkReader.toString()})(${progress})` }]) as VkPage;
      log("main", `import: vk ${page.kind} page read, ${page.tracks.length} tracks`);
      if (!page.tracks.length) {
        note = t.vkNoTracks;
        return;
      }
      finished = true;
      resolve({ title: page.kind === "my" ? t.vkMyMusic : page.title, items: toItems(page.tracks) });
      win.destroy();
    };

    const tick = async () => {
      if (busy || finished || win.isDestroyed()) return;
      busy = true;
      try {
        const p = await exec<Probe>(vkProbe.toString());
        const onTarget = !!target && p.url.includes(target.key);
        if (p.signedIn) {
          // after signing in VK shows the feed: back to the playlist, or to the person's music
          if (target && !onTarget && loads < 2 && !/\/(music|audio)/.test(new URL(p.url).pathname)) {
            loads++;
            void win.loadURL(target.url);
            return;
          }
          if (!target && !wentMine && p.my && !p.hasList) {
            wentMine = true;
            void win.loadURL(`https://vk.com${p.my}?section=all`);
            return;
          }
        }
        const t = m();
        const text = !p.signedIn ? t.vkSignIn : (note ?? (p.hasList ? (target && onTarget ? t.vkWaiting : t.vkReady) : target && !onTarget ? t.vkWaiting : t.vkOpen));
        const { go, font } = await exec<{ go: boolean; font: boolean }>(vkBar.toString(), { text, button: p.signedIn && p.hasList ? t.vkGo : null, css: glassCss(FONT), logo: logo() });
        if (!font) await exec(vkFonts.toString(), onest());
        if (go || (onTarget && p.hasList && !autoRead)) {
          if (onTarget) autoRead = true;
          note = null;
          await read();
        }
      } catch {
        // a page on its way: next time
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void tick(), 1000);

    win.on("closed", () => {
      clearInterval(timer);
      current = null;
      // nothing of the sign-in stays
      void ses.clearStorageData().catch(() => {});
      void ses.clearCache().catch(() => {});
      log("main", "import: vk window closed");
      if (!finished) reject(new ScError("not_found", m().vkClosed));
    });
  });
  current = { win, done };
  log("main", `import: vk window opened (${target ? "a link" : "my music"})`);
  void win.loadURL(target?.url ?? "https://vk.com/audio");
  return done;
}

// ---- the bookmark -------------------------------------------------------------------------------------------------

/** Runs on vk.com when the bookmark is clicked: the tracks as lines to copy. */
function bookmarklet(): string {
  const ru = lang() === "ru";
  const s = {
    notVk: ru ? "Откройте VK — «Мою музыку» или плейлист — и нажмите закладку там." : "Open VK — “My music” or a playlist — and click the bookmark there.",
    none: ru ? "На этой странице нет треков. Откройте «Мою музыку» или плейлист." : "No tracks on this page. Open “My music” or a playlist.",
    reading: ru ? "Читаю треки… " : "Reading the tracks… ",
    done: ru ? "Скопируйте и вставьте в sc player → Импорт" : "Copy them and paste into sc player → Import",
    copy: ru ? "Скопировать" : "Copy",
    copied: ru ? "Скопировано" : "Copied",
    close: ru ? "Закрыть" : "Close",
  };
  const code = `(async () => {
    const s = ${JSON.stringify(s)};
    if (!/(^|\\.)vk\\.(com|ru)$/.test(location.hostname)) { alert(s.notVk); return; }
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:auto 0 18px 0;margin:auto;z-index:2147483647;width:min(640px,calc(100vw - 32px))";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = "<style>" + ${JSON.stringify(glassCss(FONT))} + ".box{padding:12px 14px 14px}.head{display:flex;align-items:center;gap:12px;min-height:30px}.t{flex:1;font-weight:400}textarea{display:block;width:100%;height:220px;margin:12px 0;box-sizing:border-box;resize:vertical;background:rgba(255,255,255,.04);color:#ececef;border:1px solid rgba(255,255,255,.1);border-radius:7px;padding:10px 12px;font:400 12.5px/1.5 ui-monospace,Consolas,monospace;outline:none}textarea:focus{border-color:rgba(178,160,230,.6)}.row{display:flex;gap:8px}</style><div class='box glass'><div class=head><span class=brand>" + ${JSON.stringify(logo())} + "sc player</span><span class=sep></span><span class=t></span></div></div>";
    document.documentElement.appendChild(host);
    const box = root.querySelector(".box"), t = root.querySelector(".t");
    const page = await (${vkReader.toString()})((n) => (t.textContent = s.reading + n));
    if (!page.tracks.length) { host.remove(); alert(s.none); return; }
    const same = new RegExp(${JSON.stringify(SAME_SONG.source)}, "i"), other = new RegExp(${JSON.stringify(OTHER_VERSION.source)}, "i");
    const len = (ms) => Math.floor(ms / 60000) + ":" + String(Math.round(ms / 1000) % 60).padStart(2, "0");
    const text = page.tracks.map((x) => (x.artist ? x.artist + " — " : "") + (x.version && !same.test(x.version) && other.test(x.version) ? x.title + " (" + x.version + ")" : x.title) + (x.durationMs ? " " + len(x.durationMs) : "")).join("\\n");
    t.textContent = page.tracks.length + " — " + s.done;
    const area = document.createElement("textarea"); area.readOnly = true; area.value = text;
    const copy = document.createElement("button"); copy.textContent = s.copy;
    copy.onclick = async () => { try { await navigator.clipboard.writeText(text); } catch { area.select(); document.execCommand("copy"); } copy.textContent = s.copied; };
    const close = document.createElement("button"); close.className = "q"; close.textContent = s.close; close.onclick = () => host.remove();
    const row = document.createElement("div"); row.className = "row"; row.append(copy, close);
    box.append(area, row);
  })()`;
  return `javascript:${encodeURIComponent(code.replace(/\n\s*/g, " "))}`;
}

/** A page in the browser with the bookmark to drag to the bookmarks bar, and how to use it. */
export function openVkBookmark() {
  const ru = lang() === "ru";
  const page = join(app.getPath("temp"), "sc-player-vk.html");
  const steps = ru
    ? [
        "<b>Перетащите эту кнопку на панель закладок</b> (не нажимайте её здесь):",
        "<b>Откройте VK</b> в этом браузере — <a href=\"https://vk.com/audio\">«Мою музыку»</a> или нужный плейлист.",
        "<b>Нажмите закладку.</b> Она прокрутит список до конца и покажет треки строками — скопируйте их и вставьте в sc player → Импорт.",
      ]
    : [
        "<b>Drag this button to your bookmarks bar</b> (don't click it here):",
        "<b>Open VK</b> in this browser — <a href=\"https://vk.com/audio\">“My music”</a> or the playlist you want.",
        "<b>Click the bookmark.</b> It scrolls the list to its end and shows the tracks as lines — copy them and paste into sc player → Import.",
      ];
  const html = `<!doctype html>
<html lang="${ru ? "ru" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>sc player — VK</title>
<style>
${onest()
  .map((f) => `  @font-face { font-family: "sc-onest"; font-weight: ${f.weight}; unicode-range: ${f.range}; src: url(data:font/woff2;base64,${f.b64}) format("woff2"); }`)
  .join("\n")}
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 40px 16px;
    color: #ececef; font: 500 15px/1.55 ${FONT}; letter-spacing: -0.003em;
    background:
      radial-gradient(900px 600px at 18% 0%, rgba(178, 160, 230, 0.16), transparent 65%),
      radial-gradient(700px 500px at 100% 100%, rgba(110, 90, 190, 0.12), transparent 60%),
      #050506;
  }
  main { width: 100%; max-width: 620px; }
  .brand { display: flex; align-items: center; gap: 9px; margin: 0 0 14px 4px; font-weight: 600; font-size: 13px; }
  .brand svg { width: 22px; height: 22px; border-radius: 5px; }
  .card { padding: 28px 28px 22px; border-radius: 10px; background: rgba(14, 14, 17, 0.72); border: 1px solid rgba(255, 255, 255, 0.075); backdrop-filter: blur(30px); box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45); }
  h1 { font-size: 24px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.2; margin: 0 0 24px; }
  ol { list-style: none; padding: 0; margin: 0; counter-reset: step; }
  li { position: relative; padding: 0 0 22px 44px; counter-increment: step; }
  li::before {
    content: counter(step); position: absolute; left: 0; top: -1px; width: 28px; height: 28px; border-radius: 50%;
    display: grid; place-items: center; font-size: 13px; font-weight: 600; color: rgb(178, 160, 230);
    background: rgba(178, 160, 230, 0.1); box-shadow: inset 0 0 0 1px rgba(178, 160, 230, 0.35);
  }
  li:not(:last-child)::after { content: ""; position: absolute; left: 14px; top: 34px; bottom: 6px; width: 1px; background: rgba(255, 255, 255, 0.08); }
  b { font-weight: 600; }
  .muted { color: #9b9ba4; font-size: 13px; }
  a { color: rgb(178, 160, 230); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .bookmark {
    display: inline-flex; align-items: center; gap: 8px; margin: 12px 0 6px; padding: 9px 16px; border-radius: 7px;
    background: #ececef; color: #0b0b0d; font-weight: 600; font-size: 14px; cursor: grab; transition: background 0.15s;
  }
  .bookmark:hover { background: #fff; text-decoration: none; }
  kbd { display: inline-block; padding: 0 6px; border-radius: 5px; background: rgba(255, 255, 255, 0.06); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12); font: 500 12px/1.6 ${FONT}; color: #ececef; }
  .foot { margin: 6px 0 0; padding-top: 16px; border-top: 1px solid rgba(255, 255, 255, 0.075); }
</style></head>
<body><main>
  <div class="brand">${logo()}sc player</div>
  <div class="card">
  <h1>${ru ? "Перенос из VK через браузер" : "Import from VK through your browser"}</h1>
  <ol>
    <li>${steps[0]}<br>
      <a class="bookmark" href="${bookmarklet()}" onclick="alert('${ru ? "Перетащите её на панель закладок, а не нажимайте." : "Drag it to the bookmarks bar instead of clicking."}');return false">${m().vkBookmarkTitle}</a><br>
      <span class="muted">${ru ? "Нет панели закладок? Нажмите" : "No bookmarks bar? Press"} <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>.</span></li>
    <li>${steps[1]}</li>
    <li>${steps[2]}</li>
  </ol>
  <p class="muted foot">${ru ? "Закладка только читает треки на открытой странице и ничего никуда не отправляет." : "The bookmark only reads the tracks on the page open and sends nothing anywhere."}</p>
  </div>
</main></body></html>`;
  writeFileSync(page, html, "utf8");
  log("main", "import: vk bookmark page opened");
  void shell.openPath(page);
}
