import { useEffect, useMemo, useRef } from "react";
import type { QueueSource, Track } from "@shared/types";
import { useT } from "@/i18n";
import { useViewState } from "@/state/viewState";
import Icon from "../ui/Icon";

export type ListSort = "default" | "reverse" | "title" | "artist" | "length";

const fold = (s: string) => s.toLowerCase().replace(/ё/g, "е").normalize("NFKD").replace(/[̀-ͯ]/g, "");
const byText = (key: (t: Track) => string) => (a: Track, b: Track) => key(a).localeCompare(key(b), undefined, { sensitivity: "base", numeric: true });

/**
 * Find and sort inside a list (likes, a playlist, a profile's tracks). Untouched, the list pages in as before; with
 * a filter or a sort the rest of it is loaded first, then filtered here — and played as that filtered list.
 */
export function useListFilter(
  name: string,
  tracks: Track[],
  source: QueueSource,
  more: { hasMore: boolean; loadingMore: boolean; loadMore?: () => void },
) {
  const [text, setText] = useViewState(`find:${name}`, "");
  const [sort, setSort] = useViewState<ListSort>(`sort:${name}`, "default");
  const active = text.trim().length > 0 || sort !== "default";

  // everything has to be here to filter or sort it
  const loadMore = useRef(more.loadMore);
  useEffect(() => {
    loadMore.current = more.loadMore;
  });
  useEffect(() => {
    if (active && more.hasMore && !more.loadingMore) loadMore.current?.();
  }, [active, more.hasMore, more.loadingMore]);

  const shown = useMemo(() => {
    if (!active) return tracks;
    const words = fold(text).split(/\s+/).filter(Boolean);
    let list = words.length ? tracks.filter((t) => words.every((w) => fold(`${t.title} ${t.artist} ${t.user.username}`).includes(w))) : [...tracks];
    if (sort === "reverse") list = list.reverse();
    else if (sort === "title") list.sort(byText((t) => t.title));
    else if (sort === "artist") list.sort(byText((t) => t.artist));
    else if (sort === "length") list.sort((a, b) => a.durationMs - b.durationMs);
    return list;
  }, [tracks, text, sort, active]);

  return {
    text,
    setText,
    sort,
    setSort,
    active,
    tracks: shown,
    /** a filtered list plays as it is shown, not as the whole list it came from */
    source: active ? ({ kind: "static" } as QueueSource) : source,
    loadingAll: active && more.hasMore,
  };
}

/** `playlist`: the list's own order is the playlist's, not newest first */
export default function ListFilter({ f, count, playlist = false }: { f: ReturnType<typeof useListFilter>; count: number; playlist?: boolean }) {
  const t = useT();
  const sorts: [ListSort, string][] = [
    ["default", playlist ? t.sortPlaylist : t.sortDefault],
    ["reverse", playlist ? t.sortPlaylistReverse : t.sortReverse],
    ["title", t.sortTitle],
    ["artist", t.sortArtist],
    ["length", t.sortLength],
  ];
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 px-1">
      <label className="field sketch sketch-thin paper-fill flex min-w-48 max-w-80 flex-1 items-center gap-2 rounded-md px-2.5">
        <Icon name="search" size={16} />
        <input
          type="text"
          value={f.text}
          onChange={(e) => f.setText(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && f.setText("")}
          placeholder={t.findInList}
          aria-label={t.findInList}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-text placeholder:text-muted/70"
        />
        {f.text && (
          <button type="button" onClick={() => f.setText("")} aria-label={t.clear} className="text-muted hover:text-text">
            <Icon name="close" size={14} />
          </button>
        )}
      </label>
      <select
        value={f.sort}
        onChange={(e) => f.setSort(e.target.value as ListSort)}
        aria-label={t.sortBy}
        className="field sketch sketch-thin paper-fill rounded-md px-2 py-1.5 text-sm text-text"
      >
        {sorts.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
      {f.active && <span className="font-type text-xs text-muted">{f.loadingAll ? t.loadingAll : t.found(count)}</span>}
    </div>
  );
}
