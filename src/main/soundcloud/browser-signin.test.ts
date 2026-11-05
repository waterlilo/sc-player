import test from "node:test";
import assert from "node:assert/strict";
import { parseTokenFromArgs, parseFriendFromArgs } from "./browser-signin-url.ts";

test("parseTokenFromArgs extracts clean token from scplayer://signin URL", () => {
  const url = "scplayer://signin?token=2-123456-7890abcdef";
  assert.equal(parseTokenFromArgs([url]), "2-123456-7890abcdef");
});

test("parseTokenFromArgs handles trailing slash in path", () => {
  const url = "scplayer://signin/?token=2-123456-7890abcdef";
  assert.equal(parseTokenFromArgs([url]), "2-123456-7890abcdef");
});

test("parseTokenFromArgs decodes percent-encoded token", () => {
  const raw = "2-123456-7890abcdef";
  const url = `scplayer://signin?token=${encodeURIComponent(raw)}`;
  assert.equal(parseTokenFromArgs([url]), raw);
});

test("parseTokenFromArgs removes quotes around cookie value", () => {
  const url = 'scplayer://signin?token="2-123456-7890abcdef"';
  assert.equal(parseTokenFromArgs([url]), "2-123456-7890abcdef");
});

test("parseTokenFromArgs returns null for invalid or missing URLs", () => {
  assert.equal(parseTokenFromArgs([]), null);
  assert.equal(parseTokenFromArgs(["https://soundcloud.com"]), null);
  assert.equal(parseTokenFromArgs(["scplayer://signin"]), null);
  assert.equal(parseTokenFromArgs(["scplayer://signin?token=short"]), null);
  assert.equal(parseTokenFromArgs(["scplayer://signin?token=bad token with spaces"]), null);
});

test("parseFriendFromArgs extracts valid friend code", () => {
  assert.equal(parseFriendFromArgs(["scplayer://friend/SKY-23456"]), "SKY-23456");
  assert.equal(parseFriendFromArgs(["scplayer://friend/sky-23456/"]), "SKY-23456");
});

test("parseFriendFromArgs rejects invalid friend codes", () => {
  assert.equal(parseFriendFromArgs([]), null);
  assert.equal(parseFriendFromArgs(["scplayer://friend/"]), null);
  assert.equal(parseFriendFromArgs(["scplayer://friend/INVALID"]), null);
  assert.equal(parseFriendFromArgs(["scplayer://friend/SKY-10000"]), null); // '0' and '1' are excluded
});
