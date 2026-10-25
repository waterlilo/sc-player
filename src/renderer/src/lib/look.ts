import { artwork, type Track } from "@shared/types";
import type { Look } from "@shared/ipc";
import { usePlayer } from "@/state/player";
import { useSettings } from "@/state/settings";

/**
 * The studio design's look: <html data-design> picks the stylesheet (styles/studio.css), the knobs go to CSS
 * variables on the root (only when they change — never per frame), and the palette is read from the playing cover —
 * or from your own background when one is chosen. The palette is five colours for the living background and one
 * accent for the interface: the most vivid colour of the picture, kept quiet (never neon) and bright enough to read
 * on dark glass.
 */
export type RGB = [number, number, number];
export interface Palette {
  accent: RGB;
  /** 0..1 floats, for the shader */
  field: RGB[];
}

const DEFAULT: Palette = { accent: [178, 160, 230], field: [[0.16, 0.12, 0.26], [0.3, 0.22, 0.5], [0.12, 0.1, 0.2], [0.24, 0.18, 0.36], [0.08, 0.07, 0.12]] };
let current: Palette = DEFAULT;
const listeners = new Set<(p: Palette) => void>();

export const palette = () => current;
export function onPalette(fn: (p: Palette) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const bgUrl = (file: string) => `scbg://file/${encodeURIComponent(file)}`;

function hsl([r, g, b]: RGB): RGB {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function rgb([h, s, l]: RGB): RGB {
  if (!s) return [l * 255, l * 255, l * 255];
  const f = (p: number, q: number, t: number) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
}

/** k-means on a 40×40 copy (farthest-point seeds, 8 rounds): the biggest groups fill the field, the most vivid one leads */
export function paletteOf(source: CanvasImageSource): Palette {
  const S = 40;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(source, 0, 0, S, S);
  const d = g.getImageData(0, 0, S, S).data;
  const px: RGB[] = [];
  for (let i = 0; i < d.length; i += 4) px.push([d[i]!, d[i + 1]!, d[i + 2]!]);
  const dist = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const centres: RGB[] = [px[0]!];
  while (centres.length < 6) {
    let best = px[0]!;
    let far = -1;
    for (const p of px) {
      const m = Math.min(...centres.map((c) => dist(p, c)));
      if (m > far) {
        far = m;
        best = p;
      }
    }
    centres.push(best);
  }
  let counts: number[] = [];
  for (let round = 0; round < 8; round++) {
    const sums = centres.map(() => [0, 0, 0]);
    counts = centres.map(() => 0);
    for (const p of px) {
      let k = 0;
      let near = Infinity;
      centres.forEach((c, j) => {
        const v = dist(p, c);
        if (v < near) {
          near = v;
          k = j;
        }
      });
      sums[k]![0]! += p[0];
      sums[k]![1]! += p[1];
      sums[k]![2]! += p[2];
      counts[k]!++;
    }
    centres.forEach((_, j) => {
      if (counts[j]) centres[j] = sums[j]!.map((v) => v / counts[j]!) as RGB;
    });
  }
  const groups = centres.map((c, j) => ({ c, n: counts[j]!, h: hsl(c) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const score = (x: (typeof groups)[number]) => x.h[1] * Math.sqrt(x.n) * (1 - Math.abs(x.h[2] - 0.5));
  const vivid = [...groups].sort((a, b) => score(b) - score(a))[0]!;
  const [hue, sat] = vivid.h;
  // grey or nearly black pictures keep the default violet accent
  const accent = sat < 0.12 ? DEFAULT.accent : rgb([hue, Math.min(0.62, Math.max(0.42, sat)), 0.66]);
  const field = groups.map(({ h: [hh, ss, ll] }) => rgb([hh, Math.min(0.8, ss), Math.min(0.5, Math.max(0.14, ll))]));
  while (field.length < 5) field.push(rgb([(hue + field.length * 0.06) % 1, sat * 0.7, 0.25]));
  return { accent, field: field.slice(0, 5).map((c) => c.map((v) => v / 255) as RGB) };
}

function apply(p: Palette) {
  current = p;
  const root = document.documentElement.style;
  const [r, g, b] = p.accent.map(Math.round) as RGB;
  root.setProperty("--accent", `rgb(${r} ${g} ${b})`);
  root.setProperty("--accent-rgb", `${r}, ${g}, ${b}`);
  const dark = rgb([hsl(p.accent)[0], 0.5, 0.08]).map(Math.round);
  root.setProperty("--on-accent", `rgb(${dark.join(" ")})`);
  listeners.forEach((fn) => fn(p));
}

async function fromImage(url: string): Promise<Palette> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.src = url;
  await img.decode();
  return paletteOf(img);
}

async function fromVideo(url: string): Promise<Palette> {
  const v = document.createElement("video");
  v.crossOrigin = "anonymous";
  v.muted = true;
  v.preload = "auto";
  v.src = url;
  await new Promise<void>((ok, fail) => {
    v.onloadeddata = () => ok();
    v.onerror = () => fail(new Error("video"));
  });
  return paletteOf(v);
}

/** "#rrggbb" → RGB; null for "" (the accent then comes from the picture) */
function hexRgb(hex: string): RGB | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : null;
}

let source = "";
let job = 0;
async function update() {
  const look = useSettings.getState().prefs.look;
  if (look.design !== "studio") return;
  const t: Track | undefined = usePlayer.getState().queue[usePlayer.getState().index];
  const picture =
    look.bg === "file" && look.bgFile ? `${look.bgFileType}:${bgUrl(look.bgFile)}` : t?.artworkUrl ? `image:${artwork(t.artworkUrl, "t300x300")}` : "";
  const next = `${look.accent}|${picture}`;
  if (next === source) return;
  source = next;
  const mine = ++job;
  // a fixed accent (a workshop theme can set one) wins over the picture's; the background still takes its colours
  const fixed = hexRgb(look.accent);
  const done = (p: Palette) => mine === job && apply(fixed ? { ...p, accent: fixed } : p);
  if (!picture) return done(DEFAULT);
  const [kind, ...rest] = picture.split(":");
  const url = rest.join(":");
  try {
    done(kind === "video" ? await fromVideo(url) : await fromImage(url));
  } catch {
    done(DEFAULT);
  }
}

function applyKnobs(look: Look) {
  const html = document.documentElement;
  html.dataset.design = look.design;
  html.classList.toggle("lite", look.lite);
  html.classList.toggle("thin-glass", look.panelOpacity < 40);
  const root = html.style;
  root.setProperty("--bg-blur", `${look.bgBlur}px`);
  root.setProperty("--veil", String(look.bgDim / 100));
  root.setProperty("--glass-a", String(look.panelOpacity / 100));
  root.setProperty("--pblur", `${look.panelBlur}px`);
  applySurface(look.surface);
}

/**
 * The interface colour: its hue and saturation, kept dark (white text must stay readable on it) — the panels at the
 * picked shade, the window behind them darker still. "" = the graphite of the stylesheet.
 */
function applySurface(hex: string) {
  const root = document.documentElement.style;
  const c = hexRgb(hex);
  if (!c) {
    root.removeProperty("--glass-rgb");
    root.removeProperty("--bg");
    return;
  }
  const [h, s, l] = hsl(c);
  const panel = rgb([h, Math.min(s, 0.6), Math.min(Math.max(l, 0.05), 0.2)]).map(Math.round);
  const base = rgb([h, Math.min(s, 0.6), Math.min(Math.max(l, 0.05), 0.2) * 0.35]).map(Math.round);
  root.setProperty("--glass-rgb", panel.join(", "));
  root.setProperty("--bg", `rgb(${base.join(" ")})`);
}

export function initLook() {
  applyKnobs(useSettings.getState().prefs.look);
  useSettings.subscribe((s, prev) => {
    if (s.prefs.look === prev.prefs.look) return;
    applyKnobs(s.prefs.look);
    void update();
  });
  usePlayer.subscribe((s, prev) => s.queue[s.index] !== prev.queue[prev.index] && void update());
  void update();
}
