import { create } from "zustand";
import type { LyricsSyncStatus, SyncRequest, SyncResult } from "@shared/types";
import { call, on } from "./sky";

/**
 * Auto-sync of plain words (main: src/main/lyrics-sync): the page decodes the track's sound — Web Audio is here — to
 * mono 16 kHz and main's worker matches the words to it. The status of the model lives in a small store.
 */

export const useLyricsSync = create<{ status: LyricsSyncStatus | null }>(() => ({ status: null }));

let started = false;
/** reads the status once and follows its changes (download progress, a song being worked out) */
export function watchLyricsSync() {
  if (started) return;
  started = true;
  on("lyricsSync:status", (status) => useLyricsSync.setState({ status }));
  void call("lyricsSync:status").then((status) => useLyricsSync.setState({ status }));
}

const SAMPLE_RATE = 16000;

/** The whole track as mono 16 kHz samples: an HLS stream's segments glued together (and its init part), or the file. */
async function decode(trackId: number, signal: AbortSignal): Promise<Float32Array | null> {
  const stream = await call("data:stream", trackId);
  // a 30 s preview is not the song
  if (stream.snipped) return null;
  const get = async (url: string) => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`the stream answered ${res.status}`);
    return res.arrayBuffer();
  };
  let bytes: ArrayBuffer;
  if (stream.protocol === "hls") {
    const list = await (await fetch(stream.url, { signal })).text();
    const base = new URL(stream.url);
    const init = /#EXT-X-MAP:URI="([^"]+)"/.exec(list)?.[1];
    const segments = list
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => new URL(l, base).href);
    const parts: ArrayBuffer[] = init ? [await get(new URL(init, base).href)] : [];
    // six at a time
    for (let i = 0; i < segments.length; i += 6) parts.push(...(await Promise.all(segments.slice(i, i + 6).map(get))));
    const all = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
    let at = 0;
    for (const p of parts) {
      all.set(new Uint8Array(p), at);
      at += p.byteLength;
    }
    bytes = all.buffer;
  } else bytes = await get(stream.url);
  const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes);
  // mono 16 kHz: an offline context of one channel mixes down and resamples
  const out = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
  const src = out.createBufferSource();
  src.buffer = decoded;
  src.connect(out.destination);
  src.start();
  return (await out.startRendering()).getChannelData(0);
}

/** These words in this track (their lines, or the shift of the source's): worked out before, or now. */
export async function syncLyrics(q: SyncRequest, signal: AbortSignal): Promise<SyncResult | null> {
  const before = await call("lyricsSync:before", q);
  if (before !== undefined) return before;
  const pcm = await decode(q.trackId, signal);
  if (!pcm || signal.aborted) return null;
  return call("lyricsSync:run", q, pcm);
}
