import { AutoProcessor, AutoTokenizer, env, Tensor, WhisperForConditionalGeneration, type PreTrainedTokenizer, type Processor } from "@huggingface/transformers";
import { align, heardTimes, languageOf, SAMPLE_RATE, type Model, type WindowResult } from "./align";
import { MODEL_ID } from "./model-files";
import { tokenTimes, type Attention } from "./timing";

/**
 * The words-to-song worker (an Electron utility process, started for the job and closed when idle): Whisper base on
 * the CPU, four threads, from the files main downloaded. It never writes words, only places the known ones (align.ts):
 * all of them (plain words), or a few to check a source's timing (`times`).
 */

export interface Job {
  id: number;
  /** the folder the model files are in (userData/models) */
  root: string;
  /** mono, 16 kHz */
  pcm: Float32Array;
  lines: string[];
  /** the source's line times: only check them (heardTimes) */
  times?: number[];
}
export type Reply =
  | { id: number; ok: true; alignment?: Awaited<ReturnType<typeof align>>; heard?: Awaited<ReturnType<typeof heardTimes>>; language: string; ms: number }
  | { id: number; ok: false; error: string };

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
  const session_options = { intraOpNumThreads: 4, interOpNumThreads: 1, enableCpuMemArena: false, enableMemPattern: false };
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
type WithEncoder = { _prepare_encoder_decoder_kwargs_for_generation(o: { inputs_tensor: Tensor; model_inputs: Record<string, Tensor>; model_input_name: string; generation_config: unknown }): Promise<{ encoder_outputs: Tensor }> };

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
  // the encoder's hearing of a window, kept while the job goes on: a window is placed again after a look ahead or when
  // lines are set aside, and only the words change
  const heard = new Map<string, Tensor>();
  const pass = async (window: Float32Array, ids: number[]) => {
    const key = `${window.byteOffset}:${window.length}`;
    let encoder_outputs = heard.get(key);
    if (!encoder_outputs) {
      const { input_features } = (await w.processor(window)) as { input_features: Tensor };
      encoder_outputs = (await (w.model as unknown as WithEncoder)._prepare_encoder_decoder_kwargs_for_generation({ inputs_tensor: input_features, model_inputs: { input_features }, model_input_name: "input_features", generation_config: w.model.generation_config })).encoder_outputs;
      heard.set(key, encoder_outputs);
      if (heard.size > 6) heard.delete(heard.keys().next().value!);
    }
    const dec = new Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]);
    return (await w.model({ encoder_outputs, decoder_input_ids: dec })) as Output;
  };

  // the language: from the letters of the words when they tell it, else heard at a quarter, the middle and three
  // quarters of the song (one place can be an intro or a hook in another language)
  const fromText = languageOf(job.lines);
  let language = fromText && gc.lang_to_id[`<|${fromText}|>`] !== undefined ? `<|${fromText}|>` : "";
  if (!language) {
    const votes = new Map<string, number>();
    for (const at of [0.25, 0.5, 0.75]) {
      const start = Math.max(0, Math.floor(job.pcm.length * at) - 15 * SAMPLE_RATE);
      const row = (await pass(job.pcm.subarray(start, start + 30 * SAMPLE_RATE), [gc.decoder_start_token_id])).logits.data as Float32Array;
      let best = "<|en|>";
      for (const [token, id] of Object.entries(gc.lang_to_id)) if (row[id]! > row[gc.lang_to_id[best]!]!) best = token;
      votes.set(best, (votes.get(best) ?? 0) + 1);
    }
    language = [...votes].sort((a, b) => b[1] - a[1])[0]![0];
  }

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
        .map((k) => ({ data: out[k]!.data as Float32Array, dims: out[k]!.dims }) satisfies Attention);
      // the row of token k (it predicts token k + 1) is where k + 1 is heard: the times of token k are at k - 1
      const times = tokenTimes(cross, gc.alignment_heads, Math.floor(window.length / 320), prefix.length - 1, (w.model.config as { median_filter_width?: number }).median_filter_width ?? 7);
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
  const lang = language.slice(2, -2);
  if (job.times) return { heard: await heardTimes(job.pcm, job.lines, job.times, model), language: lang };
  return { alignment: await align(job.pcm, job.lines, model), language: lang };
}

process.parentPort.on("message", (e) => {
  const job = e.data as Job;
  const started = Date.now();
  void load(job.root)
    .then((w) => run(w, job))
    .then((r) => process.parentPort.postMessage({ id: job.id, ok: true, ...r, ms: Date.now() - started } satisfies Reply))
    .catch((err: unknown) => process.parentPort.postMessage({ id: job.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies Reply));
});
