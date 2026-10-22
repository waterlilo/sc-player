import type { LyricWord } from "@shared/types";

/**
 * TTML lyrics (Better Lyrics, Unison, Apple-style "itunes" TTML) into lines with their own and their words' times.
 * A small reader for this one shape, no XML library: <p begin end> per line, <span begin end> per word or syllable
 * (the text between spans keeps the spaces), <span ttm:role="x-bg"> around background vocals. Pure: tested on its own.
 */

export interface TtmlLine {
  t: number;
  end: number;
  text: string;
  words?: LyricWord[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** "00:01:30.500", "1:16.656", "12.5", "12.5s" → seconds; NaN when unreadable. */
export function parseTime(v: string | undefined): number {
  if (!v) return NaN;
  const s = v.trim().replace(/s$/, "");
  const parts = s.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

const attr = (attrs: string, name: string) => new RegExp(`(?:^|\\s)${name.replace(":", "\\:")}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1];

/** One <p>: its timed spans become words; with none, the line is timed as a whole. */
function readLine(attrs: string, inner: string): TtmlLine | null {
  const words: LyricWord[] = [];
  // walk the tags in order: timed spans are words, a bg wrapper marks what it holds, text between spans goes to the
  // word before it (that is where the spaces are)
  const re = /<span\b([^>]*)>|<\/span>|<br\s*\/?>|([^<]+)|<[^>]+>/g;
  const stack: { timed: boolean; bg: boolean; begin: number; end: number; text: string }[] = [];
  let loose = "";
  for (let m = re.exec(inner); m; m = re.exec(inner)) {
    if (m[0].startsWith("<span")) {
      const a = m[1] ?? "";
      const begin = parseTime(attr(a, "begin"));
      const bg = attr(a, "ttm:role") === "x-bg" || !!stack[stack.length - 1]?.bg;
      stack.push({ timed: Number.isFinite(begin), bg, begin, end: parseTime(attr(a, "end")), text: "" });
    } else if (m[0] === "</span>") {
      const top = stack.pop();
      if (top?.timed) {
        const text = decodeEntities(top.text);
        if (text.trim()) words.push({ t: top.begin, end: Number.isFinite(top.end) ? top.end : top.begin, text, ...(top.bg ? { bg: true } : {}) });
        else if (words.length) words[words.length - 1]!.text += text;
      }
    } else if (m[2] !== undefined) {
      const open = [...stack].reverse().find((x) => x.timed);
      if (open) open.text += m[2];
      else if (words.length) words[words.length - 1]!.text += decodeEntities(m[2]).replace(/\s+/g, " ");
      else loose += m[2];
    } else if (m[0].startsWith("<br")) {
      if (words.length) words[words.length - 1]!.text += " ";
      else loose += " ";
    }
  }
  const begin = parseTime(attr(attrs, "begin"));
  const end = parseTime(attr(attrs, "end"));
  if (words.length) {
    // a background vocal opening the line keeps its brackets out of the main words' order: kept as they come
    const text = words
      .map((w) => w.text)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    return { t: Number.isFinite(begin) ? begin : words[0]!.t, end: Number.isFinite(end) ? end : words[words.length - 1]!.end, text, words };
  }
  const text = decodeEntities(loose).replace(/\s+/g, " ").trim();
  if (!Number.isFinite(begin)) return null;
  return { t: begin, end: Number.isFinite(end) ? end : begin, text };
}

/** All the lines of a TTML document, by start time; empty when it has none. */
export function parseTtml(ttml: string): TtmlLine[] {
  const body = ttml.slice(Math.max(0, ttml.search(/<body\b/)));
  const lines: TtmlLine[] = [];
  for (const m of body.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
    const line = readLine(m[1] ?? "", m[2] ?? "");
    if (line && (line.text || line.words?.length)) lines.push(line);
  }
  return lines.sort((a, b) => a.t - b.t);
}

/** Whether the document times single words ("Word" timing), not just lines. */
export const wordTimed = (lines: TtmlLine[]) => lines.some((l) => (l.words?.length ?? 0) > 1);
