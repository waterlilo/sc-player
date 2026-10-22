/**
 * Words without times (plain lyrics) still follow the song, roughly: each line gets a share of the track by its
 * syllables, a blank line (between verses) a short breath, and a quiet stretch is left for the intro and the outro.
 * The listener corrects it by clicking the line being sung: that line is pinned to that moment and the lines around
 * it are spread again between the pins. Pure: tested on its own.
 */

export interface RoughLine {
  text: string;
  /** a blank line came before this one (a new verse) */
  verse: boolean;
}

/** Plain lyrics into lines; runs of blank lines become one verse break on the next line. */
export function roughLines(plain: string): RoughLine[] {
  const out: RoughLine[] = [];
  let gap = false;
  for (const raw of plain.split(/\r?\n/)) {
    const text = raw.trim();
    if (!text) {
      gap = out.length > 0;
      continue;
    }
    out.push({ text, verse: gap });
    gap = false;
  }
  return out;
}

// Cyrillic vowels are each a syllable ("аю" is two); Latin ones go in groups ("ea", "you")
const VOWELS = /[аеёиоуыэюяіїє]|[aeiouyáéíóúàèìòùäöüœæ]+/giu;

/** About how long a line takes to sing, in syllables (a word with no vowels counts once), plus a breath. */
export function lineWeight(l: RoughLine): number {
  const syllables = l.text.split(/\s+/).reduce((n, w) => n + Math.max(1, w.match(VOWELS)?.length ?? 0), 0);
  return syllables + 2 + (l.verse ? 6 : 0);
}

/** Pins: line index → the time (s) the listener said it is sung at. */
export type Pins = Record<number, number>;

/**
 * The start time of every line. Without pins the words fill the track between a short intro and outro; with pins
 * each stretch between two pins (or a pin and an end) is filled by weight.
 */
export function roughTimes(lines: RoughLine[], duration: number, pins: Pins = {}): number[] {
  if (!lines.length) return [];
  const d = duration > 0 ? duration : 180;
  const weights = lines.map(lineWeight);
  const pos: number[] = [];
  let total = 0;
  for (const w of weights) {
    pos.push(total);
    total += w;
  }
  const start = Math.min(15, Math.max(4, d * 0.06));
  const end = Math.max(start + 1, d - Math.min(12, Math.max(3, d * 0.05)));
  const rate = (end - start) / total;

  // the fixed points along the words: the start, the pins in order, the end
  const points: [number, number][] = [];
  const pinned = Object.entries(pins)
    .map(([i, t]) => [Number(i), t] as const)
    .filter(([i, t]) => i >= 0 && i < lines.length && Number.isFinite(t))
    .sort((a, b) => a[0] - b[0]);
  for (const [i, t] of pinned) points.push([pos[i]!, t]);
  const first = points[0];
  points.unshift([0, first ? Math.min(start, Math.max(0, first[1] - first[0] * rate)) : start]);
  const last = points[points.length - 1]!;
  points.push([total, Math.max(end, last[1] + (total - last[0]) * rate * 0.5)]);

  return pos.map((p) => {
    let k = 0;
    while (k < points.length - 2 && points[k + 1]![0] <= p) k++;
    const [p0, t0] = points[k]!;
    const [p1, t1] = points[k + 1]!;
    return p1 > p0 ? t0 + ((p - p0) / (p1 - p0)) * (t1 - t0) : t0;
  });
}

/** Pin `line` at `time`, dropping the pins it contradicts (an earlier line pinned later, a later line earlier). */
export function pin(pins: Pins, line: number, time: number): Pins {
  const next: Pins = { [line]: time };
  for (const [k, t] of Object.entries(pins)) {
    const i = Number(k);
    if (i === line) continue;
    if ((i < line && t < time) || (i > line && t > time)) next[i] = t;
  }
  return next;
}
