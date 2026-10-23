/**
 * When each token is heard, from Whisper's cross-attention — the same steps as transformers.js's
 * `_extract_token_timestamps` (and OpenAI's word timing): the alignment heads' weights normalized per audio frame over
 * the tokens, a median filter along the frames, their mean, and dynamic time warping. That one works on tensors value by
 * value and took half the time of a song's sync; this works on flat arrays. Pure: tested on its own.
 */

/** One decoder layer's cross-attention: [1, heads, tokens, frames] row-major. */
export interface Attention {
  data: Float32Array;
  dims: readonly number[];
}

/** The median of each value's neighbourhood (an odd `width`), mirrored at the edges. */
export function medianFilter(row: Float32Array, width: number): Float32Array {
  const half = width >> 1;
  const out = new Float32Array(row.length);
  const buf = new Float32Array(width);
  const last = row.length - 1;
  for (let i = 0; i < row.length; i++) {
    for (let j = -half; j <= half; j++) {
      let k = i + j;
      if (k < 0) k = -k;
      else if (k > last) k = 2 * last - k;
      // insertion into the sorted buffer
      const v = row[k]!;
      let at = j + half;
      while (at > 0 && buf[at - 1]! > v) {
        buf[at] = buf[at - 1]!;
        at--;
      }
      buf[at] = v;
    }
    out[i] = buf[half]!;
  }
  return out;
}

/**
 * The start of every token in seconds, laid out as transformers.js does: `skip` zeros for the prefix tokens it doesn't
 * time, one time per row after them, and the last time again (for the token the rows predict last).
 */
export function tokenTimes(layers: Attention[], heads: number[][], frames: number, skip: number, filterWidth = 7, precision = 0.02): Float32Array {
  const [, , tokens, stride] = layers[0]!.dims as [number, number, number, number];
  const width = Math.min(frames, stride);
  const rows = tokens - skip;
  const matrix = new Float32Array(rows * width);
  const mean = new Float64Array(width);
  const spread = new Float64Array(width);
  const row = new Float32Array(width);
  for (const [layer, head] of heads) {
    const { data, dims } = layers[layer!]!;
    const base = head! * dims[2]! * dims[3]!;
    const at = (r: number, c: number) => data[base + r * dims[3]! + c]!;
    // mean and (population) standard deviation of each frame over all the tokens
    mean.fill(0);
    spread.fill(0);
    for (let r = 0; r < tokens; r++) for (let c = 0; c < width; c++) mean[c]! += at(r, c);
    for (let c = 0; c < width; c++) mean[c]! /= tokens;
    for (let r = 0; r < tokens; r++)
      for (let c = 0; c < width; c++) {
        const d = at(r, c) - mean[c]!;
        spread[c]! += d * d;
      }
    for (let c = 0; c < width; c++) spread[c] = Math.sqrt(spread[c]! / tokens);
    for (let r = skip; r < tokens; r++) {
      for (let c = 0; c < width; c++) row[c] = (at(r, c) - mean[c]!) / spread[c]!;
      const filtered = medianFilter(row, filterWidth);
      const off = (r - skip) * width;
      for (let c = 0; c < width; c++) matrix[off + c]! += filtered[c]!;
    }
  }
  for (let i = 0; i < matrix.length; i++) matrix[i]! /= heads.length;

  // dynamic time warping over the negated weights: the cheapest path from the first token and frame to the last
  const W = width + 1;
  const cost = new Float64Array((rows + 1) * W).fill(Infinity);
  const trace = new Uint8Array((rows + 1) * W);
  cost[0] = 0;
  for (let j = 1; j <= width; j++)
    for (let i = 1; i <= rows; i++) {
      const c0 = cost[(i - 1) * W + j - 1]!;
      const c1 = cost[(i - 1) * W + j]!;
      const c2 = cost[i * W + j - 1]!;
      let c: number;
      let t: number;
      if (c0 < c1 && c0 < c2) [c, t] = [c0, 0];
      else if (c1 < c0 && c1 < c2) [c, t] = [c1, 1];
      else [c, t] = [c2, 2];
      cost[i * W + j] = -matrix[(i - 1) * width + j - 1]! + c;
      trace[i * W + j] = t;
    }
  for (let j = 0; j <= width; j++) trace[j] = 2;
  for (let i = 0; i <= rows; i++) trace[i * W] = 1;
  const text: number[] = [];
  const time: number[] = [];
  for (let i = rows, j = width; i > 0 || j > 0; ) {
    text.push(i - 1);
    time.push(j - 1);
    const t = trace[i * W + j];
    if (t === 0) {
      i--;
      j--;
    } else if (t === 1) i--;
    else j--;
  }
  text.reverse();
  time.reverse();

  const out = new Float32Array(tokens + 1);
  let k = skip;
  for (let i = 0; i < text.length; i++) if (i === 0 || text[i] !== text[i - 1]) out[k++] = time[i]! * precision;
  if (k > skip) out[k] = out[k - 1]!;
  return out;
}
