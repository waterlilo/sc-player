import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { artwork, type Playlist } from "@shared/types";
import { useT } from "@/i18n";
import { call, errorCode } from "@/lib/sky";
import { askCheck } from "@/state/check";
import { useUi } from "@/state/ui";
import Icon from "../ui/Icon";

/** "Add to playlist": the user's own playlists in a small card in the middle of the window. Esc or a click outside closes. */
export default function PlaylistPicker() {
  const t = useT();
  const track = useUi((s) => s.picker);
  const close = useUi((s) => s.closePicker);
  const toast = useUi((s) => s.showToast);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ["myPlaylists"], queryFn: () => call("data:myPlaylists"), enabled: !!track, staleTime: 60_000 });
  const lists = q.data ?? null;
  const failed = q.isError;

  useEffect(() => {
    if (!track) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [track, close]);

  const add = async (p: Playlist) => {
    if (!track) return;
    setBusy(p.id);
    try {
      await call("data:addToPlaylist", p.id, track.id);
      toast(t.addedTo(p.title));
      close();
    } catch (err) {
      if (errorCode(err) === "verify") {
        close();
        const id = track.id;
        askCheck({
          action: t.addToPlaylist,
          url: track.permalinkUrl,
          retry: () =>
            call("data:addToPlaylist", p.id, id).then(
              () => true,
              () => false,
            ),
        });
      } else toast(t.addFailed);
    } finally {
      setBusy(null);
    }
  };

  return (
    <AnimatePresence>
      {track && (
        <motion.div
          className="fixed inset-0 z-[70] grid place-items-center bg-black/40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          onPointerDown={(e) => !ref.current?.contains(e.target as Node) && close()}
        >
          <div ref={ref} role="dialog" aria-label={t.addToPlaylist} className="paper-fill sketch sketch-thin w-[22rem] max-w-[90vw] rounded-md py-2 shadow-[4px_6px_0_rgba(0,0,0,0.5)]">
            <div className="px-4 pb-2 pt-1">
              <div className="font-type text-xs text-muted">{t.addToPlaylist}</div>
              <div className="truncate text-sm text-text">{track.title}</div>
            </div>
            <div className="max-h-[50vh] overflow-y-auto">
              {failed && <p className="px-4 py-3 text-sm text-muted">{t.playlistsFailed}</p>}
              {!failed && !lists && <p className="px-4 py-3 font-type text-sm text-muted">{t.loadingMore}</p>}
              {lists?.length === 0 && <p className="px-4 py-3 text-sm text-muted">{t.noOwnPlaylists}</p>}
              {lists?.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void add(p)}
                  className="flex w-full items-center gap-3 px-4 py-1.5 text-left text-sm text-text outline-none hover:bg-[var(--row-hover)] focus-visible:bg-[var(--row-hover)] disabled:opacity-60"
                >
                  <span className="h-9 w-9 shrink-0 overflow-hidden rounded-sm bg-[var(--paper)]">
                    {p.artworkUrl && <img src={artwork(p.artworkUrl, "t67x67") ?? undefined} alt="" className="h-full w-full object-cover" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{p.title}</span>
                  {busy === p.id ? <span className="font-type text-xs text-muted">…</span> : <Icon name="plus" size={16} />}
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
