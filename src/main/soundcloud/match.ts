/**
 * Is that other upload the same recording? Pure functions (no imports) so they can be tested on their own
 * (npm test). Used to find a playable copy of a track SoundCloud only streams with DRM (or as a 30 s preview).
 *
 * Two steps:
 * 1. Words. Search results are cut down to the ones that could be it: the length must match (±tolerance), words that
 *    mark another version (slowed, remix, instrumental, cover…) must not appear unless the original has them, and the
 *    title must be close. Broken text encodings in titles are repaired first.
 * 2. Sound. SoundCloud draws a waveform for every upload, protected ones too. A re-upload of the same recording has
 *    the same loudness curve; a cover, a remake, an instrumental or another song of the same length does not. When
 *    the original's waveform is there, the sound decides; without it only very close titles by the artist pass.
 */

export interface MatchInput {
  title: string;
  /** the credited artist (publisher metadata) */
  artist: string;
  /** the uploader's name */
  uploader: string;
  durationMs: number;
}

export interface Candidate extends MatchInput {
  id: number;
  plays: number;
}

const VERSION_WORDS = [
  "slowed",
  "slow",
  "sped",
  "speed up",
  "sped up",
  "spedup",
  "nightcore",
  "daycore",
  "reverb",
  "remix",
  "rmx",
  "flip",
  "bootleg",
  "cover",
  "covers",
  "instrumental",
  "inst",
  "karaoke",
  "acapella",
  "a capella",
  "8d",
  "bass boosted",
  "bassboosted",
  "boosted",
  "bassboost",
  "boost",
  "live",
  "extended",
  "edit",
  "mashup",
  "loop",
  "looped",
  "hour",
  "1 hour",
  "phonk",
  "lofi",
  "lo-fi",
  "piano",
  "orchestral",
  "chopped",
  "screwed",
  "mix",
  "version",
  "demo",
  "snippet",
  "leak",
  "intro",
  "preview",
  // found in real searches: screwed versions, parodies, covers, live sessions, AI covers
  "screw",
  "parody",
  "tribute",
  "tiny desk",
  "concert",
  "session",
  "sessions",
  "unplugged",
  "acoustic",
  "metalcore",
  "hardcore",
  "metal",
  "rock version",
  "minecraft",
  "8 bit",
  "8bit",
  "chiptune",
  "ai",
  "ai cover",
  "meme",
  "reaction",
  "tutorial",
  "type beat",
  "beat",
  "remake",
  "remade",
  "reprod",
  "recreation",
  "recreated",
  "pitched",
  "stacked",
  "gym",
  "workout",
  "motivation",
  "на русском",
  "кавер",
  "перевод",
  "ремикс",
  "ремейк",
  "пародия",
  "минус",
  "караоке",
  "замедленная",
  "замедленный",
  "ускоренная",
  "ускоренный",
  "speed",
  "instumental",
  "instrumentals",
  "instrumetal",
  "slowedreverb",
  "dub",
  "dubedit",
  "dubmix",
  // mashups: "Stressed Out V 2Pac - Pain"
  "vs",
  "v",
  "versus",
];

/** Words an upload's title may add without being another version. */
const FILLER = ["official", "audio", "video", "music", "lyrics", "lyric", "hq", "hd", "full", "song", "by", "with", "and", "the", "original", "mp3", "m4a", "wav", "x", "feat", "ft", "prod", "new", "single", "album", "track", "high", "quality", "explicit", "clean", "unreleased", "kbps", "128k", "320k"];

/** Bump when the rules change: answers remembered under older rules are not reused. */
export const MATCH_VERSION = 7;

// ---- text ---------------------------------------------------------------------------------------------------------

/** Code page 850 (old Windows console), upper half: UTF-8 bytes shown in it look like "ðƒð╗ð░". */
const CP850 =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";
/** Windows-1252, 0x80–0x9F (the rest of the upper half is Latin-1): UTF-8 shown in it looks like "ÐŸÐ»Ð°". */
const CP1252_80 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

function bytesVia(s: string, table: (ch: string) => number): Uint8Array | null {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) out[i] = code;
    else {
      const b = table(s[i]!);
      if (b < 0) return null;
      out[i] = b;
    }
  }
  return out;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Text whose UTF-8 bytes were read as an old code page and saved like that ("ðæð░ð¢ð┤ð░ð¢ð░" for "Бандана"): read
 * the bytes back. Anything that doesn't decode cleanly is left as it is.
 */
export function repairMojibake(s: string): string {
  if (!/[ÐÑÃÂð][\u0080-☀]/.test(s)) return s;
  const tries = [
    bytesVia(s, (ch) => {
      const i = CP850.indexOf(ch);
      return i < 0 ? -1 : 0x80 + i;
    }),
    bytesVia(s, (ch) => {
      const i = CP1252_80.indexOf(ch);
      if (i >= 0) return 0x80 + i;
      const c = ch.charCodeAt(0);
      return c >= 0xa0 && c <= 0xff ? c : -1;
    }),
  ];
  for (const bytes of tries) {
    if (!bytes) continue;
    try {
      return utf8.decode(bytes);
    } catch {
      /* not this one */
    }
  }
  return s;
}

/** The main credited artist: "Drake, Don Toliver" → "Drake", "A x B feat. C" → "A". */
export function primaryArtist(artist: string): string {
  return artist.split(/\s*(?:,|&|;|\/|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\band\b)\s*/i)[0]?.trim() ?? artist;
}

const plain = (s: string) =>
  repairMojibake(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    // "CAN'T" and "Cant" are the same word
    .replace(/['’‘`´]/g, "");

const BRACKET_NOISE = /[([{]\s*(official( music)? (audio|video)|audio|lyrics?( video)?|explicit|clean|hq|hd|free download|out now)\s*[)\]}]/g;

/** Lowercase, no brackets' noise ("Official Audio", "Explicit"…), no featurings, no punctuation, single spaces. */
export function normalize(s: string): string {
  return plain(s)
    .replace(BRACKET_NOISE, " ")
    .replace(/\b(feat|ft|featuring|prod|prod by)\b\.?[^()[\]]*/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (s: string) => new Set(normalize(s).split(" ").filter(Boolean));

// a version word is whole when no Latin / Cyrillic letter or digit touches it: "社畜remix" still has "remix"
const LETTER = "[\\p{Script=Latin}\\p{Script=Cyrillic}\\p{N}]";
const VERSION_RES = VERSION_WORDS.map((w) => [w, new RegExp(`(?<!${LETTER})${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!${LETTER})`, "u")] as const);

/**
 * Version words found in a text (as whole words or phrases). Everything is read, featurings and producer credits
 * too: "Rockstar ft Roddy Ricch Instrumental" is still an instrumental. "Original Mix" is the original.
 */
export function versionMarks(s: string): Set<string> {
  const text = plain(s)
    .replace(/\boriginal mix\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return new Set(VERSION_RES.filter(([, re]) => re.test(text)).map(([w]) => w));
}

/** Share of the original title's words found in the candidate's title (0..1). */
export function titleOverlap(original: string, candidate: string): number {
  const a = words(original);
  if (!a.size) return 0;
  const b = words(candidate);
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / a.size;
}

/** The (main) artist named in the candidate's title, or the uploader's name contains it. */
function artistPresence(original: MatchInput, c: Candidate): { inTitle: boolean; byArtist: boolean } {
  const main = normalize(primaryArtist(original.artist));
  const artistWords = main.split(" ").filter(Boolean);
  const titleWords = words(c.title);
  const inTitle = artistWords.length > 0 && artistWords.every((w) => titleWords.has(w));
  const byArtist = main.length >= 2 && normalize(c.uploader).includes(main);
  return { inTitle, byArtist };
}

/** No words that mark another version, unless the original has them too. */
function sameVersion(original: MatchInput, c: Candidate): boolean {
  const before = versionMarks(`${original.title} ${original.artist}`);
  // version words in the title or in the uploader's name ("Instrumental Archives", "Slowed Hub")
  for (const mark of versionMarks(`${c.title} ${c.uploader}`)) if (!before.has(mark)) return false;
  return true;
}

/**
 * Step 1: could this upload be the track? 0 = no; otherwise how well the words fit (0..1), to choose which ones to
 * compare by sound. Loose on purpose: the sound decides.
 */
export function textScore(original: MatchInput, c: Candidate, toleranceSec: number): number {
  if (Math.abs(original.durationMs - c.durationMs) > toleranceSec * 1000) return 0;
  if (!sameVersion(original, c)) return 0;
  const own = normalize(original.title);
  const phrase = own.length > 0 && ` ${normalize(c.title)} `.includes(` ${own} `);
  const fit = phrase ? 1 : titleOverlap(original.title, c.title);
  if (fit < 0.5) return 0;
  const { inTitle, byArtist } = artistPresence(original, c);
  const lengthFit = 1 - Math.abs(original.durationMs - c.durationMs) / (toleranceSec * 1000 + 1);
  return 0.55 * fit + (byArtist ? 0.25 : inTitle ? 0.2 : 0) + 0.15 * lengthFit + Math.min(0.05, Math.log10(c.plays + 1) / 120);
}

/** Without a waveform: only a title this close, by the artist, passes — the old rules. 0 = no, else 0..1. */
export function strictTextScore(original: MatchInput, c: Candidate, toleranceSec: number): number {
  if (!textScore(original, c, toleranceSec)) return 0;
  const own = normalize(original.title);
  const phrase = own.length > 0 && ` ${normalize(c.title)} `.includes(` ${own} `);
  const titleFit = titleOverlap(original.title, c.title);
  if (!phrase && titleFit < 0.85) return 0;
  const { inTitle, byArtist } = artistPresence(original, c);
  if (!inTitle && !byArtist) return 0;

  // "(Prod. <the uploader>)" by someone who isn't the artist: that producer's remake
  const prodAt = c.title.toLowerCase().search(/\bprod\b/);
  const uploader = normalize(c.uploader);
  const prodTail = prodAt >= 0 ? c.title.slice(prodAt).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ") : "";
  if (!byArtist && uploader.length >= 3 && prodTail.includes(uploader)) return 0;

  // many words neither in the original's title nor in the credits: another song mixed in, or someone else's track
  const known = new Set([...words(original.title), ...words(original.artist), ...words(original.uploader), ...words(c.uploader), ...FILLER]);
  const extra = [...words(c.title)].filter((w) => !known.has(w));
  if (extra.length > 3) return 0;

  const lengthFit = 1 - Math.abs(original.durationMs - c.durationMs) / (toleranceSec * 1000 + 1);
  return Math.min(1, 0.45 * titleFit + 0.2 * lengthFit + (byArtist ? 0.25 : inTitle ? 0.15 : 0) + Math.min(0.1, Math.log10(c.plays + 1) / 60));
}

// ---- sound --------------------------------------------------------------------------------------------------------

const STEP_MS = 100;

/** A waveform's loudness on a 100 ms grid, 0..1 by its own loudest point (SoundCloud spreads any length over ~1800 samples). */
function onGrid(samples: number[], durationMs: number): Float64Array {
  let max = 0;
  for (const s of samples) if (s > max) max = s;
  max ||= 1;
  const n = Math.max(1, Math.floor(durationMs / STEP_MS));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i / n) * samples.length);
    const b = Math.max(a + 1, Math.floor(((i + 1) / n) * samples.length));
    let sum = 0;
    for (let j = a; j < b && j < samples.length; j++) sum += samples[j]!;
    out[i] = sum / (b - a) / max;
  }
  return out;
}

export interface WaveFit {
  /** Pearson correlation of the two loudness curves at the best offset (-1..1) */
  corr: number;
  /** mean difference of the curves there (0..1) */
  mad: number;
  /** that offset, ms (silence added or cut at the start) */
  shiftMs: number;
}

/** How alike two waveforms are: their loudness curves on one time grid, shifted by up to ±maxShiftMs to line up. */
export function waveSimilarity(a: number[], aMs: number, b: number[], bMs: number, maxShiftMs = 2500): WaveFit {
  const A = onGrid(a, aMs);
  const B = onGrid(b, bMs);
  let best: WaveFit = { corr: -1, mad: 1, shiftMs: 0 };
  const maxShift = Math.round(maxShiftMs / STEP_MS);
  for (let s = -maxShift; s <= maxShift; s++) {
    let n = 0;
    let sa = 0;
    let sb = 0;
    let saa = 0;
    let sbb = 0;
    let sab = 0;
    let diff = 0;
    for (let i = 0; i < A.length; i++) {
      const j = i + s;
      if (j < 0 || j >= B.length) continue;
      const x = A[i]!;
      const y = B[j]!;
      n++;
      sa += x;
      sb += y;
      saa += x * x;
      sbb += y * y;
      sab += x * y;
      diff += Math.abs(x - y);
    }
    if (n < 50) continue;
    const va = saa / n - (sa / n) ** 2;
    const vb = sbb / n - (sb / n) ** 2;
    const corr = va > 1e-6 && vb > 1e-6 ? (sab / n - (sa / n) * (sb / n)) / Math.sqrt(va * vb) : 0;
    if (corr > best.corr) best = { corr, mad: diff / n, shiftMs: s * STEP_MS };
  }
  return best;
}

/**
 * Step 2, with both waveforms: is it the same recording? 0 = no, else 0..1.
 * - the loudness curves nearly coincide (corr ≥ 0.93, or ≥ 0.9 with a very small difference): yes, whatever the
 *   title says (it passed step 1, so the words are close enough and no version word is there);
 * - they are close (corr ≥ 0.85): only with a title this close by the artist and nearly the same length — covers and
 *   remakes land here too.
 */
export function soundScore(original: MatchInput, c: Candidate, fit: WaveFit, toleranceSec: number): number {
  const text = textScore(original, c, toleranceSec);
  if (!text) return 0;
  const strong = ((fit.corr >= 0.93 && fit.mad <= 0.05) || (fit.corr >= 0.9 && fit.mad <= 0.04)) && Math.abs(fit.shiftMs) <= 1500;
  const close =
    fit.corr >= 0.85 && fit.mad <= 0.065 && Math.abs(fit.shiftMs) <= 1600 && Math.abs(original.durationMs - c.durationMs) <= 1500 && strictTextScore(original, c, toleranceSec) > 0;
  if (!strong && !close) return 0;
  return Math.min(1, 0.75 * fit.corr + 0.2 * text + Math.min(0.05, Math.log10(c.plays + 1) / 120));
}

// ---- searching and ranking ----------------------------------------------------------------------------------------

/**
 * Search queries for the original, most specific first: all credited artists, the main one, the title as written
 * (fans' re-uploads keep its "(prod. …)" and featurings, and search ranks them by those), then the bare title.
 */
export function searchQueries(original: MatchInput): string[] {
  const title = normalize(original.title);
  const asWritten = plain(original.title)
    .replace(BRACKET_NOISE, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const withArtist = (a: string) => (!a || title.includes(a) ? title : `${a} ${title}`);
  return [...new Set([withArtist(normalize(original.artist)), withArtist(normalize(primaryArtist(original.artist))), asWritten, title].filter((q) => q.length > 1))];
}

/** Step 1 over a search: the uploads worth comparing by sound, best first. */
export function shortlist(original: MatchInput, candidates: Candidate[], toleranceSec: number, limit = 12): Candidate[] {
  return candidates
    .map((c) => ({ c, s: textScore(original, c, toleranceSec) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.c);
}

/** Without waveforms: the candidates that pass the strict words-only rules, best first. */
export function rankCandidates(original: MatchInput, candidates: Candidate[], toleranceSec: number, minScore = 0.55): Candidate[] {
  return candidates
    .map((c) => ({ c, s: strictTextScore(original, c, toleranceSec) }))
    .filter((x) => x.s >= minScore)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}

/** With waveforms: the candidates that sound like the original, best first. */
export function rankBySound(original: MatchInput, scored: { c: Candidate; fit: WaveFit }[], toleranceSec: number): Candidate[] {
  return scored
    .map(({ c, fit }) => ({ c, s: soundScore(original, c, fit, toleranceSec) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}
