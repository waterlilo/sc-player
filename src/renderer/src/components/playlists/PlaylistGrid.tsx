import { useEffect, useRef } from "react";
import type { Playlist } from "@shared/types";
import { useT } from "@/i18n";
import PlaylistCard from "./PlaylistCard";

/** Grid of playlist cards; the next page loads when the end of the grid scrolls into view. */
export default function PlaylistGrid({ playlists, hasMore, loadingMore, onLoadMore }: { playlists: Playlist[]; hasMore: boolean; loadingMore: boolean; onLoadMore: () => void }) {
  const t = useT();
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loadingMore) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && onLoadMore(), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadingMore, onLoadMore, playlists.length]);

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-6 gap-y-8 pt-2">
        {playlists.map((p, i) => (
          <PlaylistCard key={`${p.id}-${p.relation}`} playlist={p} index={i} />
        ))}
      </div>
      <div ref={sentinel} className="h-px" />
      {loadingMore && <p className="py-4 text-center font-type text-sm text-muted">{t.loadingMore}</p>}
    </>
  );
}
