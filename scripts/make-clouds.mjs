// Draws extra cloud masks in the style of the site's (white with a spray-can stippled edge, transparent around):
// assets/textures/cloud-c … cloud-h.webp, 900×560. Each shape is a sum of soft blobs, cut with a noisy threshold so
// the edge breaks up into dots. Seeded: the same files every run. Run: node scripts/make-clouds.mjs
import sharp from "sharp";

const W = 900;
const H = 560;

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** blobs: [cx, cy, rx, ry, weight] in 0..1 of the canvas; holes subtract; flat: the y below which it fades out */
const SHAPES = {
  // long cumulus with a flat base
  c: { seed: 3, flat: 0.66, blobs: [[0.24, 0.55, 0.12, 0.1, 1], [0.38, 0.45, 0.13, 0.15, 1.1], [0.53, 0.4, 0.12, 0.17, 1.1], [0.67, 0.48, 0.12, 0.12, 1], [0.8, 0.56, 0.09, 0.08, 0.9], [0.45, 0.58, 0.3, 0.08, 0.9]] },
  // tall towering one
  d: { seed: 5, flat: 0.78, blobs: [[0.5, 0.7, 0.2, 0.09, 1], [0.48, 0.52, 0.13, 0.13, 1.1], [0.53, 0.34, 0.1, 0.12, 1.1], [0.47, 0.2, 0.07, 0.08, 1], [0.38, 0.62, 0.09, 0.08, 0.9], [0.63, 0.6, 0.09, 0.09, 0.9]] },
  // torn wispy band
  e: { seed: 7, flat: 1, wisp: true, blobs: [[0.15, 0.5, 0.1, 0.05, 0.9], [0.3, 0.46, 0.12, 0.06, 1], [0.47, 0.52, 0.13, 0.05, 1], [0.63, 0.47, 0.12, 0.06, 0.9], [0.8, 0.53, 0.1, 0.045, 0.8], [0.9, 0.49, 0.05, 0.03, 0.7]] },
  // a cluster of small puffs
  f: { seed: 11, flat: 0.7, blobs: [[0.3, 0.52, 0.08, 0.08, 1], [0.42, 0.44, 0.07, 0.09, 1], [0.55, 0.55, 0.06, 0.06, 1], [0.68, 0.46, 0.08, 0.08, 1], [0.78, 0.6, 0.05, 0.05, 0.9], [0.2, 0.62, 0.05, 0.04, 0.9], [0.5, 0.64, 0.18, 0.05, 0.8]] },
  // two humps with a saddle
  g: { seed: 13, flat: 0.68, blobs: [[0.32, 0.45, 0.14, 0.16, 1.1], [0.66, 0.42, 0.15, 0.18, 1.1], [0.5, 0.58, 0.28, 0.08, 1], [0.2, 0.58, 0.08, 0.07, 0.9], [0.82, 0.58, 0.08, 0.07, 0.9]], holes: [[0.36, 0.5, 0.05, 0.04, 0.5], [0.62, 0.48, 0.05, 0.04, 0.5]] },
  // flat layered stratus
  h: { seed: 17, flat: 0.62, blobs: [[0.5, 0.52, 0.38, 0.07, 1.1], [0.3, 0.47, 0.14, 0.06, 0.9], [0.62, 0.45, 0.16, 0.07, 0.9], [0.8, 0.5, 0.1, 0.05, 0.8], [0.16, 0.54, 0.08, 0.04, 0.8]] },
};

for (const [name, s] of Object.entries(SHAPES)) {
  const r = rng(s.seed);
  // a little wobble so the blobs aren't perfect ellipses
  const base = s.blobs.map(([cx, cy, rx, ry, w]) => [cx * W, cy * H, rx * W * (0.9 + r() * 0.2), ry * H * (0.9 + r() * 0.2), w, r() * Math.PI * 2]);
  // cumulus 'cauliflower': small puffs around the upper rim of every blob (wisps stay smooth)
  const puffs = s.wisp
    ? []
    : base.flatMap(([cx, cy, rx, ry, w]) =>
        Array.from({ length: 4 }, () => {
          const a = Math.PI * (1.05 + r() * 0.9);
          const size = 0.32 + r() * 0.18;
          return [cx + Math.cos(a) * rx * 0.85, cy + Math.sin(a) * ry * 0.85, rx * size, ry * size * 1.15, w * 0.55, r() * Math.PI * 2];
        }),
      );
  const blobs = [...base, ...puffs];
  const holes = (s.holes ?? []).map(([cx, cy, rx, ry, w]) => [cx * W, cy * H, rx * W, ry * H, w]);
  const alpha = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let f = 0;
      for (const [cx, cy, rx, ry, w, ph] of blobs) {
        // lumpy edge: the radius breathes with the angle around the blob centre
        const a = Math.atan2(y - cy, x - cx);
        const k = 1 + 0.05 * Math.sin(a * 3 + ph) + 0.03 * Math.sin(a * 7 + ph * 2);
        const dx = (x - cx) / (rx * k);
        const dy = (y - cy) / (ry * k);
        f += w * Math.exp(-(dx * dx + dy * dy) * 1.4);
      }
      for (const [cx, cy, rx, ry, w] of holes) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        f -= w * Math.exp(-(dx * dx + dy * dy) * 1.4);
      }
      // a flat base: fade out quickly below the line
      if (y > s.flat * H) f *= Math.max(0, 1 - (y - s.flat * H) / (H * 0.05));
      // wisps: thinner and streaky along x
      if (s.wisp) f *= 0.75 + 0.35 * Math.sin(y * 0.09 + Math.sin(x * 0.013) * 2);
      // stippled edge: the threshold is noisy, so the border dissolves into spray dots; the inside stays solid
      const t = (f - 0.32) / 0.4;
      const p = Math.max(0, Math.min(1, t));
      const lit = p >= 1 ? 1 : r() < p * p * (3 - 2 * p) ? 0.55 + p * 0.45 : 0;
      alpha[y * W + x] = Math.round(lit * 255);
    }
  }
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = alpha[i];
  }
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .blur(0.6)
    .webp({ quality: 80, alphaQuality: 70 })
    .toFile(`assets/textures/cloud-${name}.webp`);
  console.log(`assets/textures/cloud-${name}.webp`);
}
