/**
 * Whisper base (OpenAI, MIT licence) as ONNX with the attention outputs word timing needs, 8-bit: what the words-to-song
 * worker runs. Pinned to one revision, every file checked by size and SHA-256 after the download.
 */
export const MODEL_ID = "onnx-community/whisper-base_timestamped";
const REVISION = "608c49e61301901684bc36cac8f74b95ff6b5a8e";

export const MODEL_FILES = [
  { path: "config.json", size: 2243, sha256: "f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b" },
  { path: "generation_config.json", size: 3832, sha256: "61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0" },
  { path: "preprocessor_config.json", size: 339, sha256: "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d" },
  { path: "tokenizer.json", size: 2480466, sha256: "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566" },
  { path: "tokenizer_config.json", size: 282682, sha256: "2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573" },
  { path: "onnx/encoder_model_quantized.onnx", size: 23159167, sha256: "2714484ebe1bae7c1646e8eadb768bb9d415cf11763466d21f23039a29c62e6f" },
  { path: "onnx/decoder_model_merged_quantized.onnx", size: 53712708, sha256: "cf9a8d5bcddc0917a0078135b484cedcaf44f28909cd91910abd29dced9171db" },
] as const;

export const MODEL_BYTES = MODEL_FILES.reduce((n, f) => n + f.size, 0);

export const modelUrl = (path: string) => `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}/${path}`;
