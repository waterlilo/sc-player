import { AutoProcessor, AutoTokenizer, env, Tensor, WhisperForConditionalGeneration, type PreTrainedTokenizer, type Processor } from "@huggingface/transformers";
import { align, SAMPLE_RATE, type Model, type WindowResult } from "./align";
import { MODEL_ID } from "./model-files";

/**
 * The words-to-song worker (an Electron utility process, started for the job and closed when idle): Whisper base on
 * the CPU, two threads, from the files main downloaded. It never writes words, only places the known ones (align.ts).
 */

export interface Job {
  id: number;
  /** the folder the model files are in (userData/models) */
  root: string;
  /** mono, 16 kHz */
  pcm: Float32Array;
  lines: string[];
}
export type Reply = { id: number; ok: true; alignment: Awaited<ReturnType<typeof align>>; language: string; ms: number } | { id: number; ok: false; error: string };

interface Whisper {
  model: WhisperForConditionalGeneration;
  processor: Processor;
  tokenizer: PreTrainedTokenizer;
}
let loading: Promise<Whisper> | null = null;

function load(root: string): Promise<Whisper> {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = root;
  // memory pools off: the worker is short-lived, and they kept twice the memory it needs
  const session_options = { intraOpNumThreads: 2, interOpNumThreads: 1, enableCpuMemArena: false, enableMemPattern: false };
  return (loading ??= (async () => ({
    model: (await WhisperForConditionalGeneration.from_pretrained(MODEL_ID, { dtype: "q8", device: "cpu", session_options, local_files_only: true })) as WhisperForConditionalGeneration,
    processor: await AutoProcessor.from_pretrained(MODEL_ID, { local_files_only: true }),
    tokenizer: await AutoTokenizer.from_pretrained(MODEL_ID, { local_files_only: true }),
  }))());
}

interface GenerationConfig {
  decoder_start_token_id: number;
  lang_to_id: Record<string, number>;
  task_to_id: Record<string, number>;
  no_timestamps_token_id: number;
  eos_token_id: number | number[];
  alignment_heads: number[][];
}
type Output = Record<string, Tensor> & { logits: Tensor };
type WithTimestamps = { _extract_token_timestamps(o: { cross_attentions: Tensor[][]; sequences: { dims: number[] } }, heads: number[][], frames: number, precision: number, skip: number): Tensor[] };

/** log-softmax of one row of logits at one token */
function logProb(logits: Float32Array, row: number, vocab: number, token: number) {
  const off = row * vocab;
  let max = -Infinity;
  for (let v = 0; v < vocab; v++) max = Math.max(max, logits[off + v]!);
  let sum = 0;
  for (let v = 0; v < vocab; v++) sum += Math.exp(logits[off + v]! - max);
  return logits[off + token]! - max - Math.log(sum);
}

async function run(w: Whisper, job: Job) {
  const gc = w.model.generation_config as unknown as GenerationConfig;
  const pass = async (window: Float32Array, ids: number[]) => {
    const { input_features } = await w.processor(window);
    const dec = new Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]);
    return (await w.model({ input_features, decoder_input_ids: dec })) as Output;
  };

  // the language, from the middle of the song (the start is often an intro)
  const mid = Math.max(0, Math.floor(job.pcm.length / 2) - 15 * SAMPLE_RATE);
  const first = await pass(job.pcm.subarray(mid, mid + 30 * SAMPLE_RATE), [gc.decoder_start_token_id]);
  const row = first.logits.data as Float32Array;
  let language = "<|en|>";
  for (const [token, id] of Object.entries(gc.lang_to_id)) if (row[id]! > row[gc.lang_to_id[language]!]!) language = token;

  const prefix = [gc.decoder_start_token_id, gc.lang_to_id[language]!, gc.task_to_id.transcribe!, gc.no_timestamps_token_id];
  const eot = Array.isArray(gc.eos_token_id) ? gc.eos_token_id[0]! : gc.eos_token_id;
  const model: Model = {
    encode: (word) => w.tokenizer.encode(word, { add_special_tokens: false }),
    forward: async (window, text): Promise<WindowResult> => {
      const ids = [...prefix, ...text, eot];
      const out = await pass(window, ids);
      const cross = Object.keys(out)
        .filter((k) => k.startsWith("cross_attentions"))
        .sort((a, b) => Number(a.split(".")[1]) - Number(b.split(".")[1]))
        .map((k) => out[k]!);
      // the row of token k (it predicts token k + 1) is where k + 1 is heard: the times of token k are at k - 1
      const times = (w.model as unknown as WithTimestamps)._extract_token_timestamps({ cross_attentions: [cross], sequences: { dims: [1, ids.length + 1] } }, gc.alignment_heads, Math.floor(window.length / 320), 0.02, prefix.length - 1)[0]!.data as Float32Array;
      const logits = out.logits.data as Float32Array;
      const vocab = out.logits.dims[2]!;
      const base = prefix.length - 1;
      return {
        starts: text.map((_, j) => times[base + j]!),
        end: times[base + text.length]!,
        p: text.map((token, j) => Math.exp(logProb(logits, base + j, vocab, token))),
      };
    },
  };
  return { alignment: await align(job.pcm, job.lines, model), language: language.slice(2, -2) };
}

process.parentPort.on("message", (e) => {
  const job = e.data as Job;
  const started = Date.now();
  void load(job.root)
    .then((w) => run(w, job))
    .then(({ alignment, language }) => process.parentPort.postMessage({ id: job.id, ok: true, alignment, language, ms: Date.now() - started } satisfies Reply))
    .catch((err: unknown) => process.parentPort.postMessage({ id: job.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies Reply));
});
