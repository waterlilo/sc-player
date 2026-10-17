import { artwork } from "@shared/types";
import { usePlayer } from "@/state/player";
import { useSettings } from "@/state/settings";

/**
 * The sky takes its colour from the cover of what's playing: the most colourful tone of a small copy of the cover,
 * brought to a fixed lightness so clouds stay soft (never neon, never lost in the dark). It goes to --cloud (the
 * clouds) and --tint (the edge glow) on the root, once per track; grey covers and "off" fall back to the theme's own
 * colours. The far stippled haze only leans a little toward that colour (--haze-shift). The covers come from
 * SoundCloud's CDN, which main serves with CORS, so the pixels can be read.
 */
const SIZE = 24;
/** the hue of the stippled haze in the backdrop (assets/textures/stipple-night.webp) */
const HAZE_HUE = 250;
let lastUrl: string | null = null;
let job = 0;

function hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return [h, s, l];
}

/** The cover's leading colour as [hue, saturation], or null for a grey / dark cover. */
async function coverHue(url: string): Promise<[number, number] | null> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.src = url;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, SIZE, SIZE);
  const px = g.getImageData(0, 0, SIZE, SIZE).data;
  // hues weighted by how colourful and how visible each pixel is (a circular mean, so red at 350° and 10° agree)
  let x = 0;
  let y = 0;
  let weight = 0;
  let sat = 0;
  for (let i = 0; i < px.length; i += 4) {
    const [h, s, l] = hsl(px[i]!, px[i + 1]!, px[i + 2]!);
    const w = s * s * (1 - Math.abs(l - 0.5) * 2);
    x += Math.cos((h * Math.PI) / 180) * w;
    y += Math.sin((h * Math.PI) / 180) * w;
    sat += s * w;
    weight += w;
  }
  if (weight < 8) return null;
  const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return [hue, sat / weight];
}

function apply(tone: [number, number] | null) {
  const root = document.documentElement.style;
  if (!tone) {
    root.removeProperty("--cloud");
    root.removeProperty("--tint");
    root.removeProperty("--haze-shift");
    return;
  }
  const [h, s] = tone;
  const sat = Math.round(Math.min(75, Math.max(35, s * 100)));
  root.setProperty("--cloud", `hsl(${Math.round(h)} ${sat}% 64%)`);
  root.setProperty("--tint", `hsl(${Math.round(h)} ${Math.min(90, sat + 15)}% 62%)`);
  // the stippled far haze only leans toward the cover: a third of the way from its own violet, at most 45°
  const toward = ((h - HAZE_HUE + 540) % 360) - 180;
  root.setProperty("--haze-shift", `${Math.round(Math.max(-45, Math.min(45, toward / 3)))}deg`);
}

async function update() {
  const on = useSettings.getState().prefs.coverTint;
  const { queue, index } = usePlayer.getState();
  const t = queue[index];
  const url = on && t?.artworkUrl ? artwork(t.artworkUrl, "t67x67") : null;
  if (url === lastUrl) return;
  lastUrl = url;
  const mine = ++job;
  if (!url) return apply(null);
  try {
    const tone = await coverHue(url);
    if (mine === job) apply(tone);
  } catch {
    if (mine === job) apply(null);
  }
}

export function initCoverTint() {
  usePlayer.subscribe((s, prev) => s.queue[s.index] !== prev.queue[prev.index] && void update());
  useSettings.subscribe((s, prev) => s.prefs.coverTint !== prev.prefs.coverTint && void update());
  void update();
}
