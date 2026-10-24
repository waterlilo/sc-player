import assert from "node:assert/strict";
import { test } from "node:test";
import { withPrefDefaults, type Prefs } from "./ipc.ts";

const proxy = (p: Partial<Prefs["proxy"]>) => withPrefDefaults({ proxy: { mode: "system", url: "", username: "", ...p } }).proxy;

test("proxy: a new install starts on auto", () => {
  assert.equal(withPrefDefaults(undefined).proxy.mode, "auto");
});

test("proxy: the old default (system) moves to auto once", () => {
  assert.deepEqual(proxy({ mode: "system" }), { mode: "auto", url: "", username: "", v: 2 });
  // picked again after the move: stays
  assert.equal(proxy({ mode: "system", v: 2 }).mode, "system");
});

test("proxy: other choices stay as they were", () => {
  assert.equal(proxy({ mode: "custom", url: "socks5://127.0.0.1:1080" }).mode, "custom");
  assert.equal(proxy({ mode: "direct" }).mode, "direct");
  assert.equal(proxy({ mode: "builtin" }).mode, "builtin");
});
