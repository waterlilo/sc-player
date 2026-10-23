/**
 * Synced words from a source (LRCLIB, Better Lyrics) made for another upload of the song: a longer intro moves every
 * line by the same amount, a slowed or sped-up upload stretches them (a slower one by more towards the end). Lines of
 * the source checked against this upload's sound (lyrics-sync) show which: the line `heard = scale × source + shift`
 * that most of them agree with (within a second). Nothing when fewer than half the lines agree on one (another
 * arrangement): the source then stays as it is. Pure: tested on its own.
 */
export interface Timing {
  scale: number;
  shift: number;
}

const NEAR = 1;

export function fitTiming(source: number[], heard: number[]): Timing | null {
  const n = source.length;
  if (n < 3 || n !== heard.length) return null;
  const inliers = (t: Timing) => source.flatMap((s, i) => (Math.abs(t.scale * s + t.shift - heard[i]!) <= NEAR ? [i] : []));
  // candidates: the same shift for all (the median one), and the line through every two points far enough apart
  const diffs = source.map((s, i) => heard[i]! - s).sort((a, b) => a - b);
  const candidates: Timing[] = [{ scale: 1, shift: diffs[n >> 1]! }];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const span = source[j]! - source[i]!;
      if (Math.abs(span) < 15) continue;
      const scale = (heard[j]! - heard[i]!) / span;
      // slowed to 0.75 … sped up to 1.35, the usual range of such uploads
      if (scale < 0.75 || scale > 1.35) continue;
      candidates.push({ scale, shift: heard[i]! - scale * source[i]! });
    }
  let best: { t: Timing; idx: number[] } | null = null;
  for (const t of candidates) {
    const idx = inliers(t);
    // more lines agreeing wins; on a tie the plain shift (the first candidate) stays
    if (!best || idx.length > best.idx.length) best = { t, idx };
  }
  if (!best || best.idx.length < n / 2) return null;
  // refined on the lines that agree: least squares, or their mean shift for the plain-shift case
  const xs = best.idx.map((i) => source[i]!);
  const ys = best.idx.map((i) => heard[i]!);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  if (best.t.scale === 1) return { scale: 1, shift: my - mx };
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const scale = sxx > 0 ? xs.reduce((a, x, k) => a + (x - mx) * (ys[k]! - my), 0) / sxx : best.t.scale;
  return { scale, shift: my - scale * mx };
}

/** How far the fitted times move a line at most over the song (what decides whether to move anything). */
export const largestMove = (t: Timing, duration: number) => Math.max(Math.abs(t.shift), Math.abs((t.scale - 1) * duration + t.shift));
