import assert from "node:assert/strict";
import { argon2Sync } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { argon2id } from "hash-wasm";
import { cleanCode, codeKeys, docId, KDF_V1, loginProblem, normalizeLogin, openDoc, passwordBytes, passwordKeys, sealDoc, unwrapDek, wrapDek, checkKdf, type Argon2 } from "./crypto.ts";
import { likesChanges, likesFrom, playlistChanges, playlistFrom, lyricsChanges, lyricsFrom, emptyDoc } from "./docs.ts";
import { between, capFor, Clock, mergeDocs, orderOf, placeOrder, spread, type Map } from "./merge.ts";

const V = JSON.parse(readFileSync(new URL("../../../server/api/test/vectors.json", import.meta.url), "utf8"));
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const wasm: Argon2 = async (pw, salt, k) => argon2id({ password: pw, salt, parallelism: k.p, iterations: k.t, memorySize: k.m, hashLength: k.len, outputType: "binary" });
const native: Argon2 = async (pw, salt, k) => argon2Sync("argon2id", { message: pw, nonce: salt, parallelism: k.p, tagLength: k.len, memory: k.m, passes: k.t });

test("recovery codes: cleaning and derivations match the vectors", () => {
  for (const c of V.codes) {
    assert.equal(cleanCode(c.typed), c.clean);
    const k = codeKeys(c.clean);
    assert.deepEqual([k.vaultId, k.writeToken, hex(k.dek)], [c.vaultId, c.writeToken, c.dek]);
  }
  assert.equal(cleanCode("UUUU-0000-0000-0000-0000-0000-0000-0000"), null);
  assert.equal(cleanCode("1234"), null);
});

test("logins", () => {
  for (const l of V.logins) {
    assert.equal(normalizeLogin(l.typed), l.normalized);
    assert.equal(loginProblem(l.normalized) || null, l.problem);
  }
});

test("passwords: the app's Argon2id (WASM) and Node's agree with the vectors", async () => {
  for (const p of V.passwords) {
    const salt = Buffer.from(p.salt, "hex");
    assert.equal(hex(passwordBytes(p.password)), p.nfkcUtf8);
    for (const impl of [wasm, native]) {
      const k = await passwordKeys(p.password, salt, KDF_V1, impl);
      assert.deepEqual([hex(k.authKey), hex(k.kek)], [p.authKey, p.kek]);
    }
  }
});

test("a server's weak parameters are refused", () => {
  assert.throws(() => checkKdf({ ...KDF_V1, m: 1024 }));
  assert.throws(() => checkKdf({ ...KDF_V1, t: 1 }));
  assert.throws(() => checkKdf({ ...KDF_V1, alg: "scrypt" }));
});

test("wrapping and documents match the vectors", () => {
  const w = V.wrap;
  const kek = Buffer.from(V.passwords[0].kek, "hex");
  const dek = Buffer.from(V.codes[0].dek, "hex");
  assert.equal(hex(wrapDek(kek, dek, w.vaultId, Buffer.from(w.nonce, "hex"))), w.wrappedKey);
  assert.equal(hex(unwrapDek(kek, Buffer.from(w.wrappedKey, "hex"), w.vaultId)!), V.codes[0].dek);
  assert.equal(unwrapDek(Buffer.alloc(32), Buffer.from(w.wrappedKey, "hex"), w.vaultId), null);
  for (const [name, id] of Object.entries(V.docIds.ids)) assert.equal(docId(dek, name), id);
  const d = V.documents;
  assert.equal(hex(sealDoc(dek, d.vaultId, d.docId, d.json, { compress: false, nonce: Buffer.from(d.nonce, "hex") })), d.sealedPlain);
  assert.equal(openDoc(dek, d.vaultId, d.docId, Buffer.from(d.sealedDeflated, "hex")), d.json);
  // sealed for another document: refused
  assert.throws(() => openDoc(dek, d.vaultId, "0".repeat(32), Buffer.from(d.sealedPlain, "hex")));
});

test("positions and merges match the vectors, in either order", () => {
  for (const b of V.positions.between) assert.equal(between(b.a, b.b), b.result);
  assert.deepEqual(spread(5), V.positions.spread5);
  for (const m of V.merges) {
    const cap = m.cap ? capFor(m.cap.serverMs) : undefined;
    assert.deepEqual(mergeDocs(m.a, m.b, cap).tracks ?? null, m.merged.tracks ?? null, m.name);
    assert.deepEqual(mergeDocs(m.b, m.a, cap).items ?? null, m.merged.items ?? null, m.name);
    assert.deepEqual(mergeDocs(m.b, m.a, cap).deleted ?? null, m.merged.deleted ?? null, m.name);
  }
});

const clockOf = (by: string, start: number) => {
  const c = new Clock(start);
  return () => ({ at: c.now(), by });
};

test("likes: liked on one computer, un-liked on the other, both converge", () => {
  const a = clockOf("aaaaaa", 0);
  const b = clockOf("bbbbbb", 0);
  // A likes 1 and 2 first; its first sync keeps the times they were liked
  const docA = mergeDocs(emptyDoc("likes", "likes"), likesChanges({ liked: [{ id: 1, at: 1000 }, { id: 2, at: 2000 }], hidden: [] }, null, a, true));
  assert.deepEqual(likesFrom(docA).liked.map((l) => l.id), [1, 2]);
  // B joins with 3, then un-likes 1
  const docB = mergeDocs(docA, likesChanges({ liked: [{ id: 3, at: 3000 }], hidden: [] }, null, b, true));
  assert.deepEqual(likesFrom(docB).liked.map((l) => l.id), [1, 2, 3]);
  const docB2 = mergeDocs(docB, likesChanges({ liked: [{ id: 2, at: 2000 }, { id: 3, at: 3000 }], hidden: [] }, docB, b, false));
  // A, which saw docA last, likes 4 meanwhile: its change goes over the server's newer document
  const docA2 = mergeDocs(docB2, likesChanges({ liked: [{ id: 1, at: 1000 }, { id: 2, at: 2000 }, { id: 4, at: Date.now() }], hidden: [] }, docA, a, false));
  assert.deepEqual(likesFrom(docA2).liked.map((l) => l.id).sort(), [2, 3, 4]);
});

test("a first sync never removes, but a newer removal from elsewhere wins", () => {
  const a = clockOf("aaaaaa", 0);
  const server = mergeDocs(emptyDoc("likes", "likes"), { ...emptyDoc("likes", "likes"), tracks: { "7": { on: false, at: 5000_000, by: "zzzzzz" } } });
  const joined = mergeDocs(server, likesChanges({ liked: [{ id: 7, at: 1000 }, { id: 8, at: 1000 }], hidden: [] }, null, a, true));
  assert.deepEqual(likesFrom(joined).liked.map((l) => l.id), [8]);
});

test("playlists: order, removal against a move, deletion", () => {
  const a = clockOf("aaaaaa", 0);
  const b = clockOf("bbbbbb", 0);
  const item = (id: number) => ({ id, durationMs: 1000, artworkUrl: null });
  const list = { id: "local-0123456789abcdef", title: "Ночь", items: [1, 2, 3, 4].map(item), created: 1000 };
  const s0 = mergeDocs(emptyDoc("playlist", "pl:local-0123456789abcdef"), playlistChanges(list, null, a, true)!);
  assert.deepEqual(playlistFrom(s0)!.items.map((i) => i.id), [1, 2, 3, 4]);
  // A moves 4 to the top: only 4 gets a new position
  const moveA = playlistChanges({ ...list, items: [4, 1, 2, 3].map(item) }, s0, a, false)!;
  assert.deepEqual(Object.keys(moveA.items as Map).filter((k) => (moveA.items as Map)[k]!.posBy === "aaaaaa" && Number((moveA.items as Map)[k]!.posAt) > 1000_000), ["4"]);
  // B, at the same time, takes 4 out and renames
  const removeB = playlistChanges({ ...list, title: "День", items: [1, 2, 3].map(item) }, s0, b, false)!;
  const ab = mergeDocs(mergeDocs(s0, moveA), removeB);
  const ba = mergeDocs(mergeDocs(s0, removeB), moveA);
  assert.deepEqual(playlistFrom(ab), playlistFrom(ba));
  assert.deepEqual(playlistFrom(ab)!.items.map((i) => i.id), [1, 2, 3]);
  assert.equal(playlistFrom(ab)!.title, "День");
  // deleted on A: gone everywhere, an edit elsewhere doesn't bring it back
  const del = playlistChanges(null, ab, a, false)!;
  const edit = playlistChanges({ ...list, items: [3, 2, 1].map(item) }, ab, b, false)!;
  assert.equal(playlistFrom(mergeDocs(mergeDocs(ab, edit), del)), null);
  assert.equal(playlistFrom(mergeDocs(mergeDocs(ab, del), edit)), null);
});

test("reordering a long list keeps positions short", () => {
  const a = clockOf("aaaaaa", 0);
  let ids = Array.from({ length: 50 }, (_, i) => String(i + 1));
  let items: Map = Object.fromEntries(ids.map((k, i) => [k, { on: true, at: 1, by: "a", pos: spread(50)[i], posAt: 1, posBy: "a" }]));
  // move the last track to the second place 200 times: the keys would grow without a renumbering
  for (let n = 0; n < 200; n++) {
    ids = [ids[0]!, ids[ids.length - 1]!, ...ids.slice(1, -1)];
    const pos = placeOrder(ids, items);
    for (const [k, p] of Object.entries(pos)) items = { ...items, [k]: { ...items[k]!, pos: p, ...a() } };
    assert.deepEqual(orderOf(items), ids);
  }
  assert.ok(Object.values(items).every((e) => String(e.pos).length <= 16));
});

test("own lyrics: the later edit wins, a removal is a tombstone", () => {
  const a = clockOf("aaaaaa", 0);
  const s0 = mergeDocs(emptyDoc("lyrics", "lyrics:5"), lyricsChanges({ "21": { text: "[00:01] a\n[00:02] b", at: 1000 } }, "5", null, a, true));
  assert.equal(lyricsFrom(s0)["21"]!.text, "[00:01] a\n[00:02] b");
  const gone = mergeDocs(s0, lyricsChanges({}, "5", s0, a, false));
  assert.deepEqual(lyricsFrom(gone), {});
  assert.equal((gone.byTrack as Map)["21"]!.text, null);
});
