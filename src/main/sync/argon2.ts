import { argon2id } from "hash-wasm";
import type { Argon2 } from "./crypto";

/**
 * Argon2id for the app. Electron's crypto is BoringSSL, which has no Argon2 (`crypto.argon2Sync` throws there), so a
 * WASM build does it: hash-wasm, pinned in package-lock and checked against Node's own Argon2 by the test vectors.
 * 64 MiB and 3 passes take about half a second; the main process waits that long once per sign-in.
 */
export const argon2: Argon2 = (password, salt, kdf) => argon2id({ password, salt, parallelism: kdf.p, iterations: kdf.t, memorySize: kdf.m, hashLength: kdf.len, outputType: "binary" });
