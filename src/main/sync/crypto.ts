import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * The keys and the sealing of sc player accounts and sync (design: "sc player — аккаунты и синхронизация", §4). Pure
 * Node crypto with no Electron in it, so the tests and the test vectors (server/api/test/vectors.json) run on this very
 * code. Argon2id is passed in: Electron's BoringSSL has none (main/sync/argon2 brings a WASM one), Node 24 has it.
 *
 * Two independent ways lead to the data key (DEK): the recovery code (it is today's transfer key, and the DEK is
 * exactly the backup's encryption key, so nothing gets re-encrypted) and the password, which only unwraps the DEK.
 */

/** Argon2id parameters, as the server keeps them for an account and hands them out on prelogin. */
export interface Kdf {
  alg: "argon2id";
  /** 0x13: the only version of Argon2 in use */
  ver: 19;
  /** memory in KiB (libsodium's memlimit is this × 1024 bytes) */
  m: number;
  /** passes (libsodium's opslimit) */
  t: number;
  /** lanes: always 1 (all libsodium can do) */
  p: 1;
  len: 32;
}

/** v1: 64 MiB, 3 passes. */
export const KDF_V1: Kdf = { alg: "argon2id", ver: 19, m: 65536, t: 3, p: 1, len: 32 };

/** Argon2id(password, salt) with these parameters: hash-wasm in the app, node:crypto in tests. */
export type Argon2 = (password: Uint8Array, salt: Uint8Array, kdf: Kdf) => Promise<Uint8Array>;

/**
 * Parameters a client may use. A server that hands out weaker ones (to make guessing a stolen database easier) is
 * refused: below OWASP's floor of 19 MiB and 2 passes nothing is derived.
 */
export function checkKdf(v: unknown): Kdf {
  const k = v as Partial<Kdf> | null;
  if (!k || k.alg !== "argon2id" || k.ver !== 19 || k.p !== 1 || k.len !== 32) throw new Error("unknown key parameters");
  if (!Number.isInteger(k.m) || !Number.isInteger(k.t) || k.m! < 19456 || k.t! < 2 || k.m! > 1048576 || k.t! > 10) throw new Error("unsafe key parameters");
  return { alg: "argon2id", ver: 19, m: k.m!, t: k.t!, p: 1, len: 32 };
}

// ---- the recovery code (= the transfer key) ------------------------------------------------------------------------

/** Crockford's base32: no I, L, O, U. */
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A code as typed, cleaned: upper case, only letters and digits, with Crockford's look-alikes read as they were meant
 * (O → 0, I and L → 1). Null when it can't be a code: not 32 characters, or a U (never in a code). Codes made so far
 * never hold those letters, so every existing transfer key cleans to what it always did.
 */
export function cleanCode(typed: string): string | null {
  const s = typed.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return s.length === 32 && !s.includes("U") ? s : null;
}

/** A new code: 32 random bytes, 5 bits of each (256 is a multiple of 32, so every character is equally likely). */
export function newCode(): string {
  let out = "";
  for (const b of randomBytes(32)) out += CODE_ALPHABET[b & 31];
  return out;
}

/** XXXX-XXXX-… for showing and saving. */
export const formatCode = (clean: string) => clean.match(/.{1,4}/g)!.join("-");

const labelled = (clean: string, label: string) => createHash("sha256").update(`scp-backup-${label}:${clean}`, "utf8").digest();

/** What a (clean) code leads to: the vault's name, the proof of holding the code, and the data key. */
export function codeKeys(clean: string): { vaultId: string; writeToken: string; dek: Buffer } {
  return { vaultId: labelled(clean, "id").toString("hex"), writeToken: labelled(clean, "write").toString("hex"), dek: labelled(clean, "enc") };
}

// ---- login and password --------------------------------------------------------------------------------------------

export const RESERVED_LOGINS = new Set(["admin", "root", "support", "moderator", "sc", "scplayer", "sky", "system", "api"]);

/** A login as stored: lower case, spaces around it gone. */
export const normalizeLogin = (s: string) => s.trim().toLowerCase();

/** Why a login can't be used, or "" when it can. */
export function loginProblem(login: string): "" | "length" | "chars" | "reserved" {
  if (login.length < 3 || login.length > 32) return "length";
  if (!/^[a-z0-9][a-z0-9_.-]*$/.test(login)) return "chars";
  if (RESERVED_LOGINS.has(login)) return "reserved";
  return "";
}

/** A password's bytes: Unicode NFKC, then UTF-8. Spaces stay (a space is a fine character). */
export const passwordBytes = (pw: string) => Buffer.from(pw.normalize("NFKC"), "utf8");

/** The two keys one password gives: `authKey` goes to the server (which keeps only its HMAC), `kek` never leaves. */
export async function passwordKeys(password: string, salt: Uint8Array, kdf: Kdf, argon2: Argon2): Promise<{ authKey: Buffer; kek: Buffer }> {
  if (salt.length !== 16) throw new Error("salt must be 16 bytes");
  const master = Buffer.from(await argon2(passwordBytes(password), salt, checkKdf(kdf)));
  const hkdf = (info: string) => Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), Buffer.from(info, "utf8"), 32));
  const keys = { authKey: hkdf("sc player/v1/auth"), kek: hkdf("sc player/v1/kek") };
  master.fill(0);
  return keys;
}

// ---- wrapping the data key -----------------------------------------------------------------------------------------

/** nonce(12) | AES-256-GCM(KEK, DEK, aad = "scp-wrap-v1:" + vaultId) | tag(16): 60 bytes, kept on the server. */
export function wrapDek(kek: Uint8Array, dek: Uint8Array, vaultId: string, nonce: Uint8Array = randomBytes(12)): Buffer {
  const c = createCipheriv("aes-256-gcm", kek, nonce);
  c.setAAD(Buffer.from(`scp-wrap-v1:${vaultId}`, "utf8"));
  return Buffer.concat([nonce, c.update(dek), c.final(), c.getAuthTag()]);
}

/** The DEK back, or null when the tag doesn't match: that is how a wrong password shows. */
export function unwrapDek(kek: Uint8Array, wrapped: Uint8Array, vaultId: string): Buffer | null {
  if (wrapped.length !== 60) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", kek, wrapped.subarray(0, 12));
    d.setAAD(Buffer.from(`scp-wrap-v1:${vaultId}`, "utf8"));
    d.setAuthTag(wrapped.subarray(44));
    return Buffer.concat([d.update(wrapped.subarray(12, 44)), d.final()]);
  } catch {
    return null;
  }
}

// ---- documents -----------------------------------------------------------------------------------------------------

/** A document's name on the server: an HMAC of its real name, so the server can't tell likes from a playlist. */
export const docId = (dek: Uint8Array, name: string) => createHmac("sha256", dek).update(`scp-doc:${name}`, "utf8").digest("hex").slice(0, 32);

const docAad = (vaultId: string, id: string) => Buffer.from(`scp-doc-v1:${vaultId}:${id}`, "utf8");

/**
 * "SCS1" | flags(1) | nonce(12) | AES-256-GCM(DEK, JSON) | tag(16). Flag bit 0: the JSON was deflated (raw, RFC 1951)
 * first. The AAD names the vault and the document, so the server can't swap one document for another.
 */
export function sealDoc(dek: Uint8Array, vaultId: string, id: string, json: string, opts: { compress: boolean; nonce?: Uint8Array }): Buffer {
  const plain = Buffer.from(json, "utf8");
  const body = opts.compress ? deflateRawSync(plain) : plain;
  const nonce = opts.nonce ?? randomBytes(12);
  const c = createCipheriv("aes-256-gcm", dek, nonce);
  c.setAAD(docAad(vaultId, id));
  return Buffer.concat([Buffer.from("SCS1"), Buffer.from([opts.compress ? 1 : 0]), nonce, c.update(body), c.final(), c.getAuthTag()]);
}

/** The JSON text of a sealed document; throws when it isn't one, or wasn't sealed for this vault and name. */
export function openDoc(dek: Uint8Array, vaultId: string, id: string, data: Uint8Array): string {
  const b = Buffer.from(data);
  if (b.length < 33 || b.subarray(0, 4).toString("latin1") !== "SCS1") throw new Error("not a sync document");
  const flags = b[4]!;
  if (flags & ~1) throw new Error("unknown document flags");
  const d = createDecipheriv("aes-256-gcm", dek, b.subarray(5, 17));
  d.setAAD(docAad(vaultId, id));
  d.setAuthTag(b.subarray(b.length - 16));
  const body = Buffer.concat([d.update(b.subarray(17, b.length - 16)), d.final()]);
  return (flags & 1 ? inflateRawSync(body, { maxOutputLength: 32 * 1024 * 1024 }) : body).toString("utf8");
}
