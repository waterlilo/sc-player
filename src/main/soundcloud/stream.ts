import { isPlayable, type RawTranscoding } from "./mappers";

/**
 * Best transcoding Chromium can play, in this order: AAC HLS (SoundCloud's main format now; high quality first, then
 * 160 kbps, then 96), progressive MP3 (being retired), MP3 HLS. Full streams always beat 30 s snippets.
 */
export function pickTranscoding(list: RawTranscoding[]): RawTranscoding | null {
  const score = (t: RawTranscoding) => {
    const protocol = t.format?.protocol;
    const mime = t.format?.mime_type ?? "";
    const preset = t.preset ?? "";
    let s = 0;
    if (protocol === "hls" && /mp4a|audio\/mp4|aac/.test(mime + preset)) s = 300;
    else if (protocol === "progressive") s = 200;
    else if (protocol === "hls") s = 100;
    if (t.quality === "hq") s += 20;
    if (preset.includes("160")) s += 10;
    if (t.snipped) s -= 1000;
    return s;
  };
  return list.filter(isPlayable).sort((a, b) => score(b) - score(a))[0] ?? null;
}
