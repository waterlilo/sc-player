import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, net, utilityProcess, type UtilityProcess } from "electron";
import { fitOffset } from "@shared/fitOffset";
import type { LyricsSyncStatus, SyncRequest, SyncResult } from "@shared/types";
import { JsonFile } from "../store/json-file";
import { log } from "../system/log";
import { trustworthy } from "./align";
import { MODEL_BYTES, MODEL_FILES, MODEL_ID, modelUrl } from "./model-files";
import type { Job, Reply } from "./worker";

/**
 * Words matched to the song on this computer (Settings → Lyrics → Auto-sync): the model download (checked file by
 * file), the worker process (started for a job, closed after a minute without one) and the answers, kept per track
 * and per words so a song is done once. The page decodes the sound (it has Web Audio) and sends it here.
 */

/** bumped when the alignment changes: older answers are worked out again */
const ALIGN_VERSION = 5;
const IDLE_MS = 60_000;
const JOB_TIMEOUT_MS = 5 * 60_000;

const root = () => join(app.getPath("userData"), "models");
const fileOf = (path: string) => join(root(), MODEL_ID, path);

let downloading: { progress: number } | null = null;
let failed: string | null = null;
let busy = false;
let onStatus: (s: LyricsSyncStatus) => void = () => undefined;

export function onSyncStatus(fn: (s: LyricsSyncStatus) => void) {
  onStatus = fn;
}

const haveModel = () => MODEL_FILES.every((f) => existsSync(fileOf(f.path)) && statSync(fileOf(f.path)).size === f.size);

export function syncStatus(): LyricsSyncStatus {
  const model = downloading ? "downloading" : haveModel() ? "ready" : failed ? "error" : "missing";
  return { model, progress: downloading?.progress ?? 0, error: model === "error" ? failed! : "", sizeMb: Math.round(MODEL_BYTES / 1e6), busy };
}
const changed = () => onStatus(syncStatus());

/** Downloads what is missing, file by file, each checked against its SHA-256 before it takes its place. */
export function downloadModel(): LyricsSyncStatus {
  if (downloading || haveModel()) return syncStatus();
  downloading = { progress: 0 };
  failed = null;
  changed();
  void (async () => {
    let done = MODEL_FILES.filter((f) => existsSync(fileOf(f.path)) && statSync(fileOf(f.path)).size === f.size).reduce((n, f) => n + f.size, 0);
    let last = 0;
    for (const f of MODEL_FILES) {
      const target = fileOf(f.path);
      if (existsSync(target) && statSync(target).size === f.size) continue;
      mkdirSync(dirname(target), { recursive: true });
      const tmp = `${target}.part`;
      const res = await net.fetch(modelUrl(f.path), { signal: AbortSignal.timeout(10 * 60_000) });
      if (!res.ok || !res.body) throw new Error(`${f.path}: the server answered ${res.status}`);
      const hash = createHash("sha256");
      const out = createWriteStream(tmp);
      const reader = res.body.getReader();
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        hash.update(value);
        if (!out.write(value)) await new Promise((r) => out.once("drain", r));
        done += value.byteLength;
        downloading!.progress = done / MODEL_BYTES;
        if (Date.now() - last > 250) {
          last = Date.now();
          changed();
        }
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
      if (hash.digest("hex") !== f.sha256) {
        rmSync(tmp, { force: true });
        throw new Error(`${f.path}: the file is damaged (checksum)`);
      }
      renameSync(tmp, target);
    }
  })()
    .catch((err: unknown) => {
      failed = err instanceof Error ? err.message : String(err);
      log("main", `lyrics sync: model download: ${failed}`);
    })
    .finally(() => {
      downloading = null;
      changed();
    });
  return syncStatus();
}

export function deleteModel(): LyricsSyncStatus {
  if (!downloading) {
    stopWorker();
    rmSync(join(root(), MODEL_ID), { recursive: true, force: true });
  }
  return syncStatus();
}

// ---- the worker ------------------------------------------------------------------------------------------------------

let worker: UtilityProcess | null = null;
let idle: NodeJS.Timeout | null = null;
let nextId = 1;
const waiting = new Map<number, (r: Reply) => void>();

function stopWorker() {
  worker?.kill();
  worker = null;
}

function startWorker() {
  if (worker) return worker;
  const w = utilityProcess.fork(join(import.meta.dirname, "lyrics-worker.js"), [], { serviceName: "sc player lyrics sync" });
  w.on("message", (r: Reply) => waiting.get(r.id)?.(r));
  w.on("exit", (code) => {
    if (worker === w) worker = null;
    for (const [id, resolve] of waiting) resolve({ id, ok: false, error: `the worker stopped (${code})` });
    waiting.clear();
  });
  return (worker = w);
}

function runJob(pcm: Float32Array, lines: string[], times?: number[]): Promise<Reply> {
  if (idle) clearTimeout(idle);
  const id = nextId++;
  const w = startWorker();
  return new Promise<Reply>((resolve) => {
    const timer = setTimeout(() => {
      // stuck: start over next time
      stopWorker();
      resolve({ id, ok: false, error: "took too long" });
    }, JOB_TIMEOUT_MS);
    waiting.set(id, (r) => {
      clearTimeout(timer);
      waiting.delete(id);
      resolve(r);
    });
    w.postMessage({ id, root: root(), pcm, lines, ...(times ? { times } : {}) } satisfies Job);
  }).finally(() => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(stopWorker, IDLE_MS);
  });
}

// ---- answers -----------------------------------------------------------------------------------------------------

type Saved = { result: SyncResult | null; at: number };
let saved: JsonFile<{ byKey: Record<string, Saved> }> | null = null;
const savedFile = () => (saved ??= new JsonFile<{ byKey: Record<string, Saved> }>(join(app.getPath("userData"), "lyrics-sync.json"), { byKey: {} }, 1000));

/** The lines of plain words, as the page shows them: one per non-empty line. */
export const plainLines = (plain: string) =>
  plain
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

const keyOf = (q: SyncRequest) => `${ALIGN_VERSION}:${q.trackId}:${q.source}:${q.lyricsId}:${q.times ? "check:" : ""}${createHash("sha1").update(q.plain).digest("hex").slice(0, 12)}`;

/** A song already worked out: its lines or its shift, null when the words didn't fit the song; undefined when not yet. */
export function syncedBefore(q: SyncRequest): SyncResult | null | undefined {
  return savedFile().get().byKey[keyOf(q)]?.result;
}

// one song at a time; the others wait their turn
let queue: Promise<unknown> = Promise.resolve();

/**
 * Plain words: placed in the song (their lines). A source's synced lines (`times`): checked at a few places, and the
 * shift most of them share (shared/fitOffset), or 0 when they agree on none — they are then left as they are.
 */
export function syncWords(q: SyncRequest, pcm: Float32Array): Promise<SyncResult | null> {
  const key = keyOf(q);
  const job = queue.then(async () => {
    const before = savedFile().get().byKey[key];
    if (before) return before.result;
    if (!haveModel()) throw new Error("the model isn't downloaded");
    busy = true;
    changed();
    try {
      const lines = plainLines(q.plain);
      const times = q.times?.length === lines.length ? q.times : undefined;
      const r = await runJob(pcm, lines, times);
      if (!r.ok) throw new Error(r.error);
      let result: SyncResult | null;
      if (times) {
        const heard = r.heard ?? [];
        const shift = heard.length >= 3 ? fitOffset(heard.map((h) => h.source), heard.map((h) => h.heard)) : null;
        log("main", `lyrics sync: track ${q.trackId}, ${r.language}, ${(r.ms / 1000).toFixed(1)} s, checked the source's timing: ${heard.length} lines heard, shift ${shift === null ? "none" : shift.toFixed(1)}`);
        result = { shift: shift ?? 0 };
      } else {
        const a = r.alignment!;
        const ok = trustworthy(a);
        log("main", `lyrics sync: track ${q.trackId}, ${r.language}, ${(r.ms / 1000).toFixed(1)} s, ${a.lines.length} lines, confidence ${a.confidence.toFixed(2)}, coverage ${a.coverage.toFixed(2)}${ok ? "" : " — not used"}`);
        result = ok ? { lines: a.lines } : null;
      }
      const all = { ...savedFile().get().byKey, [key]: { result, at: Date.now() } };
      // the newest 500 songs
      const keys = Object.keys(all).sort((a, b) => all[a]!.at - all[b]!.at);
      for (const old of keys.slice(0, Math.max(0, keys.length - 500))) delete all[old];
      savedFile().patch({ byKey: all });
      return result;
    } finally {
      busy = false;
      changed();
    }
  });
  queue = job.catch(() => undefined);
  return job;
}

export function flushLyricsSync() {
  saved?.flush();
  stopWorker();
}
