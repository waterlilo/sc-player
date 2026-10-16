import assert from "node:assert/strict";
import { test } from "node:test";
import { matchScore, normalize, primaryArtist, rankCandidates, searchQueries, versionMarks, type Candidate, type MatchInput } from "./match.ts";

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
  assert.ok(matchScore(original, cand({}), 3) > 0.55);
});

test("a different length never matches", () => {
  assert.equal(matchScore(original, cand({ durationMs: 191_000 }), 3), 0);
});

test("slowed / remix / sped up uploads are rejected", () => {
  assert.equal(matchScore(original, cand({ title: "Paper Moon - Midnight (slowed + reverb)" }), 3), 0);
  assert.equal(matchScore(original, cand({ title: "Midnight (Paper Moon remix)" }), 3), 0);
  assert.equal(matchScore(original, cand({ title: "Paper Moon - Midnight sped up" }), 3), 0);
});

test("a version word that the original has is fine", () => {
  const remix: MatchInput = { ...original, title: "Midnight (DJ Remix)" };
  assert.ok(matchScore(remix, cand({ title: "Paper Moon - Midnight (DJ Remix)" }), 3) > 0);
});

test("an unrelated track with the same length is rejected", () => {
  assert.equal(matchScore(original, cand({ title: "Glass Choir - Static Bloom" }), 3), 0);
});

test("the artist's own upload ranks first", () => {
  const ranked = rankCandidates(original, [cand({ id: 1, uploader: "fan", plays: 50_000 }), cand({ id: 2, title: "Midnight", uploader: "Paper Moon", plays: 10 })], 3);
  assert.equal(ranked[0]?.id, 2);
});

// real false matches found on SoundCloud while testing v1.3
test("real-world misses are rejected", () => {
  const o = (title: string, artist: string, sec: number): MatchInput => ({ title, artist, uploader: artist, durationMs: sec * 1000 });
  const c = (title: string, uploader: string, sec: number): Candidate => ({ id: 9, title, artist: "", uploader, durationMs: sec * 1000, plays: 100 });
  assert.equal(matchScore(o("Cold Shoulder", "Drake, Don Toliver, Yebba", 235), c("Cold Shoulder Screw FOMO (5IV0 PITCHDOWNRADIO)", "PITCHDOWNRADIO", 234), 3), 0);
  assert.equal(matchScore(o("WILDFLOWER", "Billie Eilish", 262), c("Billie Eilish - Wildflower (Metalcore / Modern Post-Hardcore)", "Radityaaa04", 263), 3), 0);
  assert.equal(matchScore(o("lovely", "Billie Eilish, Khalid", 202), c("Руслан Утюг Lovely Billie Eilish, Khalid На Русском", "aloe13", 201), 3), 0);
  assert.equal(matchScore(o("BIRDS OF A FEATHER", "Billie Eilish", 210), c("BIRDS OF A FEATHER - Tiny Desk Concert.mp3", "Billie Eilish Brasil", 208), 3), 0);
  assert.equal(matchScore(o("MY EYES", "Travis Scott", 251), c("Black Eyes Peas- My Humps", "Baja Tu Musica", 252), 3), 0);
  assert.equal(matchScore(o("HIGHEST IN THE ROOM", "Travis Scott", 176), c("SMARTEST IN CLASSROOM (Travis Scott - Highest in the Room ASIAN PARODY)", "Fregend", 179), 3), 0);
  assert.equal(matchScore(o("I'll Take Care of You (feat. Yebba)", "Tyler, The Creator", 201), c("Beth Hart I'll Take Care Of You", "bigispromotion", 198), 3), 0);
  assert.equal(matchScore(o("EARFQUAKE", "Tyler, The Creator", 190), c("Tyler, The Creator Earfquake Minecraft Parody - Blockbreak Ft. Slappyy", "Okay", 190), 3), 0);
  assert.equal(matchScore(o("EARFQUAKE", "Tyler, The Creator", 190), c("Tyler, The Creator - EARFQUAKE Instumental", "Instrumental Archives", 190), 3), 0);
  assert.equal(matchScore(o("Type Shit", "Future, Metro Boomin, Travis Scott, Playboi Carti", 228), c("Future x Metro Boomin x Travis Scott x Playboi Carti - Type Shit (Prod. Edwards Broz)", "Edwards Broz", 226), 3), 0);
});

test("real-world good matches still pass", () => {
  const o = (title: string, artist: string, sec: number): MatchInput => ({ title, artist, uploader: artist, durationMs: sec * 1000 });
  const c = (title: string, uploader: string, sec: number): Candidate => ({ id: 9, title, artist: "", uploader, durationMs: sec * 1000, plays: 100 });
  assert.ok(matchScore(o("Клетка", "Molchat Doma", 284), c("клетка", "Molchat Doma", 284), 3) > 0);
  assert.ok(matchScore(o("NOKIA", "Drake", 241), c("PARTYNEXTDOOR___DRAKE_-_NOKIA", "PartyNextDoor_Drake Music", 241), 3) > 0);
  assert.ok(matchScore(o("Quebec", "Drake", 130), c("Drake - FOMO “Quebec” FULL SONG HQ", "Unghetto (@Unghetto)", 133), 3) > 0);
  assert.ok(matchScore(o("CHIHIRO", "Billie Eilish", 303), c("CHIHIRO", "Billie Eilish Netherlands", 305), 3) > 0);
});

test("main artist of a credit list", () => {
  assert.equal(primaryArtist("Drake, Don Toliver, Yebba"), "Drake");
  assert.equal(primaryArtist("Future x Metro Boomin"), "Future");
  assert.equal(primaryArtist("Tyler, The Creator"), "Tyler");
});

test("queries: artist + title, then the title alone", () => {
  assert.deepEqual(searchQueries(original), ["paper moon midnight", "midnight"]);
});
