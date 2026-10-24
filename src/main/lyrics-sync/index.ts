import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, net, utilityProcess, type UtilityProcess } from "electron";
import { fitTiming } from "@shared/fitTiming";
import type { LyricsSyncStatus, SyncRequest, SyncResult } from "@shared/types";
import { prefs } from "../store";
import { JsonFile } from "../store/json-file";
import { log } from "../system/log";
import { trustworthy } from "./align";
import { MODELS, modelBytes, modelUrl, type ModelName } from "./model-files";
import type { Job, Reply } from "./worker";

/**
 * Words matched to the song on this computer (Settings → Lyrics → Auto-sync): the model download (checked file by
 * file), the worker process (started for a job, closed after a minute without one) and the answers, kept per track
 * and per words so a song is done once. The page decodes the sound (it has Web Audio) and sends it here.
 */

/** bumped when the alignment changes: older answers are worked out again */
const ALIGN_VERSION = 7;
/**
 * The worker holds 300–500 MB (Whisper and onnxruntime) while it lives, so it goes soon after its last job: a track's
 * words and the next one's are worked out back to back, then nothing until the next track starts. Starting it again
 * costs under a second.
 */
const IDLE_MS = 10_000;
const JOB_TIMEOUT_MS = 5 * 60_000;

const root = () => join(app.getPath("userData"), "models");
/** the model the settings ask for: small in the accurate mode */
const current = (): ModelName => (prefs().accurateSync ? "small" : "base");
const fileOf = (m: ModelName, path: string) => join(root(), MODELS[m].id, path);

let downloading: { model: ModelName; progress: number } | null = null;
let failed: string | null = null;
let busy = false;
let onStatus: (s: LyricsSyncStatus) => void = () => undefined;

export function onSyncStatus(fn: (s: LyricsSyncStatus) => void) {
  onStatus = fn;
}

const present = (m: ModelName, f: { path: string; size: number }) => existsSync(fileOf(m, f.path)) && statSync(fileOf(m, f.path)).size === f.size;
const haveModel = (m: ModelName) => MODELS[m].files.every((f) => present(m, f));

export function syncStatus(): LyricsSyncStatus {
  const name = current();
  const model = downloading?.model === name ? "downloading" : haveModel(name) ? "ready" : failed ? "error" : "missing";
  return { name, model, progress: downloading?.model === name ? downloading.progress : 0, error: model === "error" ? failed! : "", sizeMb: Math.round(modelBytes(name) / 1e6), busy };
}
const changed = () => onStatus(syncStatus());

/** Downloads what is missing of the model the settings ask for, file by file, each checked against its SHA-256. */
export function downloadModel(): LyricsSyncStatus {
  const m = current();
  if (downloading || haveModel(m)) return syncStatus();
  const total = modelBytes(m);
  downloading = { model: m, progress: 0 };
  failed = null;
  changed();
  void (async () => {
    let done = MODELS[m].files.filter((f) => present(m, f)).reduce((n, f) => n + f.size, 0);
    let last = 0;
    for (const f of MODELS[m].files) {
      const target = fileOf(m, f.path);
      if (present(m, f)) continue;
      mkdirSync(dirname(target), { recursive: true });
      const tmp = `${target}.part`;
      const res = await net.fetch(modelUrl(m, f.path), { signal: AbortSignal.timeout(10 * 60_000) });
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
        downloading!.progress = done / total;
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

/** Removes both models (Settings → Lyrics, with Auto-sync off). */
export function deleteModel(): LyricsSyncStatus {
  if (!downloading) {
    stopWorker();
    for (const m of Object.values(MODELS)) rmSync(join(root(), m.id), { recursive: true, force: true });
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

let workerModel: ModelName | null = null;

function runJob(pcm: Float32Array, lines: string[], times?: number[]): Promise<Reply> {
  if (idle) clearTimeout(idle);
  const id = nextId++;
  const m = current();
  // the other model is loaded: a fresh worker rather than both in memory
  if (worker && workerModel !== m) stopWorker();
  workerModel = m;
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
    w.postMessage({ id, root: root(), model: MODELS[m].id, pcm, lines, ...(times ? { times } : {}) } satisfies Job);
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

const keyOf = (q: SyncRequest) => `${ALIGN_VERSION}:${current()}:${q.trackId}:${q.source}:${q.lyricsId}:${q.times ? "check:" : ""}${createHash("sha1").update(q.plain).digest("hex").slice(0, 12)}`;

/** A song already worked out: its lines or its shift, null when the words didn't fit the song; undefined when not yet. */
export function syncedBefore(q: SyncRequest): SyncResult | null | undefined {
  return savedFile().get().byKey[keyOf(q)]?.result;
}

// one song at a time; the others wait their turn
let queue: Promise<unknown> = Promise.resolve();

/**
 * Plain words: placed in the song (their lines). A source's synced lines (`times`): checked at a few places, and the
 * shift or stretch most of them share (shared/fitTiming), or none — they are then left as they are.
 */
export function syncWords(q: SyncRequest, pcm: Float32Array): Promise<SyncResult | null> {
  const key = keyOf(q);
  const job = queue.then(async () => {
    const before = savedFile().get().byKey[key];
    if (before) return before.result;
    if (!haveModel(current())) throw new Error("the model isn't downloaded");
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
        let fit = fitTiming(
          heard.map((h) => h.source),
          heard.map((h) => h.heard),
        );
        log("main", `lyrics sync: track ${q.trackId}, ${r.language}, ${(r.ms / 1000).toFixed(1)} s, checked the source's timing: ${heard.length} lines heard, ${fit ? `× ${fit.scale.toFixed(3)} + ${fit.shift.toFixed(1)} s` : "no common timing"}`);
        // too few lines heard to be sure (fast, dense rap): the whole words placed in the song, and the timing that
        // most of the source's lines agree with
        if (!fit || heard.length < 5) {
          const all = await runJob(pcm, lines);
          if (!all.ok) throw new Error(all.error);
          const placed = all.alignment!.lines;
          fit = placed.length === times.length ? fitTiming(times, placed.map((l) => l.t)) : null;
          log("main", `lyrics sync: track ${q.trackId}, matched the whole words in ${(all.ms / 1000).toFixed(1)} s: ${fit ? `× ${fit.scale.toFixed(3)} + ${fit.shift.toFixed(1)} s` : "no common timing"}`);
        }
        result = fit ?? { scale: 1, shift: 0 };
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
