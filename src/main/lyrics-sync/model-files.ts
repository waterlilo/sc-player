/**
 * Whisper (OpenAI, MIT licence) as ONNX with the attention outputs word timing needs, 8-bit: what the words-to-song
 * worker runs — base by default, small in the accurate mode (hears fast and mumbled rap better, about three times
 * slower). Each is pinned to one revision, every file checked by size and SHA-256 after the download.
 */
export type ModelName = "base" | "small";

interface ModelFiles {
  id: string;
  revision: string;
  files: readonly { path: string; size: number; sha256: string }[];
}

export const MODELS: Record<ModelName, ModelFiles> = {
  base: {
    id: "onnx-community/whisper-base_timestamped",
    revision: "608c49e61301901684bc36cac8f74b95ff6b5a8e",
    files: [
      { path: "config.json", size: 2243, sha256: "f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b" },
      { path: "generation_config.json", size: 3832, sha256: "61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0" },
      { path: "preprocessor_config.json", size: 339, sha256: "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d" },
      { path: "tokenizer.json", size: 2480466, sha256: "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566" },
      { path: "tokenizer_config.json", size: 282682, sha256: "2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573" },
      { path: "onnx/encoder_model_quantized.onnx", size: 23159167, sha256: "2714484ebe1bae7c1646e8eadb768bb9d415cf11763466d21f23039a29c62e6f" },
      { path: "onnx/decoder_model_merged_quantized.onnx", size: 53712708, sha256: "cf9a8d5bcddc0917a0078135b484cedcaf44f28909cd91910abd29dced9171db" },
    ],
  },
  small: {
    id: "onnx-community/whisper-small_timestamped",
    revision: "65caa70f294b46e1c33ff820aae6b16d048ab818",
    files: [
      { path: "config.json", size: 2227, sha256: "457854d452f17661e197d74aee12b8e74fb75ba30ebfaa7426d0d61ea1e08a18" },
      { path: "generation_config.json", size: 3893, sha256: "f538b28220c6a6d6f1af1458d4141cacb4ef4963df3de98a19490440c412ddf0" },
      { path: "preprocessor_config.json", size: 339, sha256: "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d" },
      { path: "tokenizer.json", size: 2480466, sha256: "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566" },
      { path: "tokenizer_config.json", size: 282683, sha256: "2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce" },
      { path: "onnx/encoder_model_quantized.onnx", size: 92240498, sha256: "9f5635b596e6084045c7426ca6f6f99db8ce606ea895397c3b4a3c0aa3f9b070" },
      { path: "onnx/decoder_model_merged_quantized.onnx", size: 156795750, sha256: "c831996a6d5a535cf17447b0d7ecc36da6b72696e6fb906852ba6136b9199abb" },
    ],
  },
};

export const modelBytes = (m: ModelName) => MODELS[m].files.reduce((n, f) => n + f.size, 0);

export const modelUrl = (m: ModelName, path: string) => `https://huggingface.co/${MODELS[m].id}/resolve/${MODELS[m].revision}/${path}`;
