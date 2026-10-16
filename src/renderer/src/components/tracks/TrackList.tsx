import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { QueueSource, Track } from "@shared/types";
import { useT } from "@/i18n";
import { useVisibleTracks } from "@/lib/hidden";
import { canPlay, player, usePlayer } from "@/state/player";
import { useScrollElement } from "../ui/Screen";
import TrackRow, { ROW_HEIGHT } from "./TrackRow";

interface Props {
  tracks: Track[];
  /** where these came from, with the cursor of the next page: the queue keeps loading the list as it plays */
  source: QueueSource;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  label: string;
}

/**
 * Thousands of likes scroll smoothly: only the rows on screen exist (virtualized against the screen's scroller), and
 * the next page is requested when the last rows come near.
 */
export default function TrackList({ tracks: all, source, hasMore = false, loadingMore = false, onLoadMore, label }: Props) {
  const t = useT();
  // blocked artists and hidden keywords (Settings) are left out
  const tracks = useVisibleTracks(all);
  const scroller = useScrollElement();
  const listRef = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playing = usePlayer((s) => s.status === "playing" || s.status === "loading");

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !scroller) return;
    const measure = () => setMargin(list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller.firstElementChild ?? scroller);
    return () => ro.disconnect();
  }, [scroller]);

  // the app does not use the React Compiler; the virtualizer re-renders this list itself
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => scroller,
    // on mount the virtualizer scrolls its element to initialOffset (0 by default), which wiped the position the screen
    // restores when you come back to a page: start from wherever the scroller already is
    initialOffset: () => scroller?.scrollTop ?? 0,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    scrollMargin: margin,
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items[items.length - 1]?.index ?? -1;

  useEffect(() => {
    if (hasMore && !loadingMore && lastIndex >= tracks.length - 15) onLoadMore?.();
  }, [hasMore, loadingMore, lastIndex, tracks.length, onLoadMore]);

  const onPlay = useCallback(
    (index: number) => {
      const target = tracks[index];
      if (!target || !canPlay(target)) return;
      if (target.id === usePlayer.getState().queue[usePlayer.getState().index]?.id) return player.toggle();
      player.playFrom(tracks, index, source);
    },
    [tracks, source],
  );

  return (
    <div ref={listRef} role="grid" aria-label={label} aria-rowcount={tracks.length}>
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const track = tracks[item.index]!;
          return (
            <div key={`${track.id}-${item.index}`} className="absolute left-0 top-0 w-full" style={{ height: ROW_HEIGHT, transform: `translateY(${item.start - margin}px)` }}>
              <TrackRow track={track} index={item.index} current={track.id === currentId} playing={track.id === currentId && playing} onPlay={onPlay} />
            </div>
          );
        })}
      </div>
      {loadingMore && <p className="py-4 text-center font-type text-sm text-muted">{t.loadingMore}</p>}
    </div>
  );
}
