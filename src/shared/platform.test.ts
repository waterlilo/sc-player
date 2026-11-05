import test from "node:test";
import assert from "node:assert/strict";
import { isMac } from "./platform.ts";

test("isMac correctly identifies darwin platform", () => {
  assert.equal(isMac("darwin"), true);
  assert.equal(isMac("win32"), false);
  assert.equal(isMac("linux"), false);
});
