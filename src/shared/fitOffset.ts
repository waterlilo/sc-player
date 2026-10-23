/**
 * Synced words from a source (LRCLIB, Better Lyrics) made for another upload of the song — a longer intro, a cut —
 * run early or late by the same amount everywhere. Matched to this upload's sound (lyrics-sync), most lines show that
 * one shift: then the source's own timing is kept, moved by it. When the lines don't agree on one shift (another
 * arrangement), there is nothing to move. Pure: tested on its own.
 */
export function fitOffset(source: number[], heard: number[]): number | null {
  if (!source.length || source.length !== heard.length) return null;
  const diffs = source.map((t, i) => heard[i]! - t);
  const sorted = [...diffs].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1]!;
  const agree = diffs.filter((d) => Math.abs(d - median) <= 1);
  // at least half the lines move together
  if (agree.length < source.length / 2) return null;
  return agree.reduce((n, d) => n + d, 0) / agree.length;
}
