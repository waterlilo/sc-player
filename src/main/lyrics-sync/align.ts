import type { LyricWord } from "@shared/types";

/**
 * Plain words matched to the song (forced alignment): the words are known, so the model doesn't write them — it only
 * says where in the sound each one is. The song goes in 30 s windows; each window gets the next words that could fit,
 * the model places them (cross-attention + DTW, see worker.ts) and rates how sure it is of each, the words placed well
 * inside the window are kept and the next window starts where the last of them ended. Lines the model doesn't hear
 * while it clearly hears the lines after them (a remix that drops a verse, or words it finds unlikely) are set aside so
 * they don't pull the others out of place, and come back between them at the end. Pure: the model comes in as
 * `forward`, so this is tested on its own.
 */

export const SAMPLE_RATE = 16000;
const WINDOW_S = 30;
/** the words given to one window, in tokens (Whisper's decoder takes 448 with the prefix) */
const MAX_TOKENS = 220;

export interface WindowResult {
  /** per text token: its start in seconds from the window's start */
  starts: number[];
  /** where the last token ends */
  end: number;
  /** per text token: how likely the model finds it there (0..1) */
  p: number[];
}

export interface Model {
  encode(word: string): number[];
  /** places these tokens in this stretch of sound */
  forward(window: Float32Array, ids: number[]): Promise<WindowResult>;
}

export interface AlignedLine {
  t: number;
  end: number;
  text: string;
  words: LyricWord[];
}

export interface Alignment {
  lines: AlignedLine[];
  /** the mean certainty of the placed words (0..1) */
  confidence: number;
  /** the share of the lyric lines that were placed */
  coverage: number;
}

interface Word {
  text: string;
  line: number;
  ids: number[];
  t?: number;
  end?: number;
  p?: number;
}

/**
 * Lines that are not sung here: barely heard (< 0.08) while a later line in the same window is clearly heard — one
 * that occurs once in the words: a repeated line (a chorus) is heard wherever any of its repeats is sung.
 */
export function unsungLines(lineP: { line: number; p: number; start: number; unique: boolean }[], windowLength: number, last: boolean): number[] {
  return lineP.filter((l, i) => l.p < 0.08 && lineP.slice(i + 1).some((after) => after.unique && after.p >= 0.35 && (last || after.start < windowLength - 4))).map((l) => l.line);
}

/** How far ahead to look for a line that isn't heard where it was expected (a chorus or a break before it), seconds. */
const LOOK_AHEAD = [4, 8, 12, 16];

/** A word that seems to last too long has swallowed the silence before it (an intro, a break): it starts later. */
export const longestWord = (tokens: number) => 0.45 * tokens + 0.6;

export async function align(audio: Float32Array, lines: string[], model: Model): Promise<Alignment> {
  let words: Word[] = [];
  lines.forEach((text, line) => {
    for (const w of text.split(/\s+/).filter(Boolean)) {
      const ids = model.encode(` ${w}`);
      if (ids.length) words.push({ text: w, line, ids });
    }
  });
  const key = (l: string) => l.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const unique = lines.map((l) => lines.filter((o) => key(o) === key(l)).length === 1);
  const duration = audio.length / SAMPLE_RATE;
  let seek = 0;
  let next = 0;
  // the word the look-ahead was last tried for (once per place in the words)
  let lookedFor = -1;
  // a bound on the windows, whatever happens
  for (let round = 0; next < words.length && seek < duration - 1 && round < 40 + words.length; round++) {
    const from = Math.floor(seek * SAMPLE_RATE);
    const length = Math.min(audio.length - from, WINDOW_S * SAMPLE_RATE) / SAMPLE_RATE;
    const last = from + WINDOW_S * SAMPLE_RATE >= audio.length;
    const take: Word[] = [];
    let tokens = 0;
    for (let k = next; k < words.length && tokens + words[k]!.ids.length <= MAX_TOKENS; k++) {
      take.push(words[k]!);
      tokens += words[k]!.ids.length;
    }
    if (!take.length) break;
    /** these words placed in the window starting at `at` (s): each word's start, certainty, and each line's */
    const place = async (at: number) => {
      const start = Math.floor(at * SAMPLE_RATE);
      const r = await model.forward(
        audio.subarray(start, Math.min(audio.length, start + WINDOW_S * SAMPLE_RATE)),
        take.flatMap((w) => w.ids),
      );
      let k = 0;
      const starts: number[] = [];
      const p: number[] = [];
      for (const w of take) {
        starts.push(r.starts[k]!);
        // the geometric mean of the word's tokens
        p.push(Math.exp(w.ids.reduce((n, _, j) => n + Math.log(Math.max(1e-9, r.p[k + j] ?? 0)), 0) / w.ids.length));
        k += w.ids.length;
      }
      const here = [...new Set(take.map((w) => w.line))].map((line) => {
        const idx = take.flatMap((w, i) => (w.line === line ? [i] : []));
        return { line, p: idx.reduce((n, i) => n + p[i]!, 0) / idx.length, start: starts[idx[0]!]!, unique: unique[line]! };
      });
      return { r, starts, p, here };
    };
    let placed = await place(seek);

    // the first line isn't heard here: maybe it comes a little later (after a chorus, a break)
    if (!last && placed.here[0]!.p < 0.15 && lookedFor !== next) {
      lookedFor = next;
      let best = { shift: 0, p: placed.here[0]!.p };
      for (const shift of LOOK_AHEAD) {
        if (seek + shift > duration - 2) break;
        const p = (await place(seek + shift)).here[0]!.p;
        if (p > best.p) best = { shift, p };
      }
      if (best.shift && best.p >= 0.25 && best.p > placed.here[0]!.p + 0.1) {
        seek += best.shift;
        continue;
      }
      placed = await place(seek);
    }
    const { r, starts } = placed;
    take.forEach((w, i) => (w.p = placed.p[i]));

    // lines not heard here are set aside (fillGaps puts them back), and the window is placed again
    const unsung = unsungLines(placed.here, length, last);
    if (unsung.length) {
      words = words.filter((w) => !unsung.includes(w.line));
      next = words.findIndex((w) => w.t === undefined);
      if (next < 0) break;
      continue;
    }

    // keep the words that start well inside the window (the rest got squeezed against its end)
    let kept = 0;
    for (let i = 0; i < take.length; i++) {
      const end = i + 1 < take.length ? starts[i + 1]! : r.end;
      if (!last && (starts[i]! > length - 4 || end > length - 0.3)) break;
      take[i]!.t = seek + Math.max(starts[i]!, end - longestWord(take[i]!.ids.length));
      take[i]!.end = seek + end;
      kept++;
    }
    if (!kept) {
      // no voice for these words here: further on
      seek += 10;
      continue;
    }
    next += kept;
    seek = Math.max(seek + 1, words[next - 1]!.end!);
  }

  const placed = words.filter((w) => w.t !== undefined);
  // a line counts when all its words were placed
  const found: (AlignedLine | null)[] = lines.map((_, line) => {
    const ws = words.filter((w) => w.line === line);
    if (!ws.length || ws.some((w) => w.t === undefined)) return null;
    return { t: ws[0]!.t!, end: ws[ws.length - 1]!.end!, text: ws.map((w) => w.text).join(" "), words: ws.map((w, i) => ({ t: w.t!, end: w.end!, text: i < ws.length - 1 ? `${w.text} ` : w.text })) };
  });
  const count = found.filter(Boolean).length;
  return {
    lines: fillGaps(lines, found, duration),
    confidence: placed.length ? placed.reduce((n, w) => n + w.p!, 0) / placed.length : 0,
    coverage: lines.length ? count / lines.length : 0,
  };
}

/**
 * The lines that weren't placed (not heard: a dropped verse, or words the model finds unlikely — swearing, slang) stay
 * in the text, spread by their words between the placed lines around them: losing a sung line is worse than showing
 * one that isn't sung.
 */
export function fillGaps(lines: string[], found: (AlignedLine | null)[], duration: number): AlignedLine[] {
  const out: AlignedLine[] = [];
  for (let i = 0; i < lines.length; ) {
    if (found[i]) {
      out.push(found[i]!);
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && !found[j]) j++;
    const gap = lines.slice(i, j).map((l) => l.split(/\s+/).filter(Boolean));
    const n = gap.reduce((s, ws) => s + ws.length, 0);
    const before = out[out.length - 1];
    const after = found[j] ?? null;
    // about 0.4 s a word where nothing bounds the gap
    const to = after ? after.t : Math.min(duration, (before?.end ?? 0) + n * 0.4);
    const from = before ? before.end : Math.max(0, to - n * 0.4);
    const step = n ? Math.max(0, to - from) / n : 0;
    let at = from;
    for (const ws of gap) {
      const words = ws.map((w, k) => {
        const word = { t: at, end: at + step, text: k < ws.length - 1 ? `${w} ` : w };
        at += step;
        return word;
      });
      out.push({ t: words[0]?.t ?? at, end: at, text: ws.join(" "), words });
    }
    i = j;
  }
  return out;
}

/** Whether to show the alignment: most lines placed, and the model fairly sure of them. */
export const trustworthy = (a: Alignment) => a.coverage >= 0.5 && a.confidence >= 0.25;
