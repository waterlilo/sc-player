import test from "node:test";
import assert from "node:assert/strict";
import { isPortableRelease } from "./updater-check.ts";

test("isPortableRelease returns true on macOS to avoid unsigned Squirrel errors", () => {
  assert.equal(isPortableRelease("darwin", false), true);
  assert.equal(isPortableRelease("darwin", true), true);
});

test("isPortableRelease on win32 depends on PORTABLE_EXECUTABLE_DIR", () => {
  assert.equal(isPortableRelease("win32", false), false);
  assert.equal(isPortableRelease("win32", true), true);
});

test("isPortableRelease on linux: an AppImage updates itself, a .deb is only told", () => {
  assert.equal(isPortableRelease("linux", false, true), false);
  assert.equal(isPortableRelease("linux", false, false), true);
});
