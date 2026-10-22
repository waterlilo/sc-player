import assert from "node:assert/strict";
import { test } from "node:test";
import { lineWeight, pin, roughLines, roughTimes } from "./roughSync.ts";

test("plain lyrics into lines with verse breaks", () => {
  const lines = roughLines("\nOne line\nTwo line\n\n\nThree\n");
  assert.deepEqual(lines, [
    { text: "One line", verse: false },
    { text: "Two line", verse: false },
    { text: "Three", verse: true },
  ]);
});

test("weights count syllables, Cyrillic too", () => {
  assert.equal(lineWeight({ text: "Я забираю тебя", verse: false }), 1 + 4 + 2 + 2);
  assert.ok(lineWeight({ text: "x", verse: true }) > lineWeight({ text: "x", verse: false }));
});

test("without pins the words fill the track between intro and outro, in order", () => {
  const lines = roughLines("a b c\nd e f\ng h i\nj k l");
  const t = roughTimes(lines, 200);
  assert.equal(t.length, 4);
  assert.ok(t[0]! >= 4 && t[0]! <= 15);
  assert.ok(t[3]! < 200 - 3);
  for (let i = 1; i < t.length; i++) assert.ok(t[i]! > t[i - 1]!);
  // equal lines get equal shares
  assert.ok(Math.abs(t[1]! - t[0]! - (t[2]! - t[1]!)) < 1e-9);
});

test("a pin moves its line and stretches the lines around it", () => {
  const lines = roughLines("a b c\nd e f\ng h i\nj k l\nm n o");
  const t = roughTimes(lines, 200, { 2: 120 });
  assert.equal(t[2], 120);
  assert.ok(t[1]! < 120 && t[3]! > 120);
  assert.ok(t[0]! < t[1]!);
});

test("a pin earlier than the usual intro starts the words earlier", () => {
  const lines = roughLines("a\nb\nc");
  const t = roughTimes(lines, 200, { 0: 1 });
  assert.equal(t[0], 1);
});

test("pinning drops the pins it contradicts", () => {
  assert.deepEqual(pin({ 1: 10, 3: 50, 5: 90 }, 4, 40), { 4: 40, 1: 10, 5: 90 });
  assert.deepEqual(pin({ 5: 30 }, 4, 40), { 4: 40 });
  assert.deepEqual(pin({ 1: 10, 5: 90 }, 3, 50), { 3: 50, 1: 10, 5: 90 });
});
