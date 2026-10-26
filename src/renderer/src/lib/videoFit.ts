import { ALL_FORMATS, BufferTarget, CanvasSink, Conversion, Input, Mp4OutputFormat, Output, UrlSource } from "mediabunny";

/**
 * Videos made into backgrounds here, with the browser's own encoder (WebCodecs, on the graphics card when it can):
 * a Steam wallpaper becomes a 2K copy — a background sits under dimming and blur, and 4K only works the GPU harder —
 * and a background going to the workshop is fitted to its 25 MB: a lower bitrate first, and when even that isn't
 * enough, a shorter video that ends where a frame looks most like the first one, so the loop stays smooth.
 */

/** 2K: the tallest picture a background is kept at */
const HEIGHT_2K = 1440;
/** smoother than this only works the GPU harder (some wallpapers are 120 fps) */
const MAX_FPS = 60;
/** a good 2K picture */
const BITRATE_2K = 14_000_000;
/** below this a 2K picture falls apart: the video gets shorter instead */
const MIN_BITRATE = 4_000_000;
/** room for the file's own bookkeeping and the encoder overshooting its target */
const SAFETY = 0.9;

export type Progress = (done: number) => void;

const open = (url: string) => new Input({ formats: ALL_FORMATS, source: new UrlSource(url) });

/** How long the video is and how tall its picture. */
export async function probe(url: string): Promise<{ duration: number; height: number }> {
  const input = open(url);
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error("There's no video in this file");
    return { duration: await input.computeDuration(), height: video.displayHeight };
  } finally {
    input.dispose();
  }
}

/** One pass: H.264, at most 2K tall and 60 fps, no sound (a background is silent), cut at `end` seconds when given. */
async function encode(url: string, o: { bitrate: number; end?: number }, onProgress: Progress): Promise<Uint8Array> {
  const input = open(url);
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error("There's no video in this file");
    const fps = (await video.computePacketStats(120)).averagePacketRate;
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      video: {
        ...(video.displayHeight > HEIGHT_2K ? { height: HEIGHT_2K } : {}),
        // always given: without it the encoder takes 30 fps and a 60 fps video comes out twice the bitrate asked for
        frameRate: Math.min(MAX_FPS, Math.max(1, Math.round(fps))),
        codec: "avc",
        bitrate: Math.round(o.bitrate),
        keyFrameInterval: 2,
        forceTranscode: true,
        hardwareAcceleration: "no-preference",
      },
      audio: { discard: true },
      ...(o.end ? { trim: { start: 0, end: o.end } } : {}),
    });
    if (!conversion.isValid) throw new Error("This video can't be converted here");
    conversion.onProgress = (p) => onProgress(p);
    await conversion.execute();
    return new Uint8Array(output.target.buffer!);
  } finally {
    input.dispose();
  }
}

/** A tiny grey copy of a frame, to compare frames by. */
function greys(canvas: HTMLCanvasElement | OffscreenCanvas): Float32Array {
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const out = new Float32Array(data.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  return out;
}

/** The time between `from` and `to` whose frame looks most like the first: where the video can loop back smoothly. */
async function loopPoint(url: string, from: number, to: number): Promise<number> {
  const input = open(url);
  try {
    const video = (await input.getPrimaryVideoTrack())!;
    const sink = new CanvasSink(video, { width: 48, height: 27, fit: "fill" });
    const firstAt = await video.getFirstTimestamp();
    const first = await sink.getCanvas(firstAt);
    if (!first) return to;
    const ref = greys(first.canvas);
    const times: number[] = [];
    for (let t = from; t <= to; t += 0.2) times.push(t);
    let best = { t: to, d: Infinity };
    for await (const c of sink.canvasesAtTimestamps(times)) {
      if (!c) continue;
      const g = greys(c.canvas);
      let d = 0;
      for (let i = 0; i < g.length; i++) d += Math.abs(g[i]! - ref[i]!);
      if (d < best.d) best = { t: c.timestamp - firstAt, d };
    }
    return best.t;
  } finally {
    input.dispose();
  }
}

/** A Steam wallpaper as a background: the same length, 2K at most. */
export const to2K = (url: string, onProgress: Progress) => encode(url, { bitrate: BITRATE_2K }, onProgress);

/** The video fitted into `maxBytes`: a lower bitrate, then (if needed) shorter, ending on a smooth loop. */
export async function fitTo(url: string, maxBytes: number, onProgress: Progress): Promise<Uint8Array> {
  const { duration } = await probe(url);
  const budget = maxBytes * 8 * SAFETY;
  let end: number | undefined;
  let bitrate = Math.min(BITRATE_2K, budget / duration);
  if (bitrate < MIN_BITRATE) {
    // the longest the video can stay at a decent picture, and a loop point in its last stretch
    const longest = Math.min(duration, budget / MIN_BITRATE);
    onProgress(0.02);
    end = await loopPoint(url, Math.max(2, longest * 0.6), longest);
    bitrate = Math.min(BITRATE_2K, budget / end);
  }
  // the encoder's bitrate is a target, not a promise: once more, lower, when it overshoots
  for (let attempt = 0; attempt < 3; attempt++) {
    const out = await encode(url, { bitrate, end }, (p) => onProgress(0.05 + 0.95 * p));
    if (out.byteLength <= maxBytes) return out;
    bitrate *= (0.9 * maxBytes) / out.byteLength;
  }
  throw new Error("The video didn't fit — try a shorter one");
}
