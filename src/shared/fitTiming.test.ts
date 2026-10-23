import assert from "node:assert/strict";
import { test } from "node:test";
import { fitTiming, largestMove } from "./fitTiming.ts";

const near = (a: number, b: number, e = 0.05) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);

test("a longer intro: one shift shared by most lines, despite lines placed wrong", () => {
  const t = fitTiming([6, 9, 12, 15, 18, 21, 24, 27], [12, 15, 18.2, 21, 30, 31, 30, 33])!;
  assert.equal(t.scale, 1);
  near(t.shift, 6.04);
});

test("a slower upload: the lines stretch (\"skyline ryodan\", 3% slower)", () => {
  const t = fitTiming([30, 60.6, 97.9, 100.3, 104.9], [30.9, 62.3, 100.8, 103.4, 108.1])!;
  near(t.scale, 1.03, 0.01);
  near(t.scale * 30 + t.shift, 30.9, 0.6);
  near(t.scale * 104.9 + t.shift, 108.1, 0.6);
});

test("no line most agree with: nothing to move", () => {
  assert.equal(fitTiming([1, 20, 40, 60], [5, 10, 70, 30]), null);
  assert.equal(fitTiming([1, 2], [1, 2]), null);
});

test("how far the lines move", () => {
  near(largestMove({ scale: 1, shift: -0.3 }, 120), 0.3);
  near(largestMove({ scale: 1.03, shift: 0 }, 120), 3.6);
});
