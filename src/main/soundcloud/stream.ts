import { isPlayable, type RawTranscoding } from "./mappers";

/**
 * Best transcoding Chromium can play, in this order: AAC HLS (SoundCloud's main format now; for "high" the best quality
 * first, then 160 kbps, then 96; for "low" 96 kbps first), progressive MP3 (being retired), MP3 HLS. Full streams always
 * beat 30 s snippets.
 */
export function pickTranscoding(list: RawTranscoding[], quality: "high" | "low" = "high"): RawTranscoding | null {
  const score = (t: RawTranscoding) => {
    const protocol = t.format?.protocol;
    const mime = t.format?.mime_type ?? "";
    const preset = t.preset ?? "";
    let s = 0;
    if (protocol === "hls" && /mp4a|audio\/mp4|aac/.test(mime + preset)) s = 300;
    else if (protocol === "progressive") s = 200;
    else if (protocol === "hls") s = 100;
    // "low" (Settings) saves traffic: the 96 kbps AAC first
    if (quality === "high") {
      if (t.quality === "hq") s += 20;
      if (preset.includes("160")) s += 10;
    } else if (preset.includes("96") || t.quality === "lq") s += 20;
    if (t.snipped) s -= 1000;
    return s;
  };
  return list.filter(isPlayable).sort((a, b) => score(b) - score(a))[0] ?? null;
}
