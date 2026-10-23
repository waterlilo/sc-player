import assert from "node:assert/strict";
import { test } from "node:test";
import { align, fillGaps, languageOf, longestWord, SAMPLE_RATE, trustworthy, unsungLines, type Model } from "./align.ts";

/**
 * A made-up song: every word is one token sung for 0.5 s, back to back from `start` (s), except the words of `missing`
 * lines, which the "model" doesn't hear (p ≈ 0) and squeezes against the window's end. It places what it hears exactly.
 */
function fakeModel(sung: string[], start: number, missing: Set<string> = new Set()): Model {
  const ids = new Map<string, number>();
  const timeOf = new Map<number, number>();
  let t = start;
  for (const w of sung) {
    if (!ids.has(w)) ids.set(w, ids.size + 1);
    if (!missing.has(w)) {
      timeOf.set(ids.get(w)!, t);
      t += 0.5;
    }
  }
  return {
    encode: (word) => [ids.get(word.trim())!],
    // the test song is shorter than one window, so window times are song times
    forward: async (_window, tokens) => {
      const starts = tokens.map((id) => Math.min(29.9, timeOf.get(id) ?? 29.9));
      return { starts, end: Math.min(29.9, starts.at(-1)! + 0.5), p: tokens.map((id) => (timeOf.has(id) ? 0.9 : 0.01)) };
    },
  };
}

test("lines that are barely heard while later ones are clearly heard are not sung here", () => {
  const lines = [
    { line: 0, p: 0.8, start: 1, unique: true },
    { line: 1, p: 0.02, start: 3, unique: true },
    { line: 2, p: 0.7, start: 5, unique: true },
  ];
  assert.deepEqual(unsungLines(lines, 30, false), [1]);
  // only heard at the very end of the window: maybe squeezed there, so nothing is decided
  assert.deepEqual(unsungLines([lines[0]!, lines[1]!, { ...lines[2]!, start: 27 }], 30, false), []);
  assert.deepEqual(unsungLines([lines[0]!, lines[1]!, { ...lines[2]!, start: 27 }], 30, true), [1]);
  // a chorus line is heard wherever it is sung: it proves nothing
  assert.deepEqual(unsungLines([lines[0]!, lines[1]!, { ...lines[2]!, unique: false }], 30, false), []);
});

test("a long first word is pulled to the voice", () => {
  assert.equal(longestWord(1), 1.05);
});

test("words land where the model hears them; unheard lines come back between their neighbours", async () => {
  const lines = ["a b c d", "e f g h", "x y z w", "i j k l"];
  const sung = lines.join(" ").split(" ");
  const audio = new Float32Array(25 * SAMPLE_RATE);
  const model = fakeModel(sung, 3, new Set(["x", "y", "z", "w"]));
  const a = await align(audio, lines, model);
  assert.deepEqual(
    a.lines.map((l) => l.text),
    lines,
  );
  assert.equal(a.lines[0]!.t, 3);
  assert.equal(a.lines[1]!.t, 5);
  // the unheard line fills the gap between "h" (ends at 7) and "i" (7): no time, but kept, in order
  assert.equal(a.lines[2]!.t, 7);
  assert.equal(a.lines[3]!.t, 7);
  assert.equal(a.coverage, 0.75);
  assert.equal(a.lines[0]!.words[0]!.text, "a ");
  assert.equal(a.lines[0]!.words[3]!.text, "d");
  assert.ok(trustworthy(a));
});

test("gaps are spread by words between the placed lines", () => {
  const line = (t: number, end: number, text: string) => ({ t, end, text, words: [{ t, end, text }] });
  const out = fillGaps(["one", "two words", "three", "four"], [line(1, 2, "one"), null, null, line(8, 9, "four")], 100);
  assert.deepEqual(
    out.map((l) => [l.text, l.t, l.end]),
    [
      ["one", 1, 2],
      ["two words", 2, 6],
      ["three", 6, 8],
      ["four", 8, 9],
    ],
  );
  assert.equal(out[1]!.words[1]!.text, "words");
});

test("the language from the letters of the words", () => {
  assert.equal(languageOf(["Моя бензопила уже идёт", "STRAVIT CHIKI"]), "ru");
  assert.equal(languageOf(["Я їду додому, і ти теж", "єдина"]), "uk");
  assert.equal(languageOf(["君の名前を呼ぶよ"]), "ja");
  assert.equal(languageOf(["사랑해 오늘도"]), "ko");
  // Latin letters: many languages, the sound decides
  assert.equal(languageOf(["My time is here"]), null);
});
