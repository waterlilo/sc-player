import assert from "node:assert/strict";
import { test } from "node:test";
import { playlistParts } from "./playlist-parts.ts";

const items = (n: number, from = 1) => Array.from({ length: n }, (_, i) => ({ id: from + i }));

test("up to a playlist's size: one part, the title as it is", () => {
  const parts = playlistParts("Mix", items(500), 500);
  assert.equal(parts.length, 1);
  assert.equal(parts[0]!.title, "Mix");
  assert.equal(parts[0]!.items.length, 500);
});

test("longer: parts of 500 in order, numbered", () => {
  const parts = playlistParts("Mix", items(1201), 500);
  assert.deepEqual(
    parts.map((p) => [p.title, p.items.length, p.items[0]!.id]),
    [
      ["Mix (1/3)", 500, 1],
      ["Mix (2/3)", 500, 501],
      ["Mix (3/3)", 201, 1001],
    ],
  );
});

test("duplicates go before counting, the first kept", () => {
  const parts = playlistParts("Mix", [...items(3), { id: 2 }, ...items(2, 4)], 500);
  assert.deepEqual(parts[0]!.items.map((i) => i.id), [1, 2, 3, 4, 5]);
});

test("an empty list is one empty part; a long title still fits 100 with the suffix", () => {
  assert.deepEqual(playlistParts("Empty", [], 500), [{ title: "Empty", items: [] }]);
  const long = playlistParts("x".repeat(100), items(600), 500);
  assert.ok(long.every((p) => p.title.length <= 100));
});
