import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { create } from "zustand";
import type { LyricsForReview, Track } from "@shared/types";
import { useT } from "@/i18n";
import { call } from "@/lib/sky";
import { player } from "@/state/player";
import { useUi } from "@/state/ui";

/** The lyrics being tried with the song (the full screen player shows Approve / Reject for them). */
export const useReviewing = create<{ item: LyricsForReview | null }>(() => ({ item: null }));

export const reviewKey = ["lyrics-review"] as const;
/** The lyrics waiting for the moderator (the sidebar's count looks again every few minutes). */
export const useLyricsQueue = (enabled = true) =>
  useQuery({ queryKey: reviewKey, queryFn: () => call("lyrics:review"), enabled, staleTime: 30_000, refetchInterval: 5 * 60_000 });

export function useDecide() {
  const t = useT();
  const client = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const [busy, setBusy] = useState<number | null>(null);
  const decide = async (r: LyricsForReview, approve: boolean) => {
    setBusy(r.id);
    try {
      await call("lyrics:decide", r.id, approve, r.track);
      client.setQueryData<LyricsForReview[]>(reviewKey, (old) => old?.filter((x) => x.id !== r.id));
      await client.invalidateQueries({ queryKey: ["lyrics", r.track] });
      if (useReviewing.getState().item?.id === r.id) useReviewing.setState({ item: null });
      toast(approve ? t.lyricsApproved : t.lyricsRejected);
    } catch {
      toast(t.serverOffline);
    } finally {
      setBusy(null);
    }
  };
  return { busy, decide };
}

/** Plays the track with the sent lyrics shown, in the full screen player. */
export async function tryWithSong(r: LyricsForReview, setLyrics: (l: LyricsForReview["lyrics"]) => void): Promise<boolean> {
  const [track] = (await call("data:tracks", [r.track])) as Track[];
  if (!track) return false;
  setLyrics(r.lyrics);
  useReviewing.setState({ item: r });
  player.playFrom([track], 0, { kind: "static" });
  useUi.setState({ fullOpen: true, fullTab: "lyrics", queueOpen: false });
  return true;
}

/** In the full screen player, while sent lyrics are tried with their song: approve or reject them right there. */
export function ReviewBar({ track }: { track: Track }) {
  const t = useT();
  const item = useReviewing((s) => s.item);
  const { busy, decide } = useDecide();
  if (!item || item.track !== track.id) return null;
  return (
    <div className="s-pop absolute bottom-16 right-6 z-10 flex items-center gap-2 rounded-[var(--r,10px)] py-1.5 pl-3 pr-1.5 text-xs text-muted">
      <span className="mr-1">{t.reviewingBy(item.by || item.byCode || t.someone)}</span>
      <button type="button" disabled={busy === item.id} onClick={() => void decide(item, false)} className="s-btn">
        {t.lyricsReject}
      </button>
      <button type="button" disabled={busy === item.id} onClick={() => void decide(item, true)} className="s-btn pri">
        {t.lyricsApprove}
      </button>
    </div>
  );
}
