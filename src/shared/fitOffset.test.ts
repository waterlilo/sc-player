import assert from "node:assert/strict";
import { test } from "node:test";
import { fitOffset } from "./fitOffset.ts";

test("one shift shared by most lines is found, despite lines placed wrong", () => {
  const source = [6, 9, 12, 15, 18, 21, 24, 27];
  const heard = [12, 15, 18.2, 21, 30, 31, 30, 33];
  assert.ok(Math.abs(fitOffset(source, heard)! - 6.04) < 0.01);
});

test("no shift shared by half the lines: nothing to move", () => {
  assert.equal(fitOffset([1, 2, 3, 4], [5, 10, 2, 30]), null);
  assert.equal(fitOffset([1, 2], [1]), null);
});

test("in place already: a shift of about zero", () => {
  assert.ok(Math.abs(fitOffset([1, 2, 3], [1.1, 1.9, 3.2])!) < 0.2);
});
