import assert from "node:assert/strict";
import { test } from "node:test";
import { normalize, primaryArtist, rankCandidates, repairMojibake, searchQueries, soundScore, strictTextScore, versionMarks, waveSimilarity, type Candidate, type MatchInput } from "./match.ts";

const original: MatchInput = { title: "Midnight (Official Audio) [feat. Someone]", artist: "Paper Moon", uploader: "Paper Moon Official", durationMs: 187_000 };
const cand = (over: Partial<Candidate>): Candidate => ({ id: 1, title: "Paper Moon - Midnight", artist: "", uploader: "random fan", durationMs: 187_500, plays: 1000, ...over });

test("normalize drops the noise in brackets and featurings", () => {
  assert.equal(normalize("Midnight (Official Audio) [feat. Someone]"), "midnight");
  assert.equal(normalize("ЗВЁЗДЫ — над МКАДом!!"), "звезды над мкадом");
});

test("version words", () => {
  assert.deepEqual([...versionMarks("Midnight (slowed + reverb)")].sort(), ["reverb", "slowed"]);
  assert.equal(versionMarks("Midnight").size, 0);
});

test("the same recording re-uploaded matches", () => {
  assert.ok(strictTextScore(original, cand({}), 3) > 0.55);
});

test("a different length never matches", () => {
  assert.equal(strictTextScore(original, cand({ durationMs: 191_000 }), 3), 0);
});

test("slowed / remix / sped up uploads are rejected", () => {
  assert.equal(strictTextScore(original, cand({ title: "Paper Moon - Midnight (slowed + reverb)" }), 3), 0);
  assert.equal(strictTextScore(original, cand({ title: "Midnight (Paper Moon remix)" }), 3), 0);
  assert.equal(strictTextScore(original, cand({ title: "Paper Moon - Midnight sped up" }), 3), 0);
});

test("a version word that the original has is fine", () => {
  const remix: MatchInput = { ...original, title: "Midnight (DJ Remix)" };
  assert.ok(strictTextScore(remix, cand({ title: "Paper Moon - Midnight (DJ Remix)" }), 3) > 0);
});

test("an unrelated track with the same length is rejected", () => {
  assert.equal(strictTextScore(original, cand({ title: "Glass Choir - Static Bloom" }), 3), 0);
});

test("the artist's own upload ranks first", () => {
  const ranked = rankCandidates(original, [cand({ id: 1, uploader: "fan", plays: 50_000 }), cand({ id: 2, title: "Midnight", uploader: "Paper Moon", plays: 10 })], 3);
  assert.equal(ranked[0]?.id, 2);
});

// real false matches found on SoundCloud while testing v1.3
test("real-world misses are rejected", () => {
  const o = (title: string, artist: string, sec: number): MatchInput => ({ title, artist, uploader: artist, durationMs: sec * 1000 });
  const c = (title: string, uploader: string, sec: number): Candidate => ({ id: 9, title, artist: "", uploader, durationMs: sec * 1000, plays: 100 });
  assert.equal(strictTextScore(o("Cold Shoulder", "Drake, Don Toliver, Yebba", 235), c("Cold Shoulder Screw FOMO (5IV0 PITCHDOWNRADIO)", "PITCHDOWNRADIO", 234), 3), 0);
  assert.equal(strictTextScore(o("WILDFLOWER", "Billie Eilish", 262), c("Billie Eilish - Wildflower (Metalcore / Modern Post-Hardcore)", "Radityaaa04", 263), 3), 0);
  assert.equal(strictTextScore(o("lovely", "Billie Eilish, Khalid", 202), c("Руслан Утюг Lovely Billie Eilish, Khalid На Русском", "aloe13", 201), 3), 0);
  assert.equal(strictTextScore(o("BIRDS OF A FEATHER", "Billie Eilish", 210), c("BIRDS OF A FEATHER - Tiny Desk Concert.mp3", "Billie Eilish Brasil", 208), 3), 0);
  assert.equal(strictTextScore(o("MY EYES", "Travis Scott", 251), c("Black Eyes Peas- My Humps", "Baja Tu Musica", 252), 3), 0);
  assert.equal(strictTextScore(o("HIGHEST IN THE ROOM", "Travis Scott", 176), c("SMARTEST IN CLASSROOM (Travis Scott - Highest in the Room ASIAN PARODY)", "Fregend", 179), 3), 0);
  assert.equal(strictTextScore(o("I'll Take Care of You (feat. Yebba)", "Tyler, The Creator", 201), c("Beth Hart I'll Take Care Of You", "bigispromotion", 198), 3), 0);
  assert.equal(strictTextScore(o("EARFQUAKE", "Tyler, The Creator", 190), c("Tyler, The Creator Earfquake Minecraft Parody - Blockbreak Ft. Slappyy", "Okay", 190), 3), 0);
  assert.equal(strictTextScore(o("EARFQUAKE", "Tyler, The Creator", 190), c("Tyler, The Creator - EARFQUAKE Instumental", "Instrumental Archives", 190), 3), 0);
  assert.equal(strictTextScore(o("Type Shit", "Future, Metro Boomin, Travis Scott, Playboi Carti", 228), c("Future x Metro Boomin x Travis Scott x Playboi Carti - Type Shit (Prod. Edwards Broz)", "Edwards Broz", 226), 3), 0);
});

test("real-world good matches still pass", () => {
  const o = (title: string, artist: string, sec: number): MatchInput => ({ title, artist, uploader: artist, durationMs: sec * 1000 });
  const c = (title: string, uploader: string, sec: number): Candidate => ({ id: 9, title, artist: "", uploader, durationMs: sec * 1000, plays: 100 });
  assert.ok(strictTextScore(o("Клетка", "Molchat Doma", 284), c("клетка", "Molchat Doma", 284), 3) > 0);
  assert.ok(strictTextScore(o("NOKIA", "Drake", 241), c("PARTYNEXTDOOR___DRAKE_-_NOKIA", "PartyNextDoor_Drake Music", 241), 3) > 0);
  assert.ok(strictTextScore(o("Quebec", "Drake", 130), c("Drake - FOMO “Quebec” FULL SONG HQ", "Unghetto (@Unghetto)", 133), 3) > 0);
  assert.ok(strictTextScore(o("CHIHIRO", "Billie Eilish", 303), c("CHIHIRO", "Billie Eilish Netherlands", 305), 3) > 0);
});

// v1.3.1: previews (Go+ tracks for listeners without a subscription) that found nothing
test("apostrophes don't split words", () => {
  assert.equal(normalize("CAN'T SAY"), "cant say");
  const o: MatchInput = { title: "CAN'T SAY", artist: "Travis Scott", uploader: "Travis Scott", durationMs: 198_000 };
  assert.ok(strictTextScore(o, { id: 9, title: "CANT SAY by travis scott", artist: "", uploader: "robert14", durationMs: 197_000, plays: 100 }, 3) > 0);
  assert.ok(strictTextScore(o, { id: 9, title: "CAN’T SAY (With Travis Scott & Don Toliver)", artist: "", uploader: "Global Rub", durationMs: 196_000, plays: 100 }, 3) > 0);
});

test("a version word glued to other scripts still counts", () => {
  const o: MatchInput = { title: "HUMBLE.", artist: "Kendrick Lamar", uploader: "Kendrick Lamar", durationMs: 177_000 };
  assert.equal(strictTextScore({ title: "Stressed Out", artist: "twenty one pilots", uploader: "twentyonepilots", durationMs: 202_000 }, { id: 9, title: "Twenty One Pilots - Stressed Out V 2Pac - Pain", artist: "", uploader: "Jamie Gos", durationMs: 201_000, plays: 100 }, 3), 0);
  assert.equal(strictTextScore({ ...o, title: "DNA." }, { id: 9, title: "DNA(DubEdit) - KENDRICK LAMAR", artist: "", uploader: "Playlist Dr.", durationMs: 177_000, plays: 100 }, 3), 0);
  assert.equal(strictTextScore(o, { id: 9, title: "Kendrick Lamar - HUMBLE.(福岡の社畜Remix)", artist: "", uploader: "福岡の社畜", durationMs: 177_000, plays: 100 }, 3), 0);
  assert.ok(strictTextScore(o, { id: 9, title: "Kendrick Lamar - HUMBLE.", artist: "", uploader: "-Mz", durationMs: 177_000, plays: 100 }, 3) > 0);
  // a word that only contains a version word is not one
  assert.equal(versionMarks("Livewire").size, 0);
});

test("queries also try the main artist alone", () => {
  assert.deepEqual(searchQueries({ title: "Type Shit", artist: "Future, Metro Boomin", uploader: "", durationMs: 0 }), ["future metro boomin type shit", "future type shit", "type shit"]);
});

test("main artist of a credit list", () => {
  assert.equal(primaryArtist("Drake, Don Toliver, Yebba"), "Drake");
  assert.equal(primaryArtist("Future x Metro Boomin"), "Future");
  assert.equal(primaryArtist("Tyler, The Creator"), "Tyler");
});

test("queries: artist + title, then the title alone", () => {
  assert.deepEqual(searchQueries(original), ["paper moon midnight", "midnight feat someone", "midnight"]);
});

// v2: the overhaul (real cases from a listener's likes)
test("broken encodings are read back", () => {
  assert.equal(repairMojibake("[ðƒð╗ð░Ðéð©ð¢ð░] ðæð░ð¢ð┤ð░ð¢ð░"), "[Платина] Бандана");
  assert.equal(repairMojibake("ÐŸÐ»Ð°Ñ‚Ð¸Ð½Ð°"), "Платина");
  assert.equal(repairMojibake("Café del Mar"), "Café del Mar");
  assert.equal(normalize("ðæð░ð¢ð┤ð░ð¢ð░ [prod. By Dee Dizzyin].mp3"), "бандана mp3");
});

test("version words after a featuring still count", () => {
  assert.ok(versionMarks("Rockstar-Dababy ft Roddy Ricch Instrumental|Prod by AP X h4rrye)").has("instrumental"));
  assert.ok(versionMarks("Lil Peep - Save That Shit [Bass Boost]").has("boost"));
  assert.equal(versionMarks("Strobe (Original Mix)").size, 0);
});

const sine = (n: number, period: number, phase = 0) => Array.from({ length: n }, (_, i) => 60 + 30 * Math.sin((i + phase) / period) + 10 * Math.sin((i + phase) / (period / 7)));

test("the same waveform matches itself, a different one does not", () => {
  const a = sine(1800, 40);
  assert.ok(waveSimilarity(a, 180_000, a, 180_000).corr > 0.99);
  // a re-upload a second longer (silence at the start) still lines up
  const late = [...Array(10).fill(0), ...a];
  assert.ok(waveSimilarity(a, 180_000, late, 181_000).corr > 0.95);
  assert.ok(waveSimilarity(a, 180_000, sine(1800, 13, 500), 180_000).corr < 0.5);
});

test("by sound: a close curve with the right words passes, a cover's does not", () => {
  const o: MatchInput = { title: "red eyes", artist: "overtonight throwaways, overtonight", uploader: "overtonight", durationMs: 152_000 };
  const reupload: Candidate = { id: 1, title: "red eyes (here with me)", artist: "", uploader: "overtonight unreleased", durationMs: 152_000, plays: 1000 };
  assert.ok(soundScore(o, reupload, { corr: 0.96, mad: 0.02, shiftMs: 0 }, 3) > 0);
  // the same words but another loudness curve: a cover or another song
  assert.equal(soundScore(o, reupload, { corr: 0.64, mad: 0.06, shiftMs: -200 }, 3), 0);
  // an instrumental never passes, however close its curve
  const inst: Candidate = { ...reupload, id: 2, title: "red eyes instrumental" };
  assert.equal(soundScore(o, inst, { corr: 0.99, mad: 0.01, shiftMs: 0 }, 3), 0);
});
