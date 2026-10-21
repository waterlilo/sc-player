// Turns a piece of music into what the prototype reacts to, one entry per video frame:
//   node design/redesign/analyze.mjs <audio file> [seconds=14] [fps=30]
// → design/redesign/audio-data.js (window.__AUDIO = { fps, frames: [{ b: [sub, bass, low-mid, vocal, high], s: [48 bands] }] })
// The bands are smoothed the way a meter is: quick to rise, slow to fall, and each one is scaled by its own loudest
// moment, so a quiet band still moves.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const [, , file, secArg = "14", fpsArg = "30"] = process.argv;
if (!file) throw new Error("usage: node analyze.mjs <audio file> [seconds] [fps]");
const SECONDS = Number(secArg);
const FPS = Number(fpsArg);
const RATE = 44100;
const N = 2048;

const raw = execFileSync("ffmpeg", ["-v", "error", "-t", String(SECONDS + 1), "-i", file, "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
const pcm = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));

/** in-place radix-2 FFT */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      }
    }
  }
}

const hann = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
const hz = (bin) => (bin * RATE) / N;
const BANDS = [[20, 60], [60, 250], [250, 500], [500, 4000], [4000, 12000]];
const SPEC = 48;
// log-spaced edges for the halo, 40 Hz – 14 kHz
const edges = Array.from({ length: SPEC + 1 }, (_, i) => 40 * Math.pow(14000 / 40, i / SPEC));

const total = Math.floor(SECONDS * FPS);
const rawFrames = [];
for (let f = 0; f < total; f++) {
  const at = Math.floor((f / FPS) * RATE);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (pcm[at + i] ?? 0) * hann[i];
  fft(re, im);
  const mag = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  const energy = (lo, hi) => {
    let e = 0, c = 0;
    for (let i = 1; i < N / 2; i++) if (hz(i) >= lo && hz(i) < hi) { e += mag[i] * mag[i]; c++; }
    return Math.sqrt(e / Math.max(1, c));
  };
  rawFrames.push({ b: BANDS.map(([lo, hi]) => energy(lo, hi)), s: edges.slice(0, -1).map((lo, i) => energy(lo, Math.max(edges[i + 1], lo + hz(1.01)))) });
}

// each band against its own loud moments (95th percentile), then attack / release smoothing
function normalise(series) {
  const sorted = [...series].sort((a, b) => a - b);
  const top = sorted[Math.floor(sorted.length * 0.95)] || 1;
  let v = 0;
  return series.map((x) => {
    const t = Math.min(1.2, x / top);
    v += (t - v) * (t > v ? 0.55 : 0.12);
    return +v.toFixed(3);
  });
}
const bandSeries = BANDS.map((_, k) => normalise(rawFrames.map((fr) => fr.b[k])));
const specSeries = edges.slice(0, -1).map((_, k) => normalise(rawFrames.map((fr) => fr.s[k])));
const frames = rawFrames.map((_, f) => ({ b: bandSeries.map((s) => s[f]), s: specSeries.map((s) => s[f]) }));

writeFileSync(join(import.meta.dirname, "audio-data.js"), `window.__AUDIO = ${JSON.stringify({ fps: FPS, seconds: SECONDS, frames })};\n`);
console.log(`${frames.length} frames, ${SECONDS} s at ${FPS} fps → audio-data.js`);
