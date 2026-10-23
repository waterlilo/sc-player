/** Stands in for sharp (images) in the lyrics worker's copy of transformers.js, which never reads an image. */
export default function sharp(): never {
  throw new Error("images are not supported here");
}
