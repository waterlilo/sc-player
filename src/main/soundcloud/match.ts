/**
 * Is that other upload the same recording? Pure functions (no imports) so they can be tested on their own
 * (npm test). Used to find a playable copy of a track SoundCloud only streams with DRM.
 *
 * The rules, strictest first:
 * - the length must match (±tolerance seconds) — the main guard against other versions;
 * - words that mark another version (slowed, sped up, remix, cover…) must not appear unless the original has them;
 * - the title must be close, and the artist must show up in the title or be the uploader.
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
  "instrumental",
  "inst",
  "karaoke",
  "acapella",
  "a capella",
  "8d",
  "bass boosted",
  "bassboosted",
  "boosted",
  "live",
  "extended",
  "edit",
  "mashup",
  "loop",
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
  "ai",
  "ai cover",
  "meme",
  "reaction",
  "tutorial",
  "type beat",
  "beat",
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
const FILLER = ["official", "audio", "video", "music", "lyrics", "lyric", "hq", "hd", "full", "song", "by", "with", "and", "the", "original", "mp3", "m4a", "wav", "x", "feat", "ft", "prod", "new", "single", "album", "track", "high", "quality", "explicit", "clean"];

/** Bump when the rules change: answers remembered under older rules are not reused. */
export const MATCH_VERSION = 5;

/** The main credited artist: "Drake, Don Toliver" → "Drake", "A x B feat. C" → "A". */
export function primaryArtist(artist: string): string {
  return artist.split(/\s*(?:,|&|;|\/|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\band\b)\s*/i)[0]?.trim() ?? artist;
}

/** Lowercase, no brackets' noise ("Official Audio", "Explicit"…), no punctuation, single spaces. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[([{]\s*(official( music)? (audio|video)|audio|lyrics?( video)?|explicit|clean|hq|hd|free download|out now)\s*[)\]}]/g, " ")
    .replace(/\b(feat|ft|featuring|prod|prod by)\b\.?[^()[\]]*/g, " ")
    // "CAN'T" and "Cant" are the same word
    .replace(/['’‘`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (s: string) => new Set(normalize(s).split(" ").filter(Boolean));

// a version word is whole when no Latin / Cyrillic letter or digit touches it: "社畜remix" still has "remix"
const LETTER = "[\\p{Script=Latin}\\p{Script=Cyrillic}\\p{N}]";
const VERSION_RES = VERSION_WORDS.map((w) => [w, new RegExp(`(?<!${LETTER})${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!${LETTER})`, "u")] as const);

/** Version words found in a text (as whole words or phrases). */
export function versionMarks(s: string): Set<string> {
  const text = normalize(s);
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

/** 0..1 how sure we are; 0 means "not the same recording". */
export function matchScore(original: MatchInput, c: Candidate, toleranceSec: number): number {
  if (Math.abs(original.durationMs - c.durationMs) > toleranceSec * 1000) return 0;
  const before = versionMarks(`${original.title} ${original.artist}`);
  // version words in the title or in the uploader's name ("Instrumental Archives", "Slowed Hub")
  for (const mark of versionMarks(`${c.title} ${c.uploader}`)) if (!before.has(mark)) return 0;

  // the original title as a whole phrase in the candidate's title ("My Eyes" must not match "Eyes Peas My Humps")
  const own = normalize(original.title);
  const phrase = own.length > 0 && ` ${normalize(c.title)} `.includes(` ${own} `);
  const titleFit = titleOverlap(original.title, c.title);
  if (!phrase && titleFit < 0.85) return 0;

  // the (main) artist must be named in the title or be the uploader — a same-titled song by someone else is not it
  const main = normalize(primaryArtist(original.artist));
  const artistWords = main.split(" ").filter(Boolean);
  const inTitle = artistWords.length > 0 && artistWords.every((w) => words(c.title).has(w));
  const byArtist = main.length >= 2 && normalize(c.uploader).includes(main);
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

/** Search queries for the original, most specific first: all credited artists, the main one, then the title alone. */
export function searchQueries(original: MatchInput): string[] {
  const title = normalize(original.title);
  const withArtist = (a: string) => (!a || title.includes(a) ? title : `${a} ${title}`);
  return [...new Set([withArtist(normalize(original.artist)), withArtist(normalize(primaryArtist(original.artist))), title].filter((q) => q.length > 1))];
}

/** The candidates that pass, best first. */
export function rankCandidates(original: MatchInput, candidates: Candidate[], toleranceSec: number, minScore = 0.55): Candidate[] {
  return candidates
    .map((c) => ({ c, s: matchScore(original, c, toleranceSec) }))
    .filter((x) => x.s >= minScore)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}
