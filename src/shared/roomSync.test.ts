import assert from "node:assert/strict";
import { test } from "node:test";
import { correction, roomPosition, SEEK_LEAD, SETTLING_FAR } from "./roomSync.ts";

test("the room's place moves on with the server's clock while playing, stays while paused", () => {
  assert.equal(roomPosition({ position: 10, at: 1000, playing: true }, 4000), 13);
  assert.equal(roomPosition({ position: 10, at: 1000, playing: false }, 4000), 10);
});

test("close enough: nothing to do", () => {
  assert.deepEqual(correction(30.05, 30), { rate: 1 });
});

test("a little behind: faster for a while, a little ahead: slower — within 5%", () => {
  assert.ok(correction(29.7, 30).rate > 1);
  assert.ok(correction(30.3, 30).rate < 1);
  assert.equal(correction(29, 30).rate, 1.05);
  assert.equal(correction(31, 30).rate, 0.95);
});

test("settling in (just loaded or resumed): a smaller gap is closed with a seek", () => {
  assert.equal(correction(29.2, 30).seek, undefined);
  assert.deepEqual(correction(29.2, 30, SETTLING_FAR), { seek: 30 + SEEK_LEAD, rate: 1 });
});

test("far off: a seek, a little ahead of the room", () => {
  assert.deepEqual(correction(20, 30), { seek: 30 + SEEK_LEAD, rate: 1 });
  assert.deepEqual(correction(40, 30), { seek: 30 + SEEK_LEAD, rate: 1 });
});
