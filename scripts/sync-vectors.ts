/**
 * Writes server/api/test/vectors.json: the test vectors of sc player's account and sync crypto, the contract between
 * the PC app and the Android app (and the server's tests). Run: node scripts/sync-vectors.ts
 *
 * Argon2id comes from Node's own crypto (OpenSSL) and is checked against hash-wasm, the WASM build the app uses
 * (Electron has no Argon2): two implementations must agree byte for byte, or nothing is written.
 */
import { argon2Sync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { argon2id } from "hash-wasm";
import { cleanCode, codeKeys, docId, formatCode, KDF_V1, loginProblem, normalizeLogin, openDoc, passwordBytes, passwordKeys, sealDoc, unwrapDek, wrapDek, type Argon2 } from "../src/main/sync/crypto.ts";
import { between, capFor, mergeDocs, spread, type Doc } from "../src/main/sync/merge.ts";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const nodeArgon: Argon2 = async (pw, salt, k) => argon2Sync("argon2id", { message: pw, nonce: salt, parallelism: k.p, tagLength: k.len, memory: k.m, passes: k.t });
const wasmArgon: Argon2 = async (pw, salt, k) => argon2id({ password: pw, salt, parallelism: k.p, iterations: k.t, memorySize: k.m, hashLength: k.len, outputType: "binary" });

const codes = ["7K2M-9QXR-4D8V-HTZC-B3NW-61JE-PF5S-GA0Y", "7k2m 9qxr 4d8v htzc b3nw 61je pf5s ga0y", "OIL0-1234-5678-9ABC-DEFG-HJKM-NPQR-STVW"].map((typed) => {
  const clean = cleanCode(typed)!;
  const k = codeKeys(clean);
  return { typed, clean, formatted: formatCode(clean), vaultId: k.vaultId, writeToken: k.writeToken, dek: hex(k.dek) };
});

const salt = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
const passwords = [];
for (const password of ["correct horse battery staple", "пароль Ёжик 2026 ✓", "ｓｃ ｐｌａｙｅｒ ①② ﬁ"]) {
  const bytes = passwordBytes(password);
  const master = await nodeArgon(bytes, salt, KDF_V1);
  if (hex(master) !== hex(await wasmArgon(bytes, salt, KDF_V1))) throw new Error(`argon2 implementations disagree on ${password}`);
  const { authKey, kek } = await passwordKeys(password, salt, KDF_V1, wasmArgon);
  passwords.push({ password, nfkcUtf8: hex(bytes), salt: hex(salt), master: hex(master), authKey: hex(authKey), kek: hex(kek) });
}

const vault = codes[0]!;
const kek = Buffer.from(passwords[0]!.kek, "hex");
const dek = Buffer.from(vault.dek, "hex");
const wrapNonce = Buffer.from("a0a1a2a3a4a5a6a7a8a9aaab", "hex");
const wrapped = wrapDek(kek, dek, vault.vaultId, wrapNonce);
if (hex(unwrapDek(kek, wrapped, vault.vaultId)!) !== vault.dek) throw new Error("wrap does not round-trip");

const names = ["likes", "pl:local-0123456789abcdef", "lyrics:a", "secrets"];
const docIds = Object.fromEntries(names.map((n) => [n, docId(dek, n)]));

const likes: Doc = { v: 1, kind: "likes", name: "likes", rev: 3, by: "k3f9q2", tracks: { "123456": { on: true, at: 1762345678901003, by: "k3f9q2" }, "777": { on: false, at: 1762345678902000, by: "p7x1aa" } }, hidden: {}, lists: {}, hiddenLists: {} };
const json = JSON.stringify(likes);
const docNonce = Buffer.from("b0b1b2b3b4b5b6b7b8b9babb", "hex");
const id = docIds.likes!;
const plain = sealDoc(dek, vault.vaultId, id, json, { compress: false, nonce: docNonce });
const packed = sealDoc(dek, vault.vaultId, id, json, { compress: true, nonce: docNonce });
for (const s of [plain, packed]) if (openDoc(dek, vault.vaultId, id, s) !== json) throw new Error("document does not round-trip");

// merge scenarios: the result must not depend on the order (a+b = b+a)
const pl = (items: Doc["items"], extra: Partial<Doc> = {}): Doc => ({ v: 1, kind: "playlist", name: "pl:local-0123456789abcdef", rev: 1, by: "a", id: "local-0123456789abcdef", created: 1762300000000, items, ...extra });
const scenarios: { name: string; a: Doc; b: Doc; cap?: { serverMs: number } }[] = [
  {
    name: "like here, un-like there later: the later wins",
    a: { ...likes, tracks: { "1": { on: true, at: 1000_000, by: "aaaaaa" } } },
    b: { ...likes, tracks: { "1": { on: false, at: 2000_000, by: "bbbbbb" } } },
  },
  {
    name: "same time: the bigger device tag wins",
    a: { ...likes, tracks: { "1": { on: true, at: 1000_000, by: "aaaaaa" } } },
    b: { ...likes, tracks: { "1": { on: false, at: 1000_000, by: "bbbbbb" } } },
  },
  {
    name: "removed on one device, moved on another: stays removed, takes the new place",
    a: pl({ "5": { on: false, at: 3000_000, by: "aaaaaa", pos: "V", posAt: 1000_000, posBy: "aaaaaa" } }),
    b: pl({ "5": { on: true, at: 1000_000, by: "bbbbbb", durationMs: 1, artworkUrl: null, pos: "k", posAt: 4000_000, posBy: "bbbbbb" } }),
  },
  {
    name: "deleted playlist beats a later rename",
    a: pl({}, { deleted: { v: true, at: 1000_000, by: "aaaaaa" }, title: { v: "Ночь", at: 500_000, by: "aaaaaa" } }),
    b: pl({ "9": { on: true, at: 900_000, by: "bbbbbb", pos: "V", posAt: 900_000, posBy: "bbbbbb" } }, { deleted: { v: false, at: 1_000, by: "bbbbbb" }, title: { v: "День", at: 9000_000, by: "bbbbbb" } }),
  },
  {
    name: "a clock from the future counts as the server's time",
    a: { ...likes, tracks: { "1": { on: true, at: 4102444800000_000, by: "aaaaaa" } } },
    b: { ...likes, tracks: { "1": { on: false, at: 1762345678000_000, by: "bbbbbb" } } },
    cap: { serverMs: 1762345679000 },
  },
];
const merges = scenarios.map((s) => {
  const cap = s.cap ? capFor(s.cap.serverMs) : undefined;
  const ab = mergeDocs(s.a, s.b, cap);
  const ba = mergeDocs(s.b, s.a, cap);
  for (const f of ["tracks", "items", "title", "deleted"]) if (JSON.stringify(ab[f]) !== JSON.stringify(ba[f])) throw new Error(`merge not commutative: ${s.name}`);
  return { ...s, merged: ab };
});

const out = {
  about:
    "Test vectors for sc player accounts and sync (design spec §4, §8). Hex unless noted. Argon2id = RFC 9106 v0x13 (libsodium crypto_pwhash ALG_ARGON2ID13: opslimit = t, memlimit = m*1024). HKDF-SHA256 with an empty salt. Generated by scripts/sync-vectors.ts from the PC app's code; Argon2id checked against two implementations.",
  kdf: KDF_V1,
  codes,
  logins: ["Sky.Night", "  ab ", "admin", "_x1", "ночь"].map((typed) => ({ typed, normalized: normalizeLogin(typed), problem: loginProblem(normalizeLogin(typed)) || null })),
  passwords,
  wrap: { kekFrom: "passwords[0]", dekFrom: "codes[0]", vaultId: vault.vaultId, aad: `scp-wrap-v1:${vault.vaultId}`, nonce: hex(wrapNonce), wrappedKey: hex(wrapped) },
  docIds: { dekFrom: "codes[0]", hmacInput: "scp-doc:<name>, first 16 bytes", ids: docIds },
  documents: {
    dekFrom: "codes[0]",
    vaultId: vault.vaultId,
    docId: id,
    aad: `scp-doc-v1:${vault.vaultId}:${id}`,
    json,
    nonce: hex(docNonce),
    sealedPlain: hex(plain),
    sealedDeflated: hex(packed),
    note: "sealedPlain must match byte for byte. sealedDeflated may differ from your deflate (zlib builds differ): check that yours opens to `json` and that this one opens on your side.",
  },
  positions: { between: [[null, null], [null, "V"], ["V", null], ["V", "W"], ["V", "V1"], ["az", "b"]].map(([a, b]) => ({ a, b, result: between(a ?? null, b ?? null) })), spread5: spread(5) },
  merges,
};
writeFileSync(new URL("../server/api/test/vectors.json", import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
console.log("vectors written");
