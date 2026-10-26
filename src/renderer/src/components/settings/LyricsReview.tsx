import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import type { LyricsForReview, Track } from "@shared/types";
import { useT } from "@/i18n";
import { call } from "@/lib/sky";
import { player } from "@/state/player";
import { useUi } from "@/state/ui";

/** The lyrics being tried with the song (the full screen player shows Approve / Reject for them). */
export const useReviewing = create<{ item: LyricsForReview | null }>(() => ({ item: null }));

export const reviewKey = ["lyrics-review"] as const;
export const useLyricsQueue = (enabled = true) => useQuery({ queryKey: reviewKey, queryFn: () => call("lyrics:review"), enabled, staleTime: 30_000 });

function useDecide() {
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
async function tryWithSong(r: LyricsForReview, setLyrics: (l: LyricsForReview["lyrics"]) => void): Promise<boolean> {
  const [track] = (await call("data:tracks", [r.track])) as Track[];
  if (!track) return false;
  setLyrics(r.lyrics);
  useReviewing.setState({ item: r });
  player.playFrom([track], 0, { kind: "static" });
  useUi.setState({ fullOpen: true, fullTab: "lyrics", queueOpen: false });
  return true;
}

/** The moderator's queue of lyrics people sent: try each with its song, approve it for everyone or reject it. */
export default function LyricsReview({ onClose }: { onClose: () => void }) {
  const t = useT();
  const client = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const q = useLyricsQueue();
  const { busy, decide } = useDecide();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tryIt = async (r: LyricsForReview) => {
    const ok = await tryWithSong(r, (l) => client.setQueryData(["lyrics", r.track], l)).catch(() => false);
    if (!ok) return toast(t.trackGone);
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onPointerDown={(e) => !ref.current?.contains(e.target as Node) && onClose()}
      >
        <div ref={ref} role="dialog" aria-label={t.lyricsReview} className="s-pop flex max-h-full w-[40rem] max-w-full flex-col rounded-[var(--r,10px)] shadow-[0_30px_80px_rgba(0,0,0,0.55)]" data-keys-own>
          <h2 className="px-5 pb-2 pt-4 text-[15px] font-semibold text-text">{t.lyricsReview}</h2>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {q.isPending && <p className="px-2 py-4 text-sm text-muted">{t.loadingMore}</p>}
            {q.isError && <p className="px-2 py-4 text-sm text-muted">{t.serverOffline}</p>}
            {q.data?.length === 0 && <p className="px-2 py-4 text-sm text-muted">{t.lyricsReviewEmpty}</p>}
            {q.data?.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-[var(--row-hover)]">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-text">{r.title}</div>
                  <div className="truncate text-xs text-muted">
                    {r.artist} · {t.lyricsLines(r.lyrics.synced?.length ?? 0)} · {t.lyricsBy(r.by || r.byCode || t.someone)}
                    {r.replaces && ` · ${t.lyricsReplaces}`}
                  </div>
                </div>
                <button type="button" onClick={() => void tryIt(r)} className="s-btn shrink-0">
                  {t.lyricsTry}
                </button>
                <button type="button" disabled={busy === r.id} onClick={() => void decide(r, false)} className="s-btn shrink-0">
                  {t.lyricsReject}
                </button>
                <button type="button" disabled={busy === r.id} onClick={() => void decide(r, true)} className="s-btn pri shrink-0">
                  {t.lyricsApprove}
                </button>
              </div>
            ))}
          </div>
          <div className="flex justify-end border-t border-white/[0.06] px-4 py-3">
            <button type="button" onClick={onClose} className="s-btn">
              {t.close}
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
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
