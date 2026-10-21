import { BrowserWindow, screen } from "electron";
import type { Design, PlayerInfo, PopupCorner } from "@shared/ipc";

/**
 * A small card in a corner of the screen when the track changes while sc player isn't in front (Settings → Track
 * popup, off by default): cover, title, artist, for about four seconds. It never takes focus and lets clicks through,
 * so it doesn't get in the way of whatever is being worked on. It follows the chosen design: studio — dark glass over
 * the cover itself, blurred, like the window's background; og — the night card with the yellow edge.
 */
const WIDTH = 360;
const HEIGHT = 92;
const MARGIN = 16;
const SHOW_MS = 4200;

let popup: BrowserWindow | null = null;
let hideTimer: NodeJS.Timeout | null = null;
let lastId: number | null = null;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(title: string, artist: string, cover: string | null, design: Design) {
  const art = cover ? `<img src="${esc(cover)}" alt="">` : `<div class="blank"></div>`;
  return design === "studio" ? studioPage(title, artist, cover, art) : `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https://*.sndcdn.com; style-src 'unsafe-inline'">
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; font-family: "Segoe UI", system-ui, sans-serif; user-select: none; }
  .card { box-sizing: border-box; height: 100%; display: flex; gap: 12px; align-items: center; padding: 10px 14px 10px 10px;
    background: #0f0b1a; border: 1px solid #3a2f63; border-left: 4px solid #f2dc1a; border-radius: 10px; color: #ece7ff;
    animation: life ${SHOW_MS}ms ease both; }
  img, .blank { width: 70px; height: 70px; border-radius: 6px; object-fit: cover; flex: none; background: #241b3d; }
  .text { min-width: 0; }
  .title { font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .artist { margin-top: 3px; font-size: 13px; color: #a79ed0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @keyframes life { 0% { opacity: 0; transform: translateY(8px); } 7% { opacity: 1; transform: none; } 88% { opacity: 1; } 100% { opacity: 0; } }
</style></head>
<body><div class="card">${art}<div class="text"><div class="title">${esc(title)}</div><div class="artist">${esc(artist)}</div></div></div></body></html>`;
}

function studioPage(title: string, artist: string, cover: string | null, art: string) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https://*.sndcdn.com; style-src 'unsafe-inline'">
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; user-select: none;
    font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  .card { position: relative; box-sizing: border-box; height: 100%; display: flex; gap: 12px; align-items: center; padding: 10px 16px 10px 10px;
    border-radius: 12px; overflow: hidden; color: #ececef; background: #0e0e11; border: 1px solid rgba(255,255,255,0.1);
    animation: life ${SHOW_MS}ms ease both; }
  .bg { position: absolute; inset: -30px; background: ${cover ? `url("${esc(cover)}") center / cover` : "#16161a"}; filter: blur(18px) saturate(1.2) brightness(0.5); }
  .veil { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(14,14,17,0.55), rgba(14,14,17,0.78)); }
  img, .blank { position: relative; width: 70px; height: 70px; border-radius: 7px; object-fit: cover; flex: none; background: #1c1c22; box-shadow: 0 6px 18px rgba(0,0,0,0.4); }
  .text { position: relative; min-width: 0; }
  .label { font-size: 10.5px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(236,236,239,0.5); }
  .title { margin-top: 3px; font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .artist { margin-top: 2px; font-size: 13px; color: #9b9ba4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @keyframes life { 0% { opacity: 0; transform: translateY(8px); } 7% { opacity: 1; transform: none; } 88% { opacity: 1; } 100% { opacity: 0; } }
</style></head>
<body><div class="card"><div class="bg"></div><div class="veil"></div>${art}<div class="text"><div class="label">Now playing</div><div class="title">${esc(title)}</div><div class="artist">${esc(artist)}</div></div></div></body></html>`;
}

function place(win: BrowserWindow, corner: PopupCorner) {
  const area = screen.getPrimaryDisplay().workArea;
  const x = corner.endsWith("left") ? area.x + MARGIN : area.x + area.width - WIDTH - MARGIN;
  const y = corner.startsWith("top") ? area.y + MARGIN : area.y + area.height - HEIGHT - MARGIN;
  win.setBounds({ x, y, width: WIDTH, height: HEIGHT });
}

function create() {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setIgnoreMouseEvents(true);
  win.on("closed", () => (popup = null));
  return win;
}

export function trackPopup(info: PlayerInfo, opts: { enabled: boolean; corner: PopupCorner; windowInFront: boolean; design: Design }) {
  const t = info.track;
  if (!t || t.id === lastId) return;
  lastId = t.id;
  if (!opts.enabled || opts.windowInFront || !info.playing) return;
  const cover = t.artworkUrl && /^https:\/\/[a-z0-9.-]+\.sndcdn\.com\//.test(t.artworkUrl) ? t.artworkUrl.replace(/-(large|t\d+x\d+)\./, "-t200x200.") : null;
  popup ??= create();
  const win = popup;
  place(win, opts.corner);
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page(t.title, t.artist, cover, opts.design))}`).then(() => {
    if (win.isDestroyed()) return;
    win.showInactive();
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!win.isDestroyed()) win.hide();
    }, SHOW_MS + 100);
  });
}

/** For Settings: show it now with the given track, whatever the focus. */
export function previewTrackPopup(info: PlayerInfo, corner: PopupCorner, design: Design) {
  lastId = null;
  trackPopup({ ...info, playing: true }, { enabled: true, corner, windowInFront: false, design });
}
